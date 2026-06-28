import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type ProductGeneratedImage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ImageCenterStorageService } from './image-center-storage.service';
import { SmartCropService, type SmartCropResult } from './smart-crop.service';
import {
  SMART_CROP_TARGETS,
  type SmartCropCategory,
} from './smart-crop.constants';

export interface SmartCropImageItem {
  id: number;
  imageUrl: string;
  sourceImageUrl?: string;
  sourceSkuCode?: string | null;
  targetSlot?: number | null;
}

export interface ManualCropImageItem extends SmartCropImageItem {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface SmartCropTaskResult {
  taskId: number;
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  message?: string;
  assets: Array<{
    imageId: number;
    storageKey?: string;
    imageUrl?: string;
    error?: string;
    width?: number;
    height?: number;
  }>;
}

@Injectable()
export class SmartCropQueueService {
  private readonly logger = new Logger(SmartCropQueueService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly smartCropService: SmartCropService,
    private readonly imageCenterStorageService: ImageCenterStorageService,
  ) {}

  /**
   * 发起一批图片的智能裁切任务（异步处理）
   */
  async enqueueBatch(
    productId: number,
    category: SmartCropCategory,
    images: SmartCropImageItem[],
  ): Promise<{ taskId: number; total: number }> {
    const task = await this.prismaService.productImageGenerationTask.create({
      data: {
        productId,
        taskType: 'SMART_CROP',
        category,
        status: 'PROCESSING',
        progress: 0,
        payload: {
          category,
          images: images.map((img) => ({
            id: img.id,
            imageUrl: img.imageUrl,
            sourceImageUrl: img.sourceImageUrl ?? null,
            sourceSkuCode: img.sourceSkuCode ?? null,
            targetSlot: img.targetSlot ?? null,
          })),
          target: SMART_CROP_TARGETS[category],
        } as unknown as Prisma.JsonObject,
      },
    });

    // 异步执行（不阻塞 API 响应）
    void this.processTask(task.id, productId, category, images);

    return { taskId: task.id, total: images.length };
  }

  /**
   * 同步处理：单张或多张图片的即时裁切（用于前端点击"裁切图片"按钮）
   */
  async processImagesImmediately(
    productId: number,
    category: SmartCropCategory,
    images: SmartCropImageItem[],
  ): Promise<{
    assets: ProductGeneratedImage[];
    warnings: string[];
    meta: Array<{
      imageId: number;
      originalWidth: number;
      originalHeight: number;
      targetWidth: number;
      targetHeight: number;
      upscaled: boolean;
      usedFallback: boolean;
      score: number;
    }>;
  }> {
    const warnings: string[] = [];
    const createdAssets: ProductGeneratedImage[] = [];
    const meta: Array<{
      imageId: number;
      originalWidth: number;
      originalHeight: number;
      targetWidth: number;
      targetHeight: number;
      upscaled: boolean;
      usedFallback: boolean;
      score: number;
    }> = [];

    for (const img of images) {
      try {
        const buffer = await this.fetchImageBuffer(img.imageUrl);
        const result: SmartCropResult = await this.smartCropService.processImage(
          buffer,
          category,
          `image-${img.id}`,
        );

        const slotIndex =
          typeof img.targetSlot === 'number' && !Number.isNaN(img.targetSlot)
            ? img.targetSlot
            : null;

        const storageKey = this.buildStorageKey(
          productId,
          category,
          img.id,
          result.outputMimeType,
        );
        const stored = await this.imageCenterStorageService.uploadBuffer(
          storageKey,
          result.outputBuffer,
          result.outputMimeType,
        );

        // 清理同一 productId + category + slotIndex 的旧资产（可选：仅当targetSlot有效时清理）
        if (slotIndex !== null) {
          const existingAssets =
            await this.prismaService.productGeneratedImage.findMany({
              where: {
                productId,
                category,
                slotIndex,
              },
              select: { id: true, storageKey: true },
            });

          for (const oldAsset of existingAssets) {
            try {
              await this.imageCenterStorageService.deleteObject(oldAsset.storageKey);
            } catch {
              // 删除存储对象失败不影响流程
            }
          }

          if (existingAssets.length > 0) {
            await this.prismaService.productGeneratedImage.deleteMany({
              where: {
                productId,
                category,
                slotIndex,
              },
            });
          }
        }

        const asset = await this.prismaService.productGeneratedImage.create({
          data: {
            productId,
            category,
            slotIndex,
            sortOrder: slotIndex ?? 0,
            sourceImageId: img.id,
            sourceUrl: img.imageUrl,
            sourceSkuCode: img.sourceSkuCode ?? null,
            storageKey: stored.storageKey,
            imageUrl: stored.imageUrl,
            mimeType: result.outputMimeType,
            width: result.targetWidth,
            height: result.targetHeight,
            fileSize: result.outputSize,
            status: 'SUCCESS',
            metadata: {
              originalWidth: result.originalWidth,
              originalHeight: result.originalHeight,
              cropX: result.cropX,
              cropY: result.cropY,
              cropWidth: result.cropWidth,
              cropHeight: result.cropHeight,
              upscaled: result.upscaled,
              usedFallback: result.usedFallback,
              score: result.score,
              warnings: result.warnings,
              detectedBoxes: result.detectedBoxes.map((b) => ({
                label: b.label,
                weight: b.weight,
                confidence: b.confidence ?? null,
              })),
            } as unknown as Prisma.JsonObject,
          },
        });

        createdAssets.push(asset);
        meta.push({
          imageId: img.id,
          originalWidth: result.originalWidth,
          originalHeight: result.originalHeight,
          targetWidth: result.targetWidth,
          targetHeight: result.targetHeight,
          upscaled: result.upscaled,
          usedFallback: result.usedFallback,
          score: result.score,
        });

        if (result.warnings.length) {
          warnings.push(`图片 #${img.id}: ${result.warnings.join('；')}`);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `智能裁切失败 [product=${productId}, category=${category}, imageId=${img.id}]: ${message}`,
        );
        warnings.push(`图片 #${img.id} 裁切失败: ${message}`);
      }
    }

    return { assets: createdAssets, warnings, meta };
  }

