import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductImageProcessorService } from './product-image-processor.service';

const PROCESSING_STATUS = 'PROCESSING';
const SUCCESS_STATUS = 'SUCCESS';
const FAILED_STATUS = 'FAILED';

@Injectable()
export class ProductImageQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProductImageQueueService.name);
  private readonly pollIntervalMs = 1500;
  private readonly retryDelayMs = 3000;
  private readonly lockTimeoutMs = 60_000;
  private timer?: NodeJS.Timeout;
  private polling = false;
  private readonly cancelledProductIds = new Set<number>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly productImageProcessorService: ProductImageProcessorService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    this.timer = setInterval(() => {
      void this.processNextTask();
    }, this.pollIntervalMs);

    void this.processNextTask();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async enqueueProductImages(productId: number, imageIds?: number[]) {
    const targetImageIds =
      imageIds && imageIds.length
        ? imageIds
        : (
            await this.prismaService.productImage.findMany({
              where: { productId },
              select: { id: true },
            })
          ).map((image) => image.id);

    if (!targetImageIds.length) {
      await this.prismaService.product.update({
        where: { id: productId },
        data: {
          imageProcessStatus: SUCCESS_STATUS,
          imageProcessError: null,
          imageProcessedAt: new Date(),
        },
      });
      return;
    }

    await this.prismaService.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          imageProcessStatus: PROCESSING_STATUS,
          imageProcessError: null,
          imageProcessedAt: null,
        },
      });

      await tx.productImage.updateMany({
        where: { id: { in: targetImageIds } },
        data: {
          processStatus: PROCESSING_STATUS,
          processError: null,
          processedAt: null,
        },
      });

      for (const imageId of targetImageIds) {
        await tx.productImageProcessingTask.upsert({
          where: { imageId },
          create: {
            imageId,
            productId,
            status: PROCESSING_STATUS,
            attemptCount: 0,
            maxAttempts: 3,
            availableAt: new Date(),
            lockedAt: null,
            lastError: null,
            finishedAt: null,
          },
          update: {
            status: PROCESSING_STATUS,
            attemptCount: 0,
            maxAttempts: 3,
            availableAt: new Date(),
            lockedAt: null,
            lastError: null,
            finishedAt: null,
          },
        });
      }
    });

    void this.processNextTask();
  }

  async retryProductImages(productId: number) {
    await this.enqueueProductImages(productId);
  }

  async cancelProductTasks(productId: number) {
    this.cancelledProductIds.add(productId);

    await this.prismaService.productImageProcessingTask.updateMany({
      where: {
        productId,
        status: PROCESSING_STATUS,
      },
      data: {
        lockedAt: null,
        availableAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        lastError: '商品已删除，图片处理任务已终止',
      },
    });
  }

  async processNextTask() {
    if (this.polling) {
      return;
    }

    this.polling = true;
    try {
      const task = await this.claimNextTask();
      if (!task) {
        return;
      }

      await this.runTask(task.id, task.imageId, task.productId, task.attemptCount, task.maxAttempts);
    } finally {
      this.polling = false;
    }
  }

  private async runTask(taskId: number, imageId: number, productId: number, attemptCount: number, maxAttempts: number) {
    if (this.isProductCancelled(productId)) {
      return;
    }

    try {
      const processed = await this.productImageProcessorService.processImage(imageId);
      if (this.isProductCancelled(productId)) {
        return;
      }
      await this.markSuccess(taskId, imageId, productId, processed);
    } catch (error) {
      if (this.isProductCancelled(productId)) {
        return;
      }
      const message = error instanceof Error ? error.message : '商品图片处理失败';
      await this.markFailure(taskId, imageId, productId, attemptCount + 1, maxAttempts, message);
    }
  }

  private async claimNextTask() {
    const now = new Date();
    const staleLock = new Date(now.getTime() - this.lockTimeoutMs);
    const candidate = await this.prismaService.productImageProcessingTask.findFirst({
      where: {
        status: PROCESSING_STATUS,
        availableAt: { lte: now },
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleLock } }],
      },
      orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
    });

    if (!candidate) {
      return null;
    }

    const claimed = await this.prismaService.productImageProcessingTask.updateMany({
      where: {
        id: candidate.id,
        status: PROCESSING_STATUS,
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleLock } }],
      },
      data: {
        lockedAt: now,
      },
    });

    return claimed.count ? candidate : null;
  }

  private async markSuccess(
    taskId: number,
    imageId: number,
    productId: number,
    processed: {
      originalImageUrl: string;
      taobaoMainImageUrl: string;
      taobaoDetailImageUrl: string;
      mimeType: string;
      width: number;
      height: number;
      fileSize: number;
    },
  ) {
    await this.prismaService.$transaction([
      this.prismaService.productImage.update({
        where: { id: imageId },
        data: {
          originalImageUrl: processed.originalImageUrl,
          taobaoMainImageUrl: processed.taobaoMainImageUrl,
          taobaoDetailImageUrl: processed.taobaoDetailImageUrl,
          mimeType: processed.mimeType,
          width: processed.width,
          height: processed.height,
          fileSize: processed.fileSize,
          processStatus: SUCCESS_STATUS,
          processError: null,
          processedAt: new Date(),
        },
      }),
      this.prismaService.productImageProcessingTask.update({
        where: { id: taskId },
        data: {
          status: SUCCESS_STATUS,
          lockedAt: null,
          lastError: null,
          finishedAt: new Date(),
        },
      }),
    ]);

    await this.syncProductProcessStatus(productId);
  }

  private async markFailure(
    taskId: number,
    imageId: number,
    productId: number,
    attemptCount: number,
    maxAttempts: number,
    errorMessage: string,
  ) {
    const exhausted = attemptCount >= maxAttempts;

    await this.prismaService.$transaction([
      this.prismaService.productImage.update({
        where: { id: imageId },
        data: {
          processStatus: exhausted ? FAILED_STATUS : PROCESSING_STATUS,
          processError: errorMessage,
          processedAt: exhausted ? new Date() : null,
        },
      }),
      this.prismaService.productImageProcessingTask.update({
        where: { id: taskId },
        data: {
          status: exhausted ? FAILED_STATUS : PROCESSING_STATUS,
          attemptCount,
          lockedAt: null,
          lastError: errorMessage,
          availableAt: exhausted ? new Date() : new Date(Date.now() + this.retryDelayMs),
          finishedAt: exhausted ? new Date() : null,
        },
      }),
    ]);

    await this.syncProductProcessStatus(productId);
    this.logger.error(`商品 ${productId} 图片 ${imageId} 处理失败: ${errorMessage}`);
  }

  private async syncProductProcessStatus(productId: number) {
    const images = await this.prismaService.productImage.findMany({
      where: { productId },
      select: {
        processStatus: true,
        processError: true,
      },
    });

    if (!images.length) {
      await this.prismaService.product.update({
        where: { id: productId },
        data: {
          imageProcessStatus: SUCCESS_STATUS,
          imageProcessError: null,
          imageProcessedAt: new Date(),
        },
      });
      return;
    }

    const hasFailed = images.some((image) => image.processStatus === FAILED_STATUS);
    const hasProcessing = images.some((image) => image.processStatus === PROCESSING_STATUS);
    const firstError = images.find((image) => image.processError)?.processError ?? null;

    await this.prismaService.product.update({
      where: { id: productId },
      data: {
        imageProcessStatus: hasFailed ? FAILED_STATUS : hasProcessing ? PROCESSING_STATUS : SUCCESS_STATUS,
        imageProcessError: hasFailed ? firstError : null,
        imageProcessedAt: hasFailed || hasProcessing ? null : new Date(),
      },
    });
  }

  private isProductCancelled(productId: number) {
    return this.cancelledProductIds.has(productId);
  }
}
