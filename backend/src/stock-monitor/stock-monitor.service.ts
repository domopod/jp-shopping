import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MontbellCollectorService } from './montbell-collector.service';
import { AddStockProductDto } from './dto/add-stock-product.dto';

@Injectable()
export class StockMonitorService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly montbellCollectorService: MontbellCollectorService,
  ) {}

  async addProduct(dto: AddStockProductDto) {
    const url = dto.url.trim();

    const existing = await this.prismaService.stockMonitorProduct.findFirst({
      where: { sourceUrl: url },
    });
    if (existing) {
      throw new BadRequestException('该商品已在监控列表中');
    }

    const stockData = await this.montbellCollectorService.collectStock(url);

    const product = await this.prismaService.stockMonitorProduct.create({
      data: {
        sourceUrl: url,
        title: stockData.title,
        brand: stockData.brand,
        price: stockData.price,
        imageUrl: stockData.imageUrl,
        checkStatus: 'SUCCESS',
        lastCheckedAt: new Date(),
        skus: {
          create: stockData.skus.map((sku) => ({
            skuCode: sku.skuCode,
            color: sku.color,
            colorCode: sku.colorCode,
            size: sku.size,
            stockStatus: sku.stockStatus,
            stockStatusCode: sku.stockStatusCode,
            stockQuantity: sku.stockQuantity,
            storeStockQuantity: sku.storeStockQuantity,
            transferableStockQuantity: sku.transferableStockQuantity,
            arrivalQuantity: sku.arrivalQuantity,
            stockDate: sku.stockDate,
            restockDate: sku.restockDate,
            price: sku.price,
            lastCheckedAt: new Date(),
          })),
        },
      },
      include: {
        skus: true,
      },
    });

    return this.toProductResponse(product);
  }

  async listProducts() {
    const products = await this.prismaService.stockMonitorProduct.findMany({
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      include: {
        skus: {
          orderBy: [{ colorCode: 'asc' }, { size: 'asc' }],
        },
      },
    });

    return {
      items: products.map((p) => this.toProductResponse(p)),
      total: products.length,
    };
  }

  async togglePin(id: number) {
    const product = await this.prismaService.stockMonitorProduct.findUnique({
      where: { id },
    });
    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    const updated = await this.prismaService.stockMonitorProduct.update({
      where: { id },
      data: { isPinned: !product.isPinned },
      include: {
        skus: {
          orderBy: [{ colorCode: 'asc' }, { size: 'asc' }],
        },
      },
    });

    return this.toProductResponse(updated);
  }

  async deleteProduct(id: number) {
    const product = await this.prismaService.stockMonitorProduct.findUnique({
      where: { id },
    });
    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    await this.prismaService.stockMonitorProduct.delete({
      where: { id },
    });

    return { success: true };
  }

  async refreshProduct(id: number) {
    const product = await this.prismaService.stockMonitorProduct.findUnique({
      where: { id },
    });
    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    const stockData = await this.montbellCollectorService.collectStock(product.sourceUrl);

    await this.prismaService.stockMonitorProduct.update({
      where: { id },
      data: {
        title: stockData.title,
        brand: stockData.brand,
        price: stockData.price,
        imageUrl: stockData.imageUrl,
        checkStatus: 'SUCCESS',
        checkError: null,
        lastCheckedAt: new Date(),
      },
    });

    const existingSkus = await this.prismaService.stockMonitorSku.findMany({
      where: { productId: id },
    });

    const skuMap = new Map(existingSkus.map((s) => [s.skuCode, s]));

    for (const sku of stockData.skus) {
      const existing = skuMap.get(sku.skuCode);
      if (existing) {
        await this.prismaService.stockMonitorSku.update({
          where: { id: existing.id },
          data: {
            color: sku.color,
            colorCode: sku.colorCode,
            size: sku.size,
            stockStatus: sku.stockStatus,
            stockStatusCode: sku.stockStatusCode,
            stockQuantity: sku.stockQuantity,
            storeStockQuantity: sku.storeStockQuantity,
            transferableStockQuantity: sku.transferableStockQuantity,
            arrivalQuantity: sku.arrivalQuantity,
            stockDate: sku.stockDate,
            restockDate: sku.restockDate,
            price: sku.price,
            lastCheckedAt: new Date(),
          },
        });
        skuMap.delete(sku.skuCode);
      } else {
        await this.prismaService.stockMonitorSku.create({
          data: {
            productId: id,
            skuCode: sku.skuCode,
            color: sku.color,
            colorCode: sku.colorCode,
            size: sku.size,
            stockStatus: sku.stockStatus,
            stockStatusCode: sku.stockStatusCode,
            stockQuantity: sku.stockQuantity,
            storeStockQuantity: sku.storeStockQuantity,
            transferableStockQuantity: sku.transferableStockQuantity,
            arrivalQuantity: sku.arrivalQuantity,
            stockDate: sku.stockDate,
            restockDate: sku.restockDate,
            price: sku.price,
            lastCheckedAt: new Date(),
          },
        });
      }
    }

    for (const [, sku] of skuMap) {
      await this.prismaService.stockMonitorSku.delete({
        where: { id: sku.id },
      });
    }

    const updatedProduct = await this.prismaService.stockMonitorProduct.findUnique({
      where: { id },
      include: {
        skus: {
          orderBy: [{ colorCode: 'asc' }, { size: 'asc' }],
        },
      },
    });

    return this.toProductResponse(updatedProduct!);
  }

  async refreshAllProducts() {
    const products = await this.prismaService.stockMonitorProduct.findMany({
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    });

    const results = await Promise.allSettled(
      products.map(async (product) => {
        try {
          await this.refreshProduct(product.id);
          return { id: product.id, success: true };
        } catch (error) {
          return { id: product.id, success: false, error: (error as Error).message };
        }
      }),
    );

    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
    const failCount = results.length - successCount;

    const updatedProducts = await this.prismaService.stockMonitorProduct.findMany({
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      include: {
        skus: {
          orderBy: [{ colorCode: 'asc' }, { size: 'asc' }],
        },
      },
    });

    return {
      items: updatedProducts.map((p) => this.toProductResponse(p)),
      total: updatedProducts.length,
      refreshedCount: successCount,
      failedCount: failCount,
    };
  }

  private toProductResponse(product: {
    id: number;
    sourceUrl: string;
    title: string;
    brand: string | null;
    price: string | null;
    imageUrl: string | null;
    lastCheckedAt: Date | null;
    checkStatus: string;
    checkError: string | null;
    isPinned: boolean;
    createdAt: Date;
    updatedAt: Date;
    skus: Array<{
      id: number;
      skuCode: string;
      color: string | null;
      colorCode: string | null;
      size: string | null;
      stockStatus: string;
      stockStatusCode: number | null;
      stockQuantity: number | null;
      storeStockQuantity: number | null;
      transferableStockQuantity: number | null;
      arrivalQuantity: number | null;
      stockDate: string | null;
      restockDate: string | null;
      price: string | null;
      lastCheckedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
  }) {
    return {
      id: product.id,
      sourceUrl: product.sourceUrl,
      title: product.title,
      brand: product.brand,
      price: product.price,
      imageUrl: product.imageUrl,
      isPinned: product.isPinned,
      lastCheckedAt: product.lastCheckedAt?.toISOString() || null,
      checkStatus: product.checkStatus,
      checkError: product.checkError,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      skus: product.skus.map((sku) => ({
        id: sku.id,
        skuCode: sku.skuCode,
        color: sku.color,
        colorCode: sku.colorCode,
        size: sku.size,
        stockStatus: sku.stockStatus,
        stockStatusCode: sku.stockStatusCode,
        stockQuantity: sku.stockQuantity,
        storeStockQuantity: sku.storeStockQuantity,
        transferableStockQuantity: sku.transferableStockQuantity,
        arrivalQuantity: sku.arrivalQuantity,
        stockDate: sku.stockDate,
        restockDate: sku.restockDate,
        price: sku.price,
        lastCheckedAt: sku.lastCheckedAt?.toISOString() || null,
      })),
    };
  }
}