  /**
   * 同步处理：手动裁切单张图片（根据用户指定的 offset 和 scale）
   */
  async processManualCropImmediately(
    productId: number,
    category: SmartCropCategory,
    images: ManualCropImageItem[],
  ): Promise<{
    assets: ProductGeneratedImage[];
    warnings: string[];
    meta: Array<{
      imageId: number;
      originalWidth: number;
      originalHeight: number;
      targetWidth: number;
      targetHeight: number;
      offsetX: number;
      offsetY: number;
      scale: number;
    }>;
  }> {
    const warnings: string[] = [];
    const createdAssets: ProductGeneratedImage[] = [];
    const meta: Array<{
      imageId: number;
      originalWidth: number;
      originalHeight: number;
      targetWidth: number;
      targetHeight: number;
      offsetX: number;
      offsetY: number;
      scale: number;
    }> = [];

    for (const img of images) {
      try {
        const buffer = await this.fetchImageBuffer(img.imageUrl);
        const result = await this.smartCropService.processImageManual(
          buffer,
          category,
          {
            offsetX: img.offsetX,
            offsetY: img.offsetY,
            scale: img.scale,
          },
          `image-${img.id}`,
        );

        const slotIndex =
          typeof img.targetSlot === 'number' && !Number.isNaN(img.targetSlot)
            ? img.targetSlot
            : null;

        const storageKey = this.buildStorageKey(
          productId,
          category,
          img.id,
          result.outputMimeType,
        );
        const stored = await this.imageCenterStorageService.uploadBuffer(
          storageKey,
          result.outputBuffer,
          result.outputMimeType,
        );

        // 清理同一 productId + category + slotIndex 的旧资产
        if (slotIndex !== null) {
          const existingAssets =
            await this.prismaService.productGeneratedImage.findMany({
              where: {
                productId,
                category,
                slotIndex,
              },
              select: { id: true, storageKey: true },
            });

          for (const oldAsset of existingAssets) {
            try {
              await this.imageCenterStorageService.deleteObject(oldAsset.storageKey);
            } catch {
              // 忽略删除失败
            }
          }

          if (existingAssets.length > 0) {
            await this.prismaService.productGeneratedImage.deleteMany({
              where: {
                productId,
                category,
                slotIndex,
              },
            });
          }
        }

        const asset = await this.prismaService.productGeneratedImage.create({
          data: {
            productId,
            category,
            slotIndex,
            sortOrder: slotIndex ?? 0,
            sourceImageId: img.id,
            sourceUrl: img.imageUrl,
            sourceSkuCode: img.sourceSkuCode ?? null,
            storageKey: stored.storageKey,
            imageUrl: stored.imageUrl,
            mimeType: result.outputMimeType,
            width: result.targetWidth,
            height: result.targetHeight,
            fileSize: result.outputSize,
            status: 'SUCCESS',
            metadata: {
              generator: 'manual-crop',
              originalWidth: result.originalWidth,
              originalHeight: result.originalHeight,
              offsetX: img.offsetX,
              offsetY: img.offsetY,
              scale: img.scale,
              cropX: result.cropX,
              cropY: result.cropY,
              cropWidth: result.cropWidth,
              cropHeight: result.cropHeight,
              warnings: result.warnings,
            } as unknown as Prisma.JsonObject,
          },
        });

        createdAssets.push(asset);
        meta.push({
          imageId: img.id,
          originalWidth: result.originalWidth,
          originalHeight: result.originalHeight,
          targetWidth: result.targetWidth,
          targetHeight: result.targetHeight,
          offsetX: img.offsetX,
          offsetY: img.offsetY,
          scale: img.scale,
        });

        if (result.warnings.length) {
          warnings.push(`图片 #${img.id}: ${result.warnings.join('；')}`);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `手动裁切失败 [product=${productId}, category=${category}, imageId=${img.id}]: ${message}`,
        );
        warnings.push(`图片 #${img.id} 裁切失败: ${message}`);
      }
    }

    return { assets: createdAssets, warnings, meta };
  }

