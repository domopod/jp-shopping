import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  type ProductGeneratedImage,
  type ProductImage,
  type ProductSku,
} from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { AgnesImageService } from './agnes-image.service';
import { IMAGE_CATEGORY_TARGETS } from './image-center.constants';
import { ImageCenterStorageService } from './image-center-storage.service';
import { SizeChartService } from './size-chart.service';
import {
  ModelPromptService,
  SQUARE_MAIN_WHITE_PROMPT_KEY,
  SQUARE_MAIN_EXPAND_PROMPT_KEY,
  PORTRAIT_MAIN_EXPAND_PROMPT_KEY,
  LONG_MAIN_PROMPT_KEY,
  LONG_MAIN_COMPOSE_PROMPT_KEY,
  DEFAULT_SQUARE_MAIN_WHITE_PROMPT,
} from './model-prompt.service';
import { IMAGE_CENTER_CATEGORIES } from './products.types';
import { SmartCropService, type SmartCropResult } from './smart-crop.service';
import type { SmartCropCategory } from './smart-crop.constants';
import type {
  GeneratedImageAssetResult,
  ImageCenterCategory,
  ImageCenterTaskPayload,
} from './products.types';

type ProductWithMedia = Prisma.ProductGetPayload<{
  include: {
    images: { orderBy: { sortOrder: 'asc' } };
    skus: { orderBy: { id: 'asc' } };
  };
}>;

interface DownloadedSourceImage {
  buffer: Buffer;
  mimeType: string;
  format: string | null;
  width: number | null;
  height: number | null;
}

interface SubjectBoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface MainImageProcessOutput {
  buffer: Buffer;
  width: number;
  height: number;
  processMode: 'crop' | 'background_expand';
  subjectBBox: SubjectBoundingBox;
  background: string;
}

interface SquareMainSpecialSources {
  whiteProductSource: {
    sourceUrl: string;
    sourceImageId?: number;
    sourceSkuCode?: string;
  } | null;
  collageRightSource: {
    sourceUrl: string;
    sourceImageId?: number;
  } | null;
  collageSkuSources: Array<{
    sourceUrl: string;
    sourceSkuCode?: string;
  }>;
}

@Injectable()
export class ImageCenterProcessorService {
  private readonly logger = new Logger(ImageCenterProcessorService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly agnesImageService: AgnesImageService,
    private readonly imageCenterStorageService: ImageCenterStorageService,
    private readonly sizeChartService: SizeChartService,
    private readonly modelPromptService: ModelPromptService,
    private readonly smartCropService: SmartCropService,
  ) {}

  async generateSquareMainSlot1(productId: number): Promise<GeneratedImageAssetResult | null> {
    const product = await this.prismaService.product.findUnique({
      where: { id: productId },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        skus: { orderBy: { id: 'asc' } },
      },
    });

    if (!product) {
      throw new NotFoundException(`商品不存在: ${productId}`);
    }

    const sourceSkus = this.pickSourceSkus(product.skus).filter((sku) => sku.imageUrl);
    const skuAssets = await this.prismaService.productGeneratedImage.findMany({
      where: {
        productId: product.id,
        category: 'sku',
        status: 'SUCCESS',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        sourceSkuCode: true,
        imageUrl: true,
      },
    });

    const latestSkuAssetMap = new Map<string, string>();
    for (const asset of skuAssets) {
      if (!asset.sourceSkuCode || !asset.imageUrl || latestSkuAssetMap.has(asset.sourceSkuCode)) {
        continue;
      }
      latestSkuAssetMap.set(asset.sourceSkuCode, asset.imageUrl);
    }

    const skuCandidates = sourceSkus.map((sku) => ({
      sourceUrl: latestSkuAssetMap.get(sku.skuCode) || (sku.imageUrl as string),
      sourceSkuCode: sku.skuCode,
    }));

    const longMainAsset = await this.prismaService.productGeneratedImage.findFirst({
      where: {
        productId: product.id,
        category: 'long_main',
        status: 'SUCCESS',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        imageUrl: true,
      },
    });

    const preferredProductImages = this.pickSourceProductImages(product.images, 5);
    const defaultProductImages = this.pickSourceProductImages(product.images, 5);
    const fallbackProductImage = preferredProductImages[0] ?? defaultProductImages[0] ?? null;

    const collageRightSource = longMainAsset?.imageUrl
      ? { sourceUrl: longMainAsset.imageUrl }
      : fallbackProductImage
      ? {
          sourceUrl: this.getPreferredSourceUrl(fallbackProductImage) as string,
          sourceImageId: fallbackProductImage.id,
        }
      : null;

    if (!collageRightSource || skuCandidates.length === 0) {
      return null;
    }

    const existingAssets = await this.prismaService.productGeneratedImage.findMany({
      where: {
        productId: product.id,
        category: 'square_main',
        slotIndex: 1,
      },
      select: { id: true, storageKey: true },
    });

    const result = await this.generateAndStoreSkuLongCollageSquareAsset({
      productId: product.id,
      slotIndex: 1,
      rightSourceUrl: collageRightSource.sourceUrl,
      rightSourceImageId: collageRightSource.sourceImageId,
      skuSources: skuCandidates,
    });

    const existingKeys = new Set(existingAssets.map((item) => item.storageKey));
    existingKeys.delete(result.storageKey);

    await this.prismaService.productGeneratedImage.deleteMany({
      where: {
        productId: product.id,
        category: 'square_main',
        slotIndex: 1,
      },
    });

    await this.prismaService.productGeneratedImage.create({
      data: {
        productId: product.id,
        category: 'square_main',
        slotIndex: 1,
        storageKey: result.storageKey,
        imageUrl: result.imageUrl,
        mimeType: result.mimeType,
        width: result.width,
        height: result.height,
        fileSize: result.fileSize,
        sourceImageId: result.sourceImageId ?? null,
        sourceUrl: result.sourceUrl,
        sourceSkuCode: null,
        status: 'SUCCESS',
        metadata: result.metadata ? (result.metadata as object) : undefined,
      },
    });

    for (const oldKey of existingKeys) {
      if (oldKey && oldKey !== result.storageKey) {
        try {
          await this.imageCenterStorageService.deleteObject(oldKey);
        } catch {
          // ignore cleanup errors
        }
      }
    }

