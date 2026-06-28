import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { ProcessedProductImageResult } from './products.types';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const IMAGE_MAX_EDGE = 1500;
const TAOBAO_MAIN_SIZE = 800;

@Injectable()
export class ProductImageProcessorService {
  private readonly storageRoot = path.resolve(process.cwd(), 'storage');
  private readonly storageFolders = {
    original: 'original_images',
    main: 'taobao_main_images',
    detail: 'taobao_detail_images',
  };

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async processImage(imageId: number): Promise<ProcessedProductImageResult> {
    const image = await this.prismaService.productImage.findUnique({
      where: { id: imageId },
      select: {
        id: true,
        productId: true,
        imageUrl: true,
      },
    });

    if (!image) {
      throw new NotFoundException('商品图片不存在');
    }

    await this.ensureStorageDirs(image.productId);

    const sourceBuffer = await this.downloadImage(image.imageUrl);
    const originalBuffer = await sharp(sourceBuffer)
      .rotate()
      .resize({
        width: IMAGE_MAX_EDGE,
        height: IMAGE_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 84,
        mozjpeg: true,
      })
      .toBuffer();
    const mainBuffer = await sharp(originalBuffer)
      .resize(TAOBAO_MAIN_SIZE, TAOBAO_MAIN_SIZE, {
        fit: 'contain',
        background: '#ffffff',
      })
      .jpeg({
        quality: 82,
        mozjpeg: true,
      })
      .toBuffer();
    const detailBuffer = await sharp(originalBuffer)
      .resize({
        width: IMAGE_MAX_EDGE,
        height: IMAGE_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 85,
        mozjpeg: true,
      })
      .toBuffer();
    const metadata = await sharp(originalBuffer).metadata();

    const originalFileName = `${image.id}-original.jpg`;
    const mainFileName = `${image.id}-main.jpg`;
    const detailFileName = `${image.id}-detail.jpg`;

    await Promise.all([
      this.writeImageFile(this.storageFolders.original, image.productId, originalFileName, originalBuffer),
      this.writeImageFile(this.storageFolders.main, image.productId, mainFileName, mainBuffer),
      this.writeImageFile(this.storageFolders.detail, image.productId, detailFileName, detailBuffer),
    ]);

    return {
      originalImageUrl: this.buildPublicUrl(this.storageFolders.original, image.productId, originalFileName),
      taobaoMainImageUrl: this.buildPublicUrl(this.storageFolders.main, image.productId, mainFileName),
      taobaoDetailImageUrl: this.buildPublicUrl(this.storageFolders.detail, image.productId, detailFileName),
      mimeType: 'image/jpeg',
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      fileSize: originalBuffer.byteLength,
    };
  }

  private async downloadImage(imageUrl: string) {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'jp-shopping-image-processor/1.0',
      },
    });
    if (!response.ok) {
      throw new Error(`下载图片失败: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new Error('下载图片内容为空');
    }

    return buffer;
  }

  private async ensureStorageDirs(productId: number) {
    await Promise.all(
      Object.values(this.storageFolders).map((folder) =>
        mkdir(this.resolveFolderPath(folder, productId), { recursive: true }),
      ),
    );
  }

  private async writeImageFile(folder: string, productId: number, fileName: string, buffer: Buffer) {
    await writeFile(path.join(this.resolveFolderPath(folder, productId), fileName), buffer);
  }

  private resolveFolderPath(folder: string, productId: number) {
    return path.join(this.storageRoot, folder, `product-${productId}`);
  }

  private buildPublicUrl(folder: string, productId: number, fileName: string) {
    const assetBaseUrl =
      this.configService.get<string>('ASSET_BASE_URL')?.trim() ||
      `http://localhost:${this.configService.get<string>('PORT')?.trim() || '3001'}`;

    return `${assetBaseUrl}/uploads/${folder}/product-${productId}/${fileName}`;
  }
}