  /**
   * 查询任务状态（前端用）
   */
  async getTaskStatus(taskId: number): Promise<SmartCropTaskResult | null> {
    const task = await this.prismaService.productImageGenerationTask.findUnique({
      where: { id: taskId },
    });
    if (!task) return null;

    const payload = (task.payload as unknown as {
      images?: Array<{ id: number; imageUrl: string }>;
    }) ?? { images: [] };
    const result = (task.result as unknown as {
      processed?: number;
      succeeded?: number;
      failed?: number;
      assets?: SmartCropTaskResult['assets'];
    }) ?? {};

    return {
      taskId: task.id,
      status: task.status as 'PROCESSING' | 'SUCCESS' | 'FAILED',
      total: payload.images?.length ?? 0,
      processed: result.processed ?? 0,
      succeeded: result.succeeded ?? 0,
      failed: result.failed ?? 0,
      message: task.lastError ?? undefined,
      assets: result.assets ?? [],
    };
  }

  /**
   * 异步任务处理（后台执行，不阻塞 API）
   */
  private async processTask(
    taskId: number,
    productId: number,
    category: SmartCropCategory,
    images: SmartCropImageItem[],
  ): Promise<void> {
    const assets: SmartCropTaskResult['assets'] = [];
    let succeeded = 0;
    let failed = 0;

    try {
      for (const img of images) {
        try {
          const buffer = await this.fetchImageBuffer(img.imageUrl);
          const result = await this.smartCropService.processImage(
            buffer,
            category,
            `image-${img.id}`,
          );

          const storageKey = this.buildStorageKey(
            productId,
            category,
            img.id,
            result.outputMimeType,
          );
          const stored = await this.imageCenterStorageService.uploadBuffer(
            storageKey,
            result.outputBuffer,
            result.outputMimeType,
          );

          await this.prismaService.productGeneratedImage.create({
            data: {
              productId,
              category,
              slotIndex: img.targetSlot ?? undefined,
              sourceImageId: img.id,
              sourceUrl: img.imageUrl,
              sourceSkuCode: img.sourceSkuCode ?? null,
              storageKey: stored.storageKey,
              imageUrl: stored.imageUrl,
              mimeType: result.outputMimeType,
              width: result.targetWidth,
              height: result.targetHeight,
              fileSize: result.outputSize,
              status: 'SUCCESS',
              metadata: {
                originalWidth: result.originalWidth,
                originalHeight: result.originalHeight,
                cropX: result.cropX,
                cropY: result.cropY,
                cropWidth: result.cropWidth,
                cropHeight: result.cropHeight,
                upscaled: result.upscaled,
                usedFallback: result.usedFallback,
                score: result.score,
              } as unknown as Prisma.JsonObject,
            },
          });

          assets.push({
            imageId: img.id,
            storageKey: stored.storageKey,
            imageUrl: stored.imageUrl,
            width: result.targetWidth,
            height: result.targetHeight,
          });
          succeeded++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          assets.push({ imageId: img.id, error: message });
          failed++;
        }

        await this.prismaService.productImageGenerationTask.update({
          where: { id: taskId },
          data: {
            progress: Math.round(
              ((succeeded + failed) / images.length) * 100,
            ),
            result: {
              processed: succeeded + failed,
              succeeded,
              failed,
              assets,
            } as unknown as Prisma.JsonObject,
          },
        });
      }

      await this.prismaService.productImageGenerationTask.update({
        where: { id: taskId },
        data: {
          status: 'SUCCESS',
          progress: 100,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`智能裁切任务 #${taskId} 失败: ${message}`);
      await this.prismaService.productImageGenerationTask.update({
        where: { id: taskId },
        data: {
          status: 'FAILED',
          lastError: message,
          finishedAt: new Date(),
          result: { processed: succeeded + failed, succeeded, failed, assets } as unknown as Prisma.JsonObject,
        },
      });
    }
  }

  private async fetchImageBuffer(imageUrl: string): Promise<Buffer> {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`下载图片失败 (${response.status}): ${imageUrl}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private buildStorageKey(
    productId: number,
    category: string,
    imageId: number,
    mimeType: string,
  ): string {
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const timestamp = Date.now();
    return `product-${productId}/smart-crop/${category}/image-${imageId}-${timestamp}.${ext}`;
  }
}
