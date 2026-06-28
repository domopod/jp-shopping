import { Injectable, NotFoundException } from '@nestjs/common';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { ImageCenterStorageService } from './image-center-storage.service';
import type { ImageCenterCategory } from './products.types';

const IMAGE_CENTER_CATEGORY_FILE_PREFIXES: Record<ImageCenterCategory, string> = {
  square_main: '11',
  portrait_main: '34',
  long_main: 'Long-picture',
  detail: 'details',
  sku: 'sku',
  size_chart: 'size',
};

@Injectable()
export class ImageCenterDownloadService {
  private readonly downloadRoot = path.resolve(process.cwd(), 'storage', 'image-center-downloads');

  constructor(
    private readonly prismaService: PrismaService,
    private readonly imageCenterStorageService: ImageCenterStorageService,
  ) {}

  async buildCategoryZip(productId: number, category: ImageCenterCategory) {
    const product = await this.prismaService.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        title: true,
        skus: {
          select: {
            skuCode: true,
            color: true,
            name: true,
          },
        },
        generatedImages: {
          where: { category },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    const fileName = `${this.safeName(product.title)}-${this.safeName(this.getCategoryFilePrefix(category))}.zip`;
    const skuNameMap = this.buildSkuNameMap(product.skus);
    return this.writeZip(
      fileName,
      this.buildZipFiles(
        product.generatedImages.map((asset) => ({
          storageKey: asset.storageKey,
          category: asset.category as ImageCenterCategory,
          sourceSkuCode: asset.sourceSkuCode,
        })),
        skuNameMap,
      ),
    );
  }

  async buildProductZip(productId: number) {
    const product = await this.prismaService.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        title: true,
        skus: {
          select: {
            skuCode: true,
            color: true,
            name: true,
          },
        },
        generatedImages: {
          orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
        },
      },
    });

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    const fileName = `${this.safeName(product.title)}.zip`;
    const skuNameMap = this.buildSkuNameMap(product.skus);
    return this.writeZip(
      fileName,
      this.buildZipFiles(
        product.generatedImages.map((asset) => ({
          storageKey: asset.storageKey,
          category: asset.category as ImageCenterCategory,
          sourceSkuCode: asset.sourceSkuCode,
        })),
        skuNameMap,
      ),
    );
  }

  private async writeZip(fileName: string, files: Array<{ storageKey: string; zipPath: string }>) {
    await mkdir(this.downloadRoot, { recursive: true });
    const zipPath = path.join(this.downloadRoot, fileName);
    const ZipArchive = await this.getZipArchiveClass();

    await new Promise<void>(async (resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = new ZipArchive({
        zlib: { level: 9 },
      });

      output.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(output);

      for (const file of files) {
        const sourceBuffer = await this.imageCenterStorageService.getObjectBuffer(file.storageKey);
        const buffer = await this.normalizeZipImageBuffer(sourceBuffer);
        archive.append(buffer, { name: file.zipPath });
      }

      await archive.finalize();
    });

    return {
      fileName,
      filePath: zipPath,
      downloadUrl: this.toAssetUrl(zipPath),
    };
  }

  private async getZipArchiveClass() {
    const imported = require('archiver');
    const ZipArchive = imported.ZipArchive;
    if (typeof ZipArchive !== 'function') {
      throw new Error('archiver 模块加载失败');
    }

    return ZipArchive;
  }

  private safeName(value: string) {
    return value
      .replace(/[\\/%:*?"<>|\s]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || `product-${Date.now()}`;
  }

  private getCategoryFilePrefix(category: ImageCenterCategory) {
    return IMAGE_CENTER_CATEGORY_FILE_PREFIXES[category] || category;
  }

  private buildSkuNameMap(
    skus: Array<{
      skuCode: string;
      color: string | null;
      name: string | null;
    }>,
  ) {
    return new Map(
      skus.map((sku) => [sku.skuCode, this.safeName(sku.color || sku.name || sku.skuCode)]),
    );
  }

  private async normalizeZipImageBuffer(buffer: Buffer) {
    return sharp(buffer)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 92 })
      .toBuffer();
  }

  private buildZipFiles(
    files: Array<{
      storageKey: string;
      category: ImageCenterCategory;
      sourceSkuCode: string | null;
    }>,
    skuNameMap: Map<string, string>,
  ) {
    const categoryCounters = new Map<ImageCenterCategory, number>();
    const skuNameCounters = new Map<string, number>();

    return files.map((file) => {
      if (file.category === 'sku') {
        const colorName = file.sourceSkuCode
          ? skuNameMap.get(file.sourceSkuCode) || this.safeName(file.sourceSkuCode)
          : 'unknown';
        const currentCount = (skuNameCounters.get(colorName) || 0) + 1;
        skuNameCounters.set(colorName, currentCount);
        const dedupedColorName = currentCount > 1 ? `${colorName}-${currentCount}` : colorName;

        return {
          storageKey: file.storageKey,
          zipPath: `sku_${dedupedColorName}.jpg`,
        };
      }

      const currentCount = (categoryCounters.get(file.category) || 0) + 1;
      categoryCounters.set(file.category, currentCount);
      const baseName = `${this.getCategoryFilePrefix(file.category)}_${currentCount}`;

      return {
        storageKey: file.storageKey,
        zipPath: `${baseName}.jpg`,
      };
    });
  }

  private toAssetUrl(filePath: string) {
    const relative = path.relative(path.resolve(process.cwd(), 'storage'), filePath).split(path.sep).join('/');
    return `http://localhost:3001/uploads/${encodeURI(relative)}`;
  }
}