    return result;
  }

  async generateSquareMainSlot1Manual(
    productId: number,
    input: {
      background: {
        sourceUrl: string;
        offsetX: number;
        offsetY: number;
        scale: number;
      };
      skus: Array<{
        sourceUrl: string;
        sourceSkuCode?: string;
      }>;
      skuPanel: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    },
  ): Promise<GeneratedImageAssetResult | null> {
    const target = IMAGE_CATEGORY_TARGETS.square_main;
    const outputWidth = target.width;
    const outputHeight = target.height;

    if (input.skus.length < 2 || input.skus.length > 10) {
      throw new Error('SKU 图片请选择 2-10 张');
    }

    const composites: sharp.OverlayOptions[] = [];

    // 1. 处理背景图片：缩放后贴入 1440x1440 取景框，框外内容自然隐藏。
    try {
      const bgImage = await this.downloadSourceImage(input.background.sourceUrl);
      const bgWidth = Math.round(
        (bgImage.width ?? outputWidth) * input.background.scale,
      );
      const bgHeight = Math.round(
        (bgImage.height ?? outputHeight) * input.background.scale,
      );
      const rawOffsetX = Math.round(input.background.offsetX);
      const rawOffsetY = Math.round(input.background.offsetY);

      // 缩放背景图到 bgWidth x bgHeight
      const scaledBuffer = await sharp(bgImage.buffer)
        .rotate()
        .resize(bgWidth, bgHeight, { fit: 'fill' })
        .png()
        .toBuffer();

      // 从缩放后的背景图中提取 1440x1440 的可视区域
      // scaledBuffer 左上角在画布坐标系中的位置: (-rawOffsetX, -rawOffsetY)
      // 需要从 scaledBuffer 中提取需要的区域，再用白色扩展到 1440x1440

      // 计算从 scaledBuffer 的哪个位置开始提取
      // 如果 offset > 0 表示 scaledBuffer 的起点是正方向被裁切
      // 如果 offset < 0 表示 scaledBuffer 比画布小，有留白
      const extractLeft = Math.max(0, rawOffsetX);
      const extractTop = Math.max(0, rawOffsetY);
      const extractWidth = Math.max(
        1,
        Math.min(outputWidth, bgWidth - extractLeft),
      );
      const extractHeight = Math.max(
        1,
        Math.min(outputHeight, bgHeight - extractTop),
      );

      // 计算需要扩展的白色边距
      // 画布左上角距离 scaledBuffer 左上角的距离
      // 正数: scaledBuffer 左上角位置 = (-extractLeft, (-offsetX),
      // 左侧留白: Math.max(0, -rawOffsetX)
      const extendLeft = Math.max(0, -rawOffsetX);
      const extendTop = Math.max(0, -rawOffsetY);
      const extendRight = Math.max(
        0,
        outputWidth - extendLeft - extractWidth);
      const extendBottom = Math.max(
        0,
        outputHeight - extendTop - extractHeight);

      // 1) 从 scaledBuffer 提取需要的区域
      const extractedBuffer = await sharp(scaledBuffer)
        .extract({
          left: extractLeft,
          top: extractTop,
          width: extractWidth,
          height: extractHeight,
        })
        .png()
        .toBuffer();

      // 2) 用白色扩展到 1440x1440
      const backgroundBuffer = await sharp(extractedBuffer)
        .extend({
          top: extendTop,
          bottom: extendBottom,
          left: extendLeft,
          right: extendRight,
          background: { r: 255, g: 255, b: 255 },
        })
        .png()
        .toBuffer();

      composites.push({ input: backgroundBuffer, left: 0, top: 0 });
    } catch (error) {
      throw new Error(
        `处理背景图片失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 2. 处理 SKU 面板
    const skuCount = input.skus.length;
    const columns = skuCount <= 5 ? 1 : 2;
    const rows = Math.ceil(skuCount / columns);
    const panelX = Math.max(0, Math.round(input.skuPanel.x));
    const panelY = Math.max(0, Math.round(input.skuPanel.y));
    const panelWidth = Math.max(1, Math.min(outputWidth - panelX, Math.round(input.skuPanel.width)));
    const panelHeight = Math.max(1, Math.min(outputHeight - panelY, Math.round(input.skuPanel.height)));
    const padding = 5;
    const gap = 5;
    const innerWidth = panelWidth - padding * 2;
    const innerHeight = panelHeight - padding * 2;
    const cellWidth = Math.max(1, Math.floor((innerWidth - gap * (columns - 1)) / columns));
    const cellHeight = Math.max(1, Math.floor((innerHeight - gap * (rows - 1)) / rows));

    if (panelWidth > 0 && panelHeight > 0) {
      const panelBuffer = await sharp({
        create: {
          width: panelWidth,
          height: panelHeight,
          channels: 3,
          background: '#ffffff',
        },
      })
        .png()
        .toBuffer();
      composites.push({ input: panelBuffer, left: panelX, top: panelY });
    }

    let processedSkuCount = 0;
    const failedSkuIndexes: number[] = [];

    for (let index = 0; index < skuCount; index += 1) {
      const sku = input.skus[index];
      try {
        const sourceImage = await this.downloadSourceImage(sku.sourceUrl);
        const skuBuffer = await sharp(sourceImage.buffer)
          .rotate()
          .resize(cellWidth, cellHeight, {
            fit: 'cover',
          })
          .png()
          .toBuffer();

        const row = Math.floor(index / columns);
        const col = index % columns;
        const left = panelX + padding + col * (cellWidth + gap);
        const top = panelY + padding + row * (cellHeight + gap);

        composites.push({ input: skuBuffer, left, top });
        processedSkuCount += 1;
      } catch {
        failedSkuIndexes.push(index + 1);
      }
    }

    if (processedSkuCount !== skuCount) {
      throw new Error(
        `处理 SKU 图片失败，请重新选择图片（失败序号：${failedSkuIndexes.join('、')}）`,
      );
    }

    // 3. 合成输出
    const output = sharp({
      create: {
        width: outputWidth,
        height: outputHeight,
        channels: 3,
        background: '#ffffff',
      },
    }).composite(composites);

    const outputBuffer =
      target.format === 'png'
        ? await output.png().toBuffer()
        : await output.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    const outputMetadata = await sharp(outputBuffer).metadata();

    // 4. 上传并存储
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const storageKey = this.buildStorageKey(
      productId,
      'square_main',
      1,
      target.format,
      `${Date.now()}-${seed}`,
    );
    const stored = await this.imageCenterStorageService.uploadBuffer(
      storageKey,
      outputBuffer,
      target.format === 'png' ? 'image/png' : 'image/jpeg',
    );

    const result: GeneratedImageAssetResult = {
      category: 'square_main',
      slotIndex: 1,
      storageKey: stored.storageKey,
      imageUrl: stored.imageUrl,
      mimeType: target.format === 'png' ? 'image/png' : 'image/jpeg',
      width: outputMetadata.width ?? outputWidth,
      height: outputMetadata.height ?? outputHeight,
      fileSize: outputBuffer.byteLength,
      sourceImageId: null,
      sourceUrl: input.background.sourceUrl,
      metadata: {
        generator: 'manual-square-main-slot1',
        skuCount,
        background: {
          sourceUrl: input.background.sourceUrl,
          offsetX: input.background.offsetX,
          offsetY: input.background.offsetY,
          scale: input.background.scale,
        },
        skuPanel: {
          x: panelX,
          y: panelY,
          width: panelWidth,
          height: panelHeight,
          columns,
          rows,
        },
        skus: input.skus.map((sku) => ({
          sourceUrl: sku.sourceUrl,
          sourceSkuCode: sku.sourceSkuCode,
        })),
      },
    };

    // 5. 清理旧资源并保存数据库记录
    const existingAssets = await this.prismaService.productGeneratedImage.findMany({
      where: {
        productId,
        category: 'square_main',
        slotIndex: 1,
      },
      select: { id: true, storageKey: true },
    });

    const existingKeys = new Set(existingAssets.map((item) => item.storageKey));
    existingKeys.delete(result.storageKey);

    await this.prismaService.productGeneratedImage.deleteMany({
      where: { productId, category: 'square_main', slotIndex: 1 },
    });

    await this.prismaService.productGeneratedImage.create({
      data: {
        productId,
        category: 'square_main',
        slotIndex: 1,
        storageKey: result.storageKey,
        imageUrl: result.imageUrl,
        mimeType: result.mimeType,
        width: result.width,
        height: result.height,
        fileSize: result.fileSize,
        sourceImageId: null,
        sourceUrl: input.background.sourceUrl,
        sourceSkuCode: null,
        status: 'SUCCESS',
        metadata: result.metadata as object,
      },
    });

    for (const oldKey of existingKeys) {
      if (oldKey && oldKey !== result.storageKey) {
        try {
          await this.imageCenterStorageService.deleteObject(oldKey);
        } catch {
          // ignore cleanup errors
        }
      }
    }

    return result;
  }

  async processTask(
    taskId: number,
    payload: ImageCenterTaskPayload,
    options?: {
      isCancelled?: () => Promise<boolean>;
    },
  ) {
    const product = await this.loadProduct(payload.productId);
    await this.ensureNotCancelled(options?.isCancelled);

    switch (payload.category) {
      case 'square_main':
        return this.generateSquareMainImages(product, payload, options);
      case 'portrait_main':
        return this.generatePortraitMainImages(product, payload, options);
      case 'long_main':
        return this.generateLongMainImage(product, payload, options);
      case 'detail':
        return this.generateDetailImages(product, payload, options);
      case 'sku':
        return this.generateSkuImages(product, payload, options);
      case 'size_chart':
        return this.generateSizeChart(product, payload, options);
      default:
        throw new Error(
          `不支持的图片分类: ${payload.category satisfies never}`,
        );
    }
  }

  async replaceSkuImage(input: {
    productId: number;
    sourceSkuCode: string;
    sourceUrl: string;
    sourceImageId?: number;
  }) {
    const product = await this.loadProduct(input.productId);
    const allSourceSkus = this.pickSourceSkus(product.skus);
    const existingAssets =
      await this.prismaService.productGeneratedImage.findMany({
        where: {
          productId: input.productId,
          category: 'sku',
          sourceSkuCode: input.sourceSkuCode,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    const slotIndex = Math.max(
      0,
      allSourceSkus.findIndex((sku) => sku.skuCode === input.sourceSkuCode),
      existingAssets[0]?.slotIndex ?? -1,
    );
    const asset = await this.generateAndStoreSourceAsset({
      productId: input.productId,
      category: 'sku',
      slotIndex,
      sourceSkuCode: input.sourceSkuCode,
      sourceImageId: input.sourceImageId,
      sourceUrl: input.sourceUrl,
      uniqueKeySuffix: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });

    await this.prismaService.$transaction(async (tx) => {
      await tx.productGeneratedImage.deleteMany({
        where: {
          productId: input.productId,
          category: 'sku',
          sourceSkuCode: input.sourceSkuCode,
        },
      });

      await tx.productGeneratedImage.create({
        data: this.buildGeneratedImageCreateData(input.productId, 'sku', asset),
      });
    });

    for (const existing of existingAssets) {
      if (existing.storageKey === asset.storageKey) {
        continue;
      }

      await this.imageCenterStorageService.deleteObject(existing.storageKey);
    }

    return asset;
  }

  private async loadProduct(productId: number) {
    const product = await this.prismaService.product.findUnique({
      where: { id: productId },
      include: {
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        skus: {
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    return product;
  }

  private async generateSquareMainImages(
    product: ProductWithMedia,
    payload: ImageCenterTaskPayload,
    options?: {
      isCancelled?: () => Promise<boolean>;
    },
  ) {
    const defaultSourceImages = this.pickSourceProductImages(product.images, 5);
    const sourceImages = this.pickSourceProductImages(
      product.images,
      5,
      payload.sourceImageId,
    );
    const targetSlot = payload.targetSlot;

    if (!sourceImages.length && !defaultSourceImages.length) {
      throw new Error('未找到可用原始图片，无法生成 1:1 主图');
    }

    await this.clearCategoryAssets(product.id, 'square_main', targetSlot);
    const specialSources = await this.getSquareMainSpecialSources(
      product,
      payload,
    );

    const results: GeneratedImageAssetResult[] = [];
    const generationQueue =
      targetSlot !== undefined
        ? [
            {
              slotIndex: targetSlot,
              sourceImage:
                sourceImages[0] ??
                defaultSourceImages[targetSlot] ??
                defaultSourceImages[0],
            },
          ]
        : sourceImages.slice(0, 5).map((sourceImage, index) => ({
            slotIndex: index,
            sourceImage,
          }));

    // 仅当 generationMode 显式传入时才使用 AI
    // - AI_WHITE_PRODUCT：slot 0 使用 AI 白底
    // - AI_GENERATE：其他 slot 使用 AI 扩图
    // - undefined 或其他：全部 slot 使用传统裁切，不走 AI
    const useAiForWhiteProduct =
      payload.generationMode === 'AI_WHITE_PRODUCT';
    const useAiForExpand =
      payload.generationMode === 'AI_GENERATE';

    for (const entry of generationQueue) {
      await this.ensureNotCancelled(options?.isCancelled);
      const { slotIndex, sourceImage } = entry;

      let asset: GeneratedImageAssetResult | null = null;

      // slot 0：AI 白底，如果 whiteProductSource 不存在则 fallback 到 sourceImage
      if (slotIndex === 0) {
        if (specialSources.whiteProductSource) {
          if (useAiForWhiteProduct) {
            try {
              asset = await this.generateAndStoreAiWhiteProductSquareAsset({
                productId: product.id,
                slotIndex,
                sourceUrl: specialSources.whiteProductSource.sourceUrl,
                sourceImageId: specialSources.whiteProductSource.sourceImageId,
                sourceSkuCode: specialSources.whiteProductSource.sourceSkuCode,
              });
            } catch (error) {
              this.logger.warn(
                `[slot 0] AI 白底生成失败，回退到传统裁切: ${error instanceof Error ? error.message : String(error)}`,
              );
              asset = await this.generateAndStoreWhiteProductSquareAsset({
                productId: product.id,
                slotIndex,
                sourceUrl: specialSources.whiteProductSource.sourceUrl,
                sourceImageId: specialSources.whiteProductSource.sourceImageId,
                sourceSkuCode: specialSources.whiteProductSource.sourceSkuCode,
              });
            }
          } else {
            asset = await this.generateAndStoreWhiteProductSquareAsset({
              productId: product.id,
              slotIndex,
              sourceUrl: specialSources.whiteProductSource.sourceUrl,
              sourceImageId: specialSources.whiteProductSource.sourceImageId,
              sourceSkuCode: specialSources.whiteProductSource.sourceSkuCode,
            });
          }
        } else if (sourceImage) {
          // fallback：使用 sourceImage 进行 smart-crop
          const sourceUrl = this.getPreferredSourceUrl(sourceImage);
          if (sourceUrl) {
            asset = await this.generateAndStoreSmartCropAsset({
              productId: product.id,
              category: 'square_main',
              slotIndex,
              sourceImageId: sourceImage.id,
              sourceUrl,
            });
          }
        }
      } else if (slotIndex === 1) {
        // slot 1：SKU 拼贴。自动生成时（AUTO_GENERATE）不处理，保持置空，用户手动选择处理
        // 仅当显式指定 targetSlot === 1（用户手动点击）时才处理
        if (
          payload.targetSlot === 1 &&
          specialSources.collageRightSource &&
          specialSources.collageSkuSources.length
        ) {
          asset = await this.generateAndStoreSkuLongCollageSquareAsset({
            productId: product.id,
            slotIndex,
            rightSourceUrl: specialSources.collageRightSource.sourceUrl,
            rightSourceImageId: specialSources.collageRightSource.sourceImageId,
            skuSources: specialSources.collageSkuSources,
          });
        }
        // 其他情况跳过，置空
      } else if (sourceImage) {
        const sourceUrl = this.getPreferredSourceUrl(sourceImage);
        if (sourceUrl) {
          if (payload.generationMode === 'AI_GENERATE') {
            try {
              asset = await this.generateAndStoreAiExpandedAsset({
                productId: product.id,
                category: 'square_main',
                slotIndex,
                sourceImageId: sourceImage.id,
                sourceUrl,
              });
            } catch (error) {
              this.logger.warn(
                `[square_main slot ${slotIndex}] AI 扩图失败，回退到传统裁切: ${error instanceof Error ? error.message : String(error)}`,
              );
              asset = await this.generateAndStoreSmartCropAsset({
                productId: product.id,
                category: 'square_main',
                slotIndex,
                sourceImageId: sourceImage.id,
                sourceUrl,
              });
            }
          } else {
            asset = await this.generateAndStoreSmartCropAsset({
              productId: product.id,
              category: 'square_main',
              slotIndex,
              sourceImageId: sourceImage.id,
              sourceUrl,
            });
          }
        }
      }

      if (!asset) {
        continue;
      }

      results.push({ ...asset, isDefault: slotIndex === 0 });
    }

    await this.saveAssets(product.id, 'square_main', results);
    return results;
  }

  private async generatePortraitMainImages(
    product: ProductWithMedia,
    payload: ImageCenterTaskPayload,
    options?: {
      isCancelled?: () => Promise<boolean>;
    },
  ) {
    const defaultSourceImages = this.pickSourceProductImages(product.images, 5);
    const sourceImages = this.pickSourceProductImages(
      product.images,
      5,
      payload.sourceImageId,
    );
    const targetSlot = payload.targetSlot;

    if (!sourceImages.length && !defaultSourceImages.length) {
      throw new Error('未找到可用原始图片，无法生成 3:4 主图');
    }

    await this.clearCategoryAssets(product.id, 'portrait_main', targetSlot);
    const results: GeneratedImageAssetResult[] = [];

    const generationQueue =
      targetSlot !== undefined
        ? [
            {
              slotIndex: targetSlot,
              sourceImage:
                sourceImages[0] ??
                defaultSourceImages[targetSlot] ??
                defaultSourceImages[0],
            },
          ]
        : sourceImages.slice(0, 5).map((sourceImage, index) => ({
            slotIndex: index,
            sourceImage,
          }));

    for (const entry of generationQueue) {
      await this.ensureNotCancelled(options?.isCancelled);
      const { slotIndex, sourceImage } = entry;
      if (!sourceImage) {
        continue;
      }
      const sourceUrl = this.getPreferredSourceUrl(sourceImage);
      if (!sourceUrl) {
        continue;
      }

      let asset: GeneratedImageAssetResult | null = null;
      if (payload.generationMode === 'AI_GENERATE') {
        try {
          asset = await this.generateAndStoreAiExpandedAsset({
            productId: product.id,
            category: 'portrait_main',
            slotIndex,
            sourceImageId: sourceImage.id,
            sourceUrl,
          });
        } catch (error) {
          this.logger.warn(
            `[portrait_main slot ${slotIndex}] AI 扩图失败，回退到传统裁切: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (!asset) {
        asset = await this.generateAndStoreSmartCropAsset({
          productId: product.id,
          category: 'portrait_main',
          slotIndex,
          sourceImageId: sourceImage.id,
          sourceUrl,
        });
      }
      results.push(asset);
    }

    await this.saveAssets(product.id, 'portrait_main', results);
    return results;
  }

  private async generateLongMainImage(
    product: ProductWithMedia,
    payload: ImageCenterTaskPayload,
    options?: {
      isCancelled?: () => Promise<boolean>;
    },
  ) {
    await this.ensureNotCancelled(options?.isCancelled);
    const selectedSource = this.pickLongMainSource(product, payload);
    if (!selectedSource?.sourceUrl) {
      throw new Error('未找到可用原始图片，无法生成宝贝长图');
    }

    await this.clearCategoryAssets(product.id, 'long_main');
    let asset;
    if (
      payload.generationMode === 'AI_COMPOSE' &&
      payload.modelImageUrl
    ) {
      try {
        asset = await this.aiComposeLongMain(
          product.id,
          selectedSource.sourceUrl,
          payload.modelImageUrl,
        );
        if (!asset) {
          throw new Error('宝贝长图 AI 合成失败');
        }
        return [asset];
      } catch (error) {
        this.logger.warn(
          `[long_main] AI 合成失败，回退到传统裁切: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (
      payload.generationMode === 'AI_GENERATE' ||
      payload.generationMode === 'AI_COMPOSE'
    ) {
      try {
        asset = await this.generateAndStoreAiExpandedAsset({
          productId: product.id,
          category: 'long_main',
          slotIndex: 0,
          sourceImageId: selectedSource.sourceImageId,
          sourceUrl: selectedSource.sourceUrl,
          generationMode: payload.generationMode,
        });
      } catch (error) {
        this.logger.warn(
          `[long_main] AI 扩图失败，回退到传统裁切: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (!asset) {
      asset = await this.generateAndStoreExpandedAsset({
        productId: product.id,
        category: 'long_main',
        slotIndex: 0,
        sourceImageId: selectedSource.sourceImageId,
        sourceUrl: selectedSource.sourceUrl,
      });
    }
    await this.saveAssets(product.id, 'long_main', [asset]);
    return [asset];
  }

  async generateDetailImages(
    product: ProductWithMedia,
    payload: ImageCenterTaskPayload,
    options?: {
      isCancelled?: () => Promise<boolean>;
    },
  ) {
    const sourceImages = this.pickSourceProductImages(
      product.images,
      product.images.length,
      payload.sourceImageId,
    );
    if (!sourceImages.length) {
      throw new Error('未找到可用详情图，无法生成详情图片区图片');
    }

    await this.clearCategoryAssets(product.id, 'detail');
    const results: GeneratedImageAssetResult[] = [];

    for (let index = 0; index < sourceImages.length; index += 1) {
      await this.ensureNotCancelled(options?.isCancelled);
      const sourceImage = sourceImages[index];
      const sourceUrl = this.getPreferredSourceUrl(sourceImage);
      if (!sourceUrl) {
        continue;
      }
      const asset = await this.generateAndStoreSourceAsset({
        productId: product.id,
        category: 'detail',
        slotIndex: index,
        sourceImageId: sourceImage.id,
        sourceUrl,
      });
      results.push(asset);
    }

    await this.saveAssets(product.id, 'detail', results);
    return results;
  }

  async generateSkuImages(
    product: ProductWithMedia,
    payload: ImageCenterTaskPayload,
    options?: {
      isCancelled?: () => Promise<boolean>;
    },
  ) {
    const allSourceSkus = this.pickSourceSkus(product.skus);
    const sourceSkuEntries = payload.sourceSkuCode
      ? allSourceSkus
          .map((sku, slotIndex) => ({ sku, slotIndex }))
          .filter((entry) => entry.sku.skuCode === payload.sourceSkuCode)
      : allSourceSkus.map((sku, slotIndex) => ({ sku, slotIndex }));

    if (!sourceSkuEntries.length) {
      throw new Error('未找到可用 SKU 图片，无法生成 SKU 图');
    }

    if (payload.sourceSkuCode) {
      await this.clearCategoryAssetsBySourceSku(
        product.id,
        'sku',
        payload.sourceSkuCode,
      );
    } else {
      await this.clearCategoryAssets(product.id, 'sku');
    }
    const results: GeneratedImageAssetResult[] = [];

    for (const { sku, slotIndex } of sourceSkuEntries) {
      await this.ensureNotCancelled(options?.isCancelled);
      if (!sku.imageUrl) {
        continue;
      }

      const asset = await this.generateAndStoreSourceAsset({
        productId: product.id,
        category: 'sku',
        slotIndex: slotIndex >= 0 ? slotIndex : 0,
        sourceSkuCode: sku.skuCode,
        sourceUrl: sku.imageUrl,
      });
      results.push(asset);
    }

    await this.saveAssets(product.id, 'sku', results);
    return results;
  }

  private async generateSizeChart(
    product: ProductWithMedia,
    _payload: ImageCenterTaskPayload,
    options?: {
      isCancelled?: () => Promise<boolean>;
    },
  ) {
    await this.ensureNotCancelled(options?.isCancelled);
    const sizeChart = await this.sizeChartService.generateSizeChartPng(
      product.processedSizeInfo,
      product.sizeInfo,
    );
    await this.clearCategoryAssets(product.id, 'size_chart');
    if (!sizeChart) {
      return [];
    }

    const target = IMAGE_CATEGORY_TARGETS.size_chart;
    const storageKey = this.buildStorageKey(
      product.id,
      'size_chart',
      0,
      target.format,
    );
    const stored = await this.imageCenterStorageService.uploadBuffer(
      storageKey,
      sizeChart.buffer,
      sizeChart.mimeType,
    );

    const asset: GeneratedImageAssetResult = {
      category: 'size_chart',
      slotIndex: 0,
      storageKey: stored.storageKey,
      imageUrl: stored.imageUrl,
      mimeType: sizeChart.mimeType,
      width: sizeChart.width,
      height: sizeChart.height,
      fileSize: sizeChart.buffer.byteLength,
      metadata: {
        generator: 'svg-size-chart',
        headers: sizeChart.headers,
        rows: sizeChart.rows,
      },
    };

    await this.saveAssets(product.id, 'size_chart', [asset]);
    return [asset];
  }

  async generateSizeChartFromTable(
    productId: number,
    headers: string[],
    rows: string[][],
  ): Promise<GeneratedImageAssetResult | null> {
    const sizeChart =
      await this.sizeChartService.generateSizeChartFromTable(headers, rows);
    if (!sizeChart) {
      return null;
    }

    await this.clearCategoryAssets(productId, 'size_chart');

    const target = IMAGE_CATEGORY_TARGETS.size_chart;
    const storageKey = this.buildStorageKey(
      productId,
      'size_chart',
      0,
      target.format,
    );
    const stored = await this.imageCenterStorageService.uploadBuffer(
      storageKey,
      sizeChart.buffer,
      sizeChart.mimeType,
    );

    const asset: GeneratedImageAssetResult = {
      category: 'size_chart',
      slotIndex: 0,
      storageKey: stored.storageKey,
      imageUrl: stored.imageUrl,
      mimeType: sizeChart.mimeType,
      width: sizeChart.width,
      height: sizeChart.height,
      fileSize: sizeChart.buffer.byteLength,
      metadata: {
        generator: 'svg-size-chart',
        mode: 'custom-table',
        headers: sizeChart.headers,
        rows: sizeChart.rows,
      },
    };

    await this.saveAssets(productId, 'size_chart', [asset]);
    return asset;
  }

  private async generateAndStoreAsset(input: {
    productId: number;
    category: ImageCenterCategory;
    slotIndex: number;
    sourceUrl: string;
    prompt: string;
    seed?: number;
    uniqueKeySuffix?: string;
    sourceImageId?: number;
    sourceSkuCode?: string;
  }): Promise<GeneratedImageAssetResult> {
    const target = IMAGE_CATEGORY_TARGETS[input.category];
    const size = `${target.width}x${target.height}`;
    this.logger.log(
      `[AI生成] category=${input.category}, slot=${input.slotIndex}, size=${size}, source=${input.sourceUrl.slice(0, 80)}`,
    );
    const agnes = await this.agnesImageService.editImage({
      sourceImages: [input.sourceUrl],
      prompt: input.prompt,
      size,
      model: 'agnes-image-2.0-flash',
      seed: input.seed,
    });
    const generatedBuffer = await this.agnesImageService.downloadGeneratedImage(
      agnes.imageUrl,
    );
    const processed = await this.normalizeOutput(
      generatedBuffer,
      target.width,
      target.height,
      target.format,
    );
    const storageKey = this.buildStorageKey(
      input.productId,
      input.category,
      input.slotIndex,
      target.format,
      input.uniqueKeySuffix,
    );
    const stored = await this.imageCenterStorageService.uploadBuffer(
      storageKey,
      processed.buffer,
      processed.mimeType,
    );

    return {
      category: input.category,
      slotIndex: input.slotIndex,
      storageKey: stored.storageKey,
      imageUrl: stored.imageUrl,
      mimeType: processed.mimeType,
      width: processed.width,
      height: processed.height,
      fileSize: processed.buffer.byteLength,
      sourceImageId: input.sourceImageId ?? null,
      sourceSkuCode: input.sourceSkuCode ?? null,
      sourceUrl: input.sourceUrl,
      metadata: {
        agnesSourceUrl: agnes.imageUrl,
        seed: input.seed ?? null,
      },
    };
  }

  private async generateAndStoreCroppedAsset(input: {
    productId: number;
    category: ImageCenterCategory;
    slotIndex: number;
    sourceUrl: string;
    sourceImageId?: number;
    sourceSkuCode?: string;
  }): Promise<GeneratedImageAssetResult> {
    const target = IMAGE_CATEGORY_TARGETS[input.category];
    const sourceImage = await this.downloadSourceImage(input.sourceUrl);
    const processed = await this.processTraditionalMainImage(
      sourceImage,
      target.width,
      target.height,
      target.format,
    );
    const storageKey = this.buildStorageKey(
      input.productId,
      input.category,
      input.slotIndex,
      target.format,
    );
    const stored = await this.imageCenterStorageService.uploadBuffer(
      storageKey,
      processed.buffer,
      processed.mimeType,
    );

    return {
      category: input.category,
      slotIndex: input.slotIndex,
      storageKey: stored.storageKey,
      imageUrl: stored.imageUrl,
      mimeType: processed.mimeType,
      width: processed.width,
      height: processed.height,
      fileSize: processed.buffer.byteLength,
      sourceImageId: input.sourceImageId ?? null,
      sourceSkuCode: input.sourceSkuCode ?? null,
      sourceUrl: input.sourceUrl,
      metadata: {
        original_image: input.sourceUrl,
        square_image: input.category === 'square_main' ? stored.imageUrl : '',
        portrait_image:
          input.category === 'portrait_main' ? stored.imageUrl : '',
        process_mode: processed.processMode,
        subject_bbox: processed.subjectBBox,
        output_width: processed.width,
        output_height: processed.height,
        background: processed.background,
        generator: 'traditional-safe-main-image',
      },
    };
  }

  private async generateAndStoreSmartCropAsset(input: {
    productId: number;
    category: SmartCropCategory;
    slotIndex: number;
    sourceUrl: string;
    sourceImageId?: number;
    sourceSkuCode?: string;
  }): Promise<GeneratedImageAssetResult> {
    const sourceImage = await this.downloadSourceImage(input.sourceUrl);
    const result: SmartCropResult = await this.smartCropService.processImage(
      sourceImage.buffer,
      input.category,
      `image-${input.sourceImageId ?? 'unknown'}`,
    );
    const extension = result.outputMimeType === 'image/png' ? 'png' : 'jpg';
    const storageKey = this.buildStorageKey(
      input.productId,
      input.category,
      input.slotIndex,
      extension,
      `${Date.now()}`,
    );
    const stored = await this.imageCenterStorageService.uploadBuffer(
      storageKey,
      result.outputBuffer,
      result.outputMimeType,
    );

    return {
      category: input.category,
      slotIndex: input.slotIndex,
      storageKey: stored.storageKey,
      imageUrl: stored.imageUrl,
      mimeType: result.outputMimeType,
      width: result.targetWidth,
      height: result.targetHeight,
      fileSize: result.outputBuffer.byteLength,
      sourceImageId: input.sourceImageId ?? null,
      sourceSkuCode: input.sourceSkuCode ?? null,
      sourceUrl: input.sourceUrl,
      metadata: {
        original_image: input.sourceUrl,
        process_mode: 'smart_crop',
        originalWidth: result.originalWidth,
        originalHeight: result.originalHeight,
        cropX: result.cropX,
        cropY: result.cropY,
        cropWidth: result.cropWidth,
        cropHeight: result.cropHeight,
        upscaled: result.upscaled,
        usedFallback: result.usedFallback,
        score: result.score,
        detectedBoxes: result.detectedBoxes,
        generator: 'smart-crop-main-image',
      },
    };
  }

  private async generateAndStoreExpandedAsset(input: {
    productId: number;
    category: 'square_main' | 'portrait_main' | 'long_main';
    slotIndex: number;
    sourceUrl: string;
    sourceImageId?: number;
    sourceSkuCode?: string;
  }): Promise<GeneratedImageAssetResult> {
    const target = IMAGE_CATEGORY_TARGETS[input.category];
    const sourceImage = await this.downloadSourceImage(input.sourceUrl);
    const processed = await this.processExpandedMainImage(
      sourceImage,
      target.width,
      target.height,
      target.format,
    );
    const storageKey = this.buildStorageKey(
      input.productId,
      input.category,
      input.slotIndex,
      target.format,
    );
    const stored = await this.imageCenterStorageService.uploadBuffer(
      storageKey,
      processed.buffer,
      processed.mimeType,
    );

    return {
      category: input.category,
      slotIndex: input.slotIndex,
      storageKey: stored.storageKey,
      imageUrl: stored.imageUrl,
      mimeType: processed.mimeType,
      width: processed.width,
      height: processed.height,
      fileSize: processed.buffer.byteLength,
      sourceImageId: input.sourceImageId ?? null,
      sourceSkuCode: input.sourceSkuCode ?? null,
      sourceUrl: input.sourceUrl,
      metadata: {
        original_image: input.sourceUrl,
        square_image: input.category === 'square_main' ? stored.imageUrl : '',
        portrait_image:
          input.category === 'portrait_main' ? stored.imageUrl : '',
        process_mode: processed.processMode,
        subject_bbox: processed.subjectBBox,
        output_width: processed.width,
        output_height: processed.height,
        background: processed.background,
        generator: 'context-fill-main-image',
      },
    };
  }

  private async generateAndStoreWhiteProductSquareAsset(input: {
    productId: number;
    slotIndex: number;
    sourceUrl: string;
    sourceImageId?: number;
    sourceSkuCode?: string;
  }): Promise<GeneratedImageAssetResult> {
    const target = IMAGE_CATEGORY_TARGETS.square_main;
    const sourceImage = await this.downloadSourceImage(input.sourceUrl);
    const processed = await this.buildWhiteProductSquareImage(
      sourceImage,
      target.width,
      target.height,
      target.format,
    );
    const storageKey = this.buildStorageKey(
      input.productId,
      'square_main',
      input.slotIndex,
      target.format,
    );
    const stored = await this.imageCenterStorageService.uploadBuffer(
      storageKey,
      processed.buffer,
      processed.mimeType,
    );

    return {
      category: 'square_main',
      slotIndex: input.slotIndex,
      storageKey: stored.storageKey,
      imageUrl: stored.imageUrl,
      mimeType: processed.mimeType,
      width: processed.width,
      height: processed.height,
      fileSize: processed.buffer.byteLength,
      sourceImageId: input.sourceImageId ?? null,
      sourceSkuCode: input.sourceSkuCode ?? null,
      sourceUrl: input.sourceUrl,
      metadata: {
        original_image: input.sourceUrl,
        square_image: stored.imageUrl,
        portrait_image: '',
        process_mode: 'background_expand',
        subject_bbox: processed.subjectBBox,
        output_width: processed.width,
        output_height: processed.height,
        background: '#ffffff',
        generator: 'square-white-product',
      },
    };
  }

  private async generateAndStoreAiWhiteProductSquareAsset(input: {
    productId: number;
    slotIndex: number;
    sourceUrl: string;
    sourceImageId?: number;
    sourceSkuCode?: string;
  }): Promise<GeneratedImageAssetResult> {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const prompt = await this.modelPromptService.getPromptValue(
      SQUARE_MAIN_WHITE_PROMPT_KEY,
    );
    const asset = await this.generateAndStoreAsset({
      productId: input.productId,
      category: 'square_main',
      slotIndex: input.slotIndex,
      sourceUrl: input.sourceUrl,
      sourceImageId: input.sourceImageId,
      sourceSkuCode: input.sourceSkuCode,
      seed,
      uniqueKeySuffix: `${Date.now()}-${seed}`,
      prompt,
    });

    return {
      ...asset,
      metadata: {
        ...(asset.metadata || {}),
        generator: 'agnes-ai-white-product',
      },
    };
  }

  private async generateAndStoreAiExpandedAsset(input: {
    productId: number;
    category: 'square_main' | 'portrait_main' | 'long_main';
    slotIndex: number;
    sourceUrl: string;
    sourceImageId?: number;
    sourceSkuCode?: string;
    generationMode?: 'AI_GENERATE' | 'AI_COMPOSE';
  }): Promise<GeneratedImageAssetResult> {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    let prompt = '';
    if (input.category === 'square_main') {
      prompt = await this.modelPromptService.getPromptValue(
        SQUARE_MAIN_EXPAND_PROMPT_KEY,
      );
    } else if (input.category === 'portrait_main') {
      prompt = await this.modelPromptService.getPromptValue(
        PORTRAIT_MAIN_EXPAND_PROMPT_KEY,
      );
    } else {
      prompt = input.generationMode === 'AI_COMPOSE'
        ? await this.modelPromptService.getPromptValue(LONG_MAIN_COMPOSE_PROMPT_KEY)
        : await this.modelPromptService.getPromptValue(LONG_MAIN_PROMPT_KEY);
    }
    const asset = await this.generateAndStoreAsset({
      productId: input.productId,
      category: input.category,
      slotIndex: input.slotIndex,
      sourceUrl: input.sourceUrl,
      sourceImageId: input.sourceImageId,
      sourceSkuCode: input.sourceSkuCode,
      seed,
      uniqueKeySuffix: `${Date.now()}-${seed}`,
      prompt,
    });

    return {
      ...asset,
      metadata: {
        ...(asset.metadata || {}),
        generator: 'agnes-ai-expanded-main-image',
      },
    };
  }

  async aiComposeLongMain(
    productId: number,
    productImageUrl: string,
    modelImageUrl: string,
  ): Promise<GeneratedImageAssetResult | null> {
    const target = IMAGE_CATEGORY_TARGETS.long_main;
    const size = `${target.width}x${target.height}`;
    const seed = Math.floor(Math.random() * 1_000_000_000);

    const prompt = await this.modelPromptService.getPromptValue(
      LONG_MAIN_COMPOSE_PROMPT_KEY,
    );

    // 严格保证顺序：商品图在前，模特图在后
    const agnes = await this.agnesImageService.editImage({
      sourceImages: [productImageUrl, modelImageUrl],
      prompt,
      size,
      model: 'agnes-image-2.0-flash',
      seed,
    });

    const generatedBuffer =
      await this.agnesImageService.downloadGeneratedImage(agnes.imageUrl);
    const processed = await this.normalizeOutput(
      generatedBuffer,
      target.width,
      target.height,
      target.format,
    );

    const uniqueKeySuffix = `${Date.now()}-${seed}`;
    const storageKey = this.buildStorageKey(
      productId,
      'long_main',
      0,
      target.format,
      uniqueKeySuffix,
    );
    const stored = await this.imageCenterStorageService.uploadBuffer(
      storageKey,
      processed.buffer,
      processed.mimeType,
    );

    const asset: GeneratedImageAssetResult = {
      category: 'long_main',
      slotIndex: 0,
      storageKey: stored.storageKey,
      imageUrl: stored.imageUrl,
      mimeType: processed.mimeType,
      width: processed.width,
      height: processed.height,
      fileSize: processed.buffer.byteLength,
      sourceUrl: productImageUrl,
      metadata: {
        generator: 'agnes-ai-long-main-compose',
        seed,
        sourceImages: [productImageUrl, modelImageUrl],
      },
    };

    await this.clearCategoryAssets(productId, 'long_main');
    await this.saveAssets(productId, 'long_main', [asset]);
    return asset;
  }

  private async generateAndStoreSkuLongCollageSquareAsset(input: {
    productId: number;
    slotIndex: number;
    rightSourceUrl: string;
    rightSourceImageId?: number;
    skuSources: Array<{
      sourceUrl: string;
      sourceSkuCode?: string;
    }>;
  }): Promise<GeneratedImageAssetResult> {
    const target = IMAGE_CATEGORY_TARGETS.square_main;
    const processed = await this.buildSkuLongCollageSquareImage(
      input.skuSources,
      input.rightSourceUrl,
      target.width,
      target.height,
      target.format,
    );
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const uniqueKeySuffix = `${Date.now()}-${seed}`;
    const storageKey = this.buildStorageKey(
      input.productId,
      'square_main',
      input.slotIndex,
      target.format,
      uniqueKeySuffix,
    );
    const stored = await this.imageCenterStorageService.uploadBuffer(
      storageKey,
      processed.buffer,
      processed.mimeType,
    );

    return {
      category: 'square_main',
      slotIndex: input.slotIndex,
      storageKey: stored.storageKey,
      imageUrl: stored.imageUrl,
      mimeType: processed.mimeType,
      width: processed.width,
      height: processed.height,
      fileSize: processed.buffer.byteLength,
      sourceImageId: input.rightSourceImageId ?? null,
      sourceUrl: input.rightSourceUrl,
      metadata: {
        original_image: input.rightSourceUrl,
        square_image: stored.imageUrl,
        portrait_image: '',
        process_mode: 'background_expand',
        subject_bbox: null,
        output_width: processed.width,
        output_height: processed.height,
        background: '#ffffff',
        generator: 'square-sku-long-collage',
        collage_sku_count: input.skuSources.length,
      },
    };
  }

  private async generateAndStoreSourceAsset(input: {
    productId: number;
    category: ImageCenterCategory;
    slotIndex: number;
    sourceUrl: string;
    sourceImageId?: number;
    sourceSkuCode?: string;
    uniqueKeySuffix?: string;
  }): Promise<GeneratedImageAssetResult> {
    const sourceImage = await this.downloadSourceImage(input.sourceUrl);
    const extension = this.resolveExtension(
      sourceImage.mimeType,
      sourceImage.format,
    );
    const storageKey = this.buildStorageKey(
      input.productId,
      input.category,
      input.slotIndex,
      extension,
      input.uniqueKeySuffix,
    );
    const stored = await this.imageCenterStorageService.uploadBuffer(
      storageKey,
      sourceImage.buffer,
      sourceImage.mimeType,
    );

    return {
      category: input.category,
      slotIndex: input.slotIndex,
      storageKey: stored.storageKey,
      imageUrl: stored.imageUrl,
      mimeType: sourceImage.mimeType,
      width: sourceImage.width,
      height: sourceImage.height,
      fileSize: sourceImage.buffer.byteLength,
      sourceImageId: input.sourceImageId ?? null,
      sourceSkuCode: input.sourceSkuCode ?? null,
      sourceUrl: input.sourceUrl,
      metadata: {
        generator: 'source-original',
      },
    };
  }

  private async normalizeOutput(
    buffer: Buffer,
    width: number,
    height: number,
    format: 'jpg' | 'png',
  ) {
    const pipeline = sharp(buffer).rotate().resize(width, height, {
      fit: 'contain',
      background: '#ffffff',
      withoutEnlargement: false,
    });

    const outputBuffer =
      format === 'png'
        ? await pipeline.png().toBuffer()
        : await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    const metadata = await sharp(outputBuffer).metadata();

    return {
      buffer: outputBuffer,
      width: metadata.width ?? width,
      height: metadata.height ?? height,
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
    };
  }

  private async processTraditionalMainImage(
    sourceImage: DownloadedSourceImage,
    width: number,
    height: number,
    format: 'jpg' | 'png',
  ): Promise<MainImageProcessOutput & { mimeType: string }> {
    const rotatedBuffer = await sharp(sourceImage.buffer).rotate().toBuffer();
    const rotatedMetadata = await sharp(rotatedBuffer).metadata();
    const imageWidth = rotatedMetadata.width ?? sourceImage.width ?? width;
    const imageHeight = rotatedMetadata.height ?? sourceImage.height ?? height;
    const background = await this.detectImageBackground(rotatedBuffer);
    const subjectBBox = await this.detectSubjectBoundingBox(
      rotatedBuffer,
      imageWidth,
      imageHeight,
      background,
    );
    const targetAspectRatio = width / height;
    const cropRect = this.computeSafeCropRect(
      subjectBBox,
      imageWidth,
      imageHeight,
      targetAspectRatio,
    );

    const outputBuffer = cropRect
      ? await this.buildCropMainImage(
          rotatedBuffer,
          cropRect,
          width,
          height,
          format,
        )
      : await this.buildBackgroundExpandedMainImage(
          rotatedBuffer,
          subjectBBox,
          imageWidth,
          imageHeight,
          width,
          height,
          format,
        );
    const outputMetadata = await sharp(outputBuffer).metadata();

    return {
      buffer: outputBuffer,
      width: outputMetadata.width ?? width,
      height: outputMetadata.height ?? height,
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
      processMode: cropRect ? 'crop' : 'background_expand',
      subjectBBox,
      background,
    };
  }

  private async buildWhiteProductSquareImage(
    sourceImage: DownloadedSourceImage,
    width: number,
    height: number,
    format: 'jpg' | 'png',
  ) {
    const rotatedBuffer = await sharp(sourceImage.buffer).rotate().toBuffer();
    const rotatedMetadata = await sharp(rotatedBuffer).metadata();
    const imageWidth = rotatedMetadata.width ?? sourceImage.width ?? width;
    const imageHeight = rotatedMetadata.height ?? sourceImage.height ?? height;
    const background = await this.detectImageBackground(rotatedBuffer);
    const subjectBBox = await this.detectSubjectBoundingBox(
      rotatedBuffer,
      imageWidth,
      imageHeight,
      background,
    );
    const foregroundRect = this.expandRect(
      {
        left: subjectBBox.left,
        top: subjectBBox.top,
        width: subjectBBox.width,
        height: subjectBBox.height,
      },
      imageWidth,
      imageHeight,
      0.06,
      0.08,
    );

    const foregroundBuffer = await sharp(rotatedBuffer)
      .extract(foregroundRect)
      .resize(width, height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();

    const output = sharp({
      create: {
        width,
        height,
        channels: 3,
        background: '#ffffff',
      },
    }).composite([{ input: foregroundBuffer }]);

    const buffer =
      format === 'png'
        ? await output.png().toBuffer()
        : await output.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    const metadata = await sharp(buffer).metadata();

    return {
      buffer,
      width: metadata.width ?? width,
      height: metadata.height ?? height,
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
      subjectBBox,
    };
  }

  private async buildSkuLongCollageSquareImage(
    skuSources: Array<{
      sourceUrl: string;
      sourceSkuCode?: string;
    }>,
    rightSourceUrl: string,
    width: number,
    height: number,
    format: 'jpg' | 'png',
  ) {
    const padding = Math.max(32, Math.round(width * 0.03));
    const innerGap = Math.max(24, Math.round(width * 0.02));
    const leftPanelWidth = Math.floor(width * 0.32);
    const rightPanelWidth = width - leftPanelWidth;

    const maxSkus = Math.min(8, skuSources.length);
    const columns = maxSkus <= 5 ? 1 : 2;
    const rows = Math.ceil(maxSkus / columns);

    const skuInnerPadding = Math.max(8, Math.round(leftPanelWidth * 0.05));
    const totalColumnGap = columns > 1 ? innerGap * (columns - 1) : 0;
    const totalRowGap = rows > 1 ? innerGap * (rows - 1) : 0;
    const skuWidth = Math.floor(
      (leftPanelWidth - skuInnerPadding * 2 - totalColumnGap) / columns,
    );
    const skuHeight = Math.floor(
      (height - skuInnerPadding * 2 - totalRowGap) / rows,
    );

    const composites: sharp.OverlayOptions[] = [];

    for (let index = 0; index < maxSkus; index += 1) {
      const skuSource = skuSources[index];
      try {
        const sourceImage = await this.downloadSourceImage(skuSource.sourceUrl);
        const skuBuffer = await sharp(sourceImage.buffer)
          .rotate()
          .resize(skuWidth, skuHeight, {
            fit: 'contain',
            background: '#ffffff',
            withoutEnlargement: false,
          })
          .png()
          .toBuffer();

        const row = Math.floor(index / columns);
        const col = index % columns;
        const skuLeft = col * (skuWidth + innerGap) + skuInnerPadding;
        const skuTop = row * (skuHeight + innerGap) + skuInnerPadding;

        composites.push({
          input: skuBuffer,
          left: skuLeft,
          top: skuTop,
        });
      } catch {
        continue;
      }
    }

    try {
      const rightImage = await this.downloadSourceImage(rightSourceUrl);
      const rightBuffer = await sharp(rightImage.buffer)
        .rotate()
        .resize(rightPanelWidth, height, {
          fit: 'contain',
          background: '#ffffff',
          withoutEnlargement: false,
        })
        .png()
        .toBuffer();

      composites.push({
        input: rightBuffer,
        left: leftPanelWidth,
        top: 0,
      });
    } catch {
    }

    const output = sharp({
      create: {
        width,
        height,
        channels: 3,
        background: '#ffffff',
      },
    }).composite(composites);

    const buffer =
      format === 'png'
        ? await output.png().toBuffer()
        : await output.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    const metadata = await sharp(buffer).metadata();

    return {
      buffer,
      width: metadata.width ?? width,
      height: metadata.height ?? height,
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
    };
  }

  private async buildCropMainImage(
    buffer: Buffer,
    cropRect: { left: number; top: number; width: number; height: number },
    width: number,
    height: number,
    format: 'jpg' | 'png',
  ) {
    const pipeline = sharp(buffer).extract(cropRect).resize(width, height, {
      fit: 'fill',
      withoutEnlargement: false,
    });

    return format === 'png'
      ? pipeline.png().toBuffer()
      : pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  }

  private async buildBackgroundExpandedMainImage(
    buffer: Buffer,
    subjectBBox: SubjectBoundingBox,
    imageWidth: number,
    imageHeight: number,
    width: number,
    height: number,
    format: 'jpg' | 'png',
  ) {
    const foregroundRect = this.expandRect(
      {
        left: subjectBBox.left,
        top: subjectBBox.top,
        width: subjectBBox.width,
        height: subjectBBox.height,
      },
      imageWidth,
      imageHeight,
      0.12,
      0.14,
    );

    const foregroundBuffer = await sharp(buffer)
      .extract(foregroundRect)
      .resize(width, height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();

    const composited = sharp({
      create: {
        width,
        height,
        channels: 3,
        background: '#ffffff',
      },
    }).composite([{ input: foregroundBuffer }]);

    return format === 'png'
      ? composited.png().toBuffer()
      : composited.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  }

  private async processExpandedMainImage(
    sourceImage: DownloadedSourceImage,
    width: number,
    height: number,
    format: 'jpg' | 'png',
  ): Promise<MainImageProcessOutput & { mimeType: string }> {
    const rotatedBuffer = await sharp(sourceImage.buffer).rotate().toBuffer();
    const rotatedMetadata = await sharp(rotatedBuffer).metadata();
    const imageWidth = rotatedMetadata.width ?? sourceImage.width ?? width;
    const imageHeight = rotatedMetadata.height ?? sourceImage.height ?? height;
    const background = await this.detectImageBackground(rotatedBuffer);
    const subjectBBox = await this.detectSubjectBoundingBox(
      rotatedBuffer,
      imageWidth,
      imageHeight,
      background,
    );
    const outputBuffer = await this.buildContextFilledMainImage(
      rotatedBuffer,
      subjectBBox,
      imageWidth,
      imageHeight,
      width,
      height,
      format,
    );
    const outputMetadata = await sharp(outputBuffer).metadata();

    return {
      buffer: outputBuffer,
      width: outputMetadata.width ?? width,
      height: outputMetadata.height ?? height,
      mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
      processMode: 'background_expand',
      subjectBBox,
      background,
    };
  }

  private async buildContextFilledMainImage(
    buffer: Buffer,
    subjectBBox: SubjectBoundingBox,
    imageWidth: number,
    imageHeight: number,
    width: number,
    height: number,
    format: 'jpg' | 'png',
  ) {
    const blurRadius = Math.max(12, Math.round(Math.min(width, height) / 56));
    const foregroundRect = this.expandRect(
      {
        left: subjectBBox.left,
        top: subjectBBox.top,
        width: subjectBBox.width,
        height: subjectBBox.height,
      },
      imageWidth,
      imageHeight,
      0.12,
      0.14,
    );
    const backgroundBuffer = await sharp(buffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: false,
      })
      .blur(blurRadius)
      .modulate({
        brightness: 1.03,
        saturation: 1.04,
      })
      .png()
      .toBuffer();
    const foregroundBuffer = await sharp(buffer)
      .extract(foregroundRect)
      .resize(width, height, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();
    const composed = sharp(backgroundBuffer).composite([
      { input: foregroundBuffer, left: 0, top: 0 },
    ]);

    return format === 'png'
      ? composed.png().toBuffer()
      : composed.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  }

  private async detectSubjectBoundingBox(
    buffer: Buffer,
    imageWidth: number,
    imageHeight: number,
    background: string,
  ): Promise<SubjectBoundingBox> {
    const sample = sharp(buffer).ensureAlpha().resize(256, 256, {
      fit: 'inside',
      withoutEnlargement: true,
    });
    const { data, info } = await sample
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sampleWidth = info.width;
    const sampleHeight = info.height;
    const channels = info.channels;

    if (!sampleWidth || !sampleHeight || channels < 3) {
      return {
        left: 0,
        top: 0,
        right: imageWidth,
        bottom: imageHeight,
        width: imageWidth,
        height: imageHeight,
      };
    }

    const bg = this.hexToRgb(background);
    const mask = new Uint8Array(sampleWidth * sampleHeight);
    let left = sampleWidth;
    let right = -1;
    let top = sampleHeight;
    let bottom = -1;

    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        const index = (y * sampleWidth + x) * channels;
        const alpha = channels >= 4 ? data[index + 3] : 255;
        if (alpha < 180) {
          continue;
        }

        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const distance = Math.sqrt(
          (r - bg.r) ** 2 + (g - bg.g) ** 2 + (b - bg.b) ** 2,
        );
        const foreground = distance >= 22;

        if (!foreground) {
          continue;
        }

        mask[y * sampleWidth + x] = 1;
      }
    }

    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        if (!mask[y * sampleWidth + x]) {
          continue;
        }

        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }

    if (right < left || bottom < top) {
      return {
        left: 0,
        top: 0,
        right: imageWidth,
        bottom: imageHeight,
        width: imageWidth,
        height: imageHeight,
      };
    }

    const scaleX = imageWidth / sampleWidth;
    const scaleY = imageHeight / sampleHeight;
    const scaledLeft = Math.max(0, Math.floor(left * scaleX));
    const scaledTop = Math.max(0, Math.floor(top * scaleY));
    const scaledRight = Math.min(imageWidth, Math.ceil((right + 1) * scaleX));
    const scaledBottom = Math.min(
      imageHeight,
      Math.ceil((bottom + 1) * scaleY),
    );
    const bboxWidth = Math.max(1, scaledRight - scaledLeft);
    const bboxHeight = Math.max(1, scaledBottom - scaledTop);
    const expanded = this.expandRect(
      {
        left: scaledLeft,
        top: scaledTop,
        width: bboxWidth,
        height: bboxHeight,
      },
      imageWidth,
      imageHeight,
      0.04,
      0.04,
    );

    return {
      left: expanded.left,
      top: expanded.top,
      right: expanded.left + expanded.width,
      bottom: expanded.top + expanded.height,
      width: expanded.width,
      height: expanded.height,
    };
  }

  private computeSafeCropRect(
    subjectBBox: SubjectBoundingBox,
    imageWidth: number,
    imageHeight: number,
    targetAspectRatio: number,
  ) {
    const padded = this.expandRect(
      {
        left: subjectBBox.left,
        top: subjectBBox.top,
        width: subjectBBox.width,
        height: subjectBBox.height,
      },
      imageWidth,
      imageHeight,
      0.08,
      0.1,
    );

    let cropWidth = padded.width;
    let cropHeight = padded.height;
    const currentAspectRatio = cropWidth / cropHeight;

    if (currentAspectRatio > targetAspectRatio) {
      cropHeight = cropWidth / targetAspectRatio;
    } else {
      cropWidth = cropHeight * targetAspectRatio;
    }

    if (cropWidth > imageWidth || cropHeight > imageHeight) {
      return null;
    }

    const centerX = padded.left + padded.width / 2;
    const centerY = padded.top + padded.height / 2;
    let left = Math.round(centerX - cropWidth / 2);
    let top = Math.round(centerY - cropHeight / 2);

    left = Math.max(0, Math.min(left, imageWidth - Math.round(cropWidth)));
    top = Math.max(0, Math.min(top, imageHeight - Math.round(cropHeight)));

    const widthInt = Math.min(imageWidth - left, Math.round(cropWidth));
    const heightInt = Math.min(imageHeight - top, Math.round(cropHeight));
    const right = left + widthInt;
    const bottom = top + heightInt;

    if (
      left > subjectBBox.left ||
      top > subjectBBox.top ||
      right < subjectBBox.right ||
      bottom < subjectBBox.bottom
    ) {
      return null;
    }

    return {
      left,
      top,
      width: widthInt,
      height: heightInt,
    };
  }

  private expandRect(
    rect: { left: number; top: number; width: number; height: number },
    maxWidth: number,
    maxHeight: number,
    ratioX: number,
    ratioY: number,
  ) {
    const padX = Math.max(12, Math.round(rect.width * ratioX));
    const padY = Math.max(12, Math.round(rect.height * ratioY));
    const left = Math.max(0, rect.left - padX);
    const top = Math.max(0, rect.top - padY);
    const right = Math.min(maxWidth, rect.left + rect.width + padX);
    const bottom = Math.min(maxHeight, rect.top + rect.height + padY);

    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  }

  private async detectImageBackground(buffer: Buffer) {
    try {
      const sample = sharp(buffer).rotate().ensureAlpha().resize(64, 64, {
        fit: 'inside',
        withoutEnlargement: true,
      });
      const { data, info } = await sample
        .raw()
        .toBuffer({ resolveWithObject: true });
      const channels = info.channels;
      const width = info.width;
      const height = info.height;

      if (!width || !height || channels < 3) {
        return '#ffffff';
      }

      const edgeBandX = Math.max(2, Math.round(width * 0.08));
      const edgeBandY = Math.max(2, Math.round(height * 0.08));
      const candidates: Array<{
        r: number;
        g: number;
        b: number;
        score: number;
      }> = [];

      const pushPixel = (x: number, y: number) => {
        const index = (y * width + x) * channels;
        const alpha = channels >= 4 ? data[index + 3] : 255;
        if (alpha < 200) {
          return;
        }

        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max;
        const brightness = (r + g + b) / 3;
        const score = (1 - saturation) * 0.7 + (brightness / 255) * 0.3;

        candidates.push({ r, g, b, score });
      };

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (
            x < edgeBandX ||
            x >= width - edgeBandX ||
            y < edgeBandY ||
            y >= height - edgeBandY
          ) {
            pushPixel(x, y);
          }
        }
      }

      if (!candidates.length) {
        return '#ffffff';
      }

      candidates.sort((left, right) => right.score - left.score);
      const sampleSize = Math.max(12, Math.floor(candidates.length * 0.2));
      const selected = candidates.slice(0, sampleSize);

      const totals = selected.reduce(
        (result, pixel) => {
          result.r += pixel.r;
          result.g += pixel.g;
          result.b += pixel.b;
          return result;
        },
        { r: 0, g: 0, b: 0 },
      );

      const toHex = (value: number) =>
        Math.max(0, Math.min(255, Math.round(value)))
          .toString(16)
          .padStart(2, '0');
      const r = totals.r / selected.length;
      const g = totals.g / selected.length;
      const b = totals.b / selected.length;

      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    } catch {
      return '#ffffff';
    }
  }

  private hexToRgb(hex: string) {
    const normalized = hex.replace('#', '');
    const safe = normalized.length === 6 ? normalized : 'ffffff';

    return {
      r: Number.parseInt(safe.slice(0, 2), 16),
      g: Number.parseInt(safe.slice(2, 4), 16),
      b: Number.parseInt(safe.slice(4, 6), 16),
    };
  }

  private async downloadSourceImage(sourceUrl: string) {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`读取源图片失败: ${response.status} ${sourceUrl}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const metadata = await sharp(buffer).metadata();
    const mimeType =
      response.headers.get('content-type')?.split(';')[0]?.trim() ||
      this.resolveMimeType(metadata.format);

    return {
      buffer,
      mimeType,
      format: metadata.format || null,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
    };
  }

  private async getSquareMainSpecialSources(
    product: ProductWithMedia,
    payload: ImageCenterTaskPayload,
  ): Promise<SquareMainSpecialSources> {
    const sourceSkus = this.pickSourceSkus(product.skus).filter(
      (sku) => sku.imageUrl,
    );
    const skuAssets = await this.prismaService.productGeneratedImage.findMany({
      where: {
        productId: product.id,
        category: 'sku',
        status: 'SUCCESS',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        sourceSkuCode: true,
        imageUrl: true,
      },
    });
    const latestSkuAssetMap = new Map<string, string>();
    for (const asset of skuAssets) {
      if (
        !asset.sourceSkuCode ||
        !asset.imageUrl ||
        latestSkuAssetMap.has(asset.sourceSkuCode)
      ) {
        continue;
      }

      latestSkuAssetMap.set(asset.sourceSkuCode, asset.imageUrl);
    }
    const skuCandidates = sourceSkus.map((sku) => ({
      sourceUrl: latestSkuAssetMap.get(sku.skuCode) || (sku.imageUrl as string),
      sourceSkuCode: sku.skuCode,
    }));
    const preferredProductImages = this.pickSourceProductImages(
      product.images,
      5,
      payload.sourceImageId,
    );
    const defaultProductImages = this.pickSourceProductImages(
      product.images,
      5,
    );
    const fallbackProductImage =
      preferredProductImages[0] ?? defaultProductImages[0] ?? null;

    const whiteProductSource =
      payload.targetSlot === 0 && payload.sourceUrl
        ? {
            sourceUrl: payload.sourceUrl,
            sourceImageId: payload.sourceImageId,
            sourceSkuCode: payload.sourceSkuCode,
          }
        : (skuCandidates[0] ??
          (fallbackProductImage
            ? {
                sourceUrl: this.getPreferredSourceUrl(
                  fallbackProductImage,
                ) as string,
                sourceImageId: fallbackProductImage.id,
              }
            : null));

    const longMainAsset =
      await this.prismaService.productGeneratedImage.findFirst({
        where: {
          productId: product.id,
          category: 'long_main',
          status: 'SUCCESS',
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          imageUrl: true,
        },
      });

    const collageRightSource = longMainAsset?.imageUrl
      ? payload.targetSlot === 1 && payload.sourceUrl
        ? {
            sourceUrl: payload.sourceUrl,
            sourceImageId: payload.sourceImageId,
          }
        : {
            sourceUrl: longMainAsset.imageUrl,
          }
      : payload.targetSlot === 1 && payload.sourceUrl
        ? {
            sourceUrl: payload.sourceUrl,
            sourceImageId: payload.sourceImageId,
          }
        : fallbackProductImage
          ? {
              sourceUrl: this.getPreferredSourceUrl(
                fallbackProductImage,
              ) as string,
              sourceImageId: fallbackProductImage.id,
            }
          : null;

    return {
      whiteProductSource,
      collageRightSource,
      collageSkuSources: skuCandidates,
    };
  }

  private resolveExtension(mimeType: string, format: string | null) {
    if (mimeType === 'image/png' || format === 'png') {
      return 'png';
    }

    if (mimeType === 'image/webp' || format === 'webp') {
      return 'webp';
    }

    if (mimeType === 'image/gif' || format === 'gif') {
      return 'gif';
    }

    return 'jpg';
  }

  private resolveMimeType(format?: string | null) {
    switch (format) {
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      default:
        return 'image/jpeg';
    }
  }

  private async ensureNotCancelled(isCancelled?: () => Promise<boolean>) {
    if (!isCancelled) {
      return;
    }

    if (await isCancelled()) {
      throw new Error('商品已删除，图片处理任务已终止');
    }
  }

  private pickSourceProductImages(
    images: ProductImage[],
    maxCount: number,
    sourceImageId?: number,
  ) {
    const filtered = sourceImageId
      ? images.filter((image) => image.id === sourceImageId)
      : images;
    return filtered
      .filter((image) => Boolean(image.originalImageUrl || image.imageUrl))
      .slice(0, maxCount);
  }

  private pickLongMainSource(
    product: ProductWithMedia,
    payload: ImageCenterTaskPayload,
  ) {
    if (payload.sourceUrl) {
      return {
        sourceImageId: payload.sourceImageId,
        sourceUrl: payload.sourceUrl,
      };
    }

    const sourceImages = this.pickSourceProductImages(
      product.images,
      product.images.length,
      payload.sourceImageId,
    );
    if (!sourceImages.length) {
      return null;
    }

    const sourceImage =
      payload.sourceImageId || sourceImages.length === 1
        ? sourceImages[0]
        : sourceImages[Math.floor(Math.random() * sourceImages.length)];
    const sourceUrl = this.getPreferredSourceUrl(sourceImage);
    if (!sourceUrl) {
      return null;
    }

    return {
      sourceImageId: sourceImage.id,
      sourceUrl,
    };
  }

  private getPreferredSourceUrl(image: ProductImage) {
    return image.imageUrl || image.originalImageUrl || null;
  }

  private pickSourceSkus(skus: ProductSku[], sourceSkuCode?: string) {
    const filtered = sourceSkuCode
      ? skus.filter((sku) => sku.skuCode === sourceSkuCode)
      : skus;
    const deduped: ProductSku[] = [];
    const seen = new Set<string>();

    for (const sku of filtered) {
      if (!sku.imageUrl) {
        continue;
      }

      const key = `${sku.color || sku.name || sku.skuCode}__${sku.imageUrl}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      deduped.push(sku);
    }

    return deduped;
  }

  private buildStorageKey(
    productId: number,
    category: ImageCenterCategory,
    slotIndex: number,
    extension: string,
    uniqueSuffix?: string,
  ) {
    const suffix = uniqueSuffix ? `-${uniqueSuffix}` : '';
    return `product-${productId}/${category}/${slotIndex}${suffix}.${extension}`;
  }

  private async clearCategoryAssets(
    productId: number,
    category: ImageCenterCategory,
    targetSlot?: number,
  ) {
    const existing = await this.prismaService.productGeneratedImage.findMany({
      where: {
        productId,
        category,
        ...(targetSlot !== undefined ? { slotIndex: targetSlot } : {}),
      },
    });

    for (const asset of existing) {
      await this.imageCenterStorageService.deleteObject(asset.storageKey);
    }

    await this.prismaService.productGeneratedImage.deleteMany({
      where: {
        productId,
        category,
        ...(targetSlot !== undefined ? { slotIndex: targetSlot } : {}),
      },
    });
  }

  private async clearCategoryAssetsBySourceSku(
    productId: number,
    category: ImageCenterCategory,
    sourceSkuCode: string,
  ) {
    const existing = await this.prismaService.productGeneratedImage.findMany({
      where: {
        productId,
        category,
        sourceSkuCode,
      },
    });

    for (const asset of existing) {
      await this.imageCenterStorageService.deleteObject(asset.storageKey);
    }

    await this.prismaService.productGeneratedImage.deleteMany({
      where: {
        productId,
        category,
        sourceSkuCode,
      },
    });
  }

  private async saveAssets(
    productId: number,
    category: ImageCenterCategory,
    assets: GeneratedImageAssetResult[],
  ) {
    for (const asset of assets) {
      await this.prismaService.productGeneratedImage.create({
        data: this.buildGeneratedImageCreateData(productId, category, asset),
      });
    }
  }

  private buildGeneratedImageCreateData(
    productId: number,
    category: ImageCenterCategory,
    asset: GeneratedImageAssetResult,
  ): Prisma.ProductGeneratedImageUncheckedCreateInput {
    return {
      productId,
      sourceImageId: asset.sourceImageId ?? null,
      category,
      slotIndex: asset.slotIndex,
      sourceType: asset.sourceSkuCode
        ? 'SKU_IMAGE'
        : category === 'size_chart'
          ? 'SIZE_DATA'
          : 'PRODUCT_IMAGE',
      sourceUrl: asset.sourceUrl ?? null,
      sourceSkuCode: asset.sourceSkuCode ?? null,
      storageKey: asset.storageKey,
      imageUrl: asset.imageUrl,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize,
      isDefault: Boolean(asset.isDefault),
      sortOrder: asset.slotIndex,
      status: 'SUCCESS',
      error: null,
      metadata: asset.metadata
        ? (asset.metadata as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    };
  }
}
