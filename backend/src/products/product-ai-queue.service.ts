import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductAiProcessorService } from './product-ai-processor.service';
import type { ProcessedProductResult } from './products.types';

const PROCESSING_STATUS = 'PROCESSING';
const SUCCESS_STATUS = 'SUCCESS';
const FAILED_STATUS = 'FAILED';

@Injectable()
export class ProductAiQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProductAiQueueService.name);
  private readonly pollIntervalMs = 1500;
  private readonly retryDelayMs = 3000;
  private readonly lockTimeoutMs = 60_000;
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly productAiProcessorService: ProductAiProcessorService,
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

  async enqueue(productId: number) {
    await this.prismaService.$transaction([
      this.prismaService.product.update({
        where: { id: productId },
        data: {
          aiProcessStatus: PROCESSING_STATUS,
          aiProcessError: null,
          aiProcessedAt: null,
        },
      }),
      this.prismaService.productProcessingTask.upsert({
        where: { productId },
        create: {
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
          availableAt: new Date(),
          lockedAt: null,
          lastError: null,
          finishedAt: null,
        },
      }),
    ]);
  }

  async retry(productId: number) {
    await this.processImmediately(productId);
  }

  async processImmediately(productId: number) {
    const task = await this.prepareImmediateTask(productId);
    await this.runTask(task.id, task.productId, task.attemptCount, task.maxAttempts);
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

      await this.runTask(task.id, task.productId, task.attemptCount, task.maxAttempts);
    } finally {
      this.polling = false;
    }
  }

  private async runTask(taskId: number, productId: number, attemptCount: number, maxAttempts: number) {
    try {
      const processed = await this.productAiProcessorService.processProduct(productId);
      await this.markSuccess(taskId, productId, processed);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 处理失败';
      await this.markFailure(taskId, productId, attemptCount + 1, maxAttempts, message);
    }
  }

  private async claimNextTask() {
    const now = new Date();
    const staleLock = new Date(now.getTime() - this.lockTimeoutMs);
    const candidate = await this.prismaService.productProcessingTask.findFirst({
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

    const claimed = await this.prismaService.productProcessingTask.updateMany({
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

  async prepareImmediateTask(productId: number) {
    const now = new Date();
    const task = await this.prismaService.productProcessingTask.upsert({
      where: { productId },
      create: {
        productId,
        status: PROCESSING_STATUS,
        attemptCount: 0,
        maxAttempts: 3,
        availableAt: now,
        lockedAt: now,
        lastError: null,
        finishedAt: null,
      },
      update: {
        status: PROCESSING_STATUS,
        attemptCount: 0,
        availableAt: now,
        lockedAt: now,
        lastError: null,
        finishedAt: null,
      },
    });

    await this.prismaService.product.update({
      where: { id: productId },
      data: {
        aiProcessStatus: PROCESSING_STATUS,
        aiProcessError: null,
        aiProcessedAt: null,
      },
    });

    return task;
  }

  private async claimSpecificTask(productId: number) {
    const now = new Date();
    const staleLock = new Date(now.getTime() - this.lockTimeoutMs);
    const candidate = await this.prismaService.productProcessingTask.findUnique({
      where: { productId },
    });

    if (
      !candidate ||
      candidate.status !== PROCESSING_STATUS ||
      candidate.availableAt > now ||
      (candidate.lockedAt && candidate.lockedAt >= staleLock)
    ) {
      return null;
    }

    const claimed = await this.prismaService.productProcessingTask.updateMany({
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

  private async markSuccess(taskId: number, productId: number, processed: ProcessedProductResult) {
    await this.prismaService.$transaction([
      this.prismaService.product.update({
        where: { id: productId },
        data: {
          processedTitle: processed.title,
          processedDescription: processed.descriptionText,
          processedDescriptionHtml: processed.descriptionHtml,
          processedSizeInfo: processed.sizeInfo,
          processedSpecification: processed.specification,
          aiSellingPoints: processed.sellingPoints as unknown as Prisma.InputJsonValue,
          aiAttributes: processed.attributes as unknown as Prisma.InputJsonValue,
          taobaoPayload: processed.taobaoPayload as unknown as Prisma.InputJsonValue,
          aiProcessStatus: SUCCESS_STATUS,
          aiProcessError: null,
          aiProcessedAt: new Date(),
        },
      }),
      this.prismaService.productSku.deleteMany({
        where: { productId },
      }),
      this.prismaService.productSku.createMany({
        data: processed.skus.map((sku) => ({
          productId,
          skuCode: sku.skuCode,
          name: sku.name,
          color: sku.color,
          size: sku.size,
          price: sku.price,
          imageUrl: sku.imageUrl,
        })),
      }),
      this.prismaService.productProcessingTask.update({
        where: { id: taskId },
        data: {
          status: SUCCESS_STATUS,
          lockedAt: null,
          lastError: null,
          finishedAt: new Date(),
        },
      }),
    ]);
  }

  private async markFailure(
    taskId: number,
    productId: number,
    attemptCount: number,
    maxAttempts: number,
    errorMessage: string,
  ) {
    const exhausted = attemptCount >= maxAttempts;
    await this.prismaService.$transaction([
      this.prismaService.product.update({
        where: { id: productId },
        data: {
          aiProcessStatus: exhausted ? FAILED_STATUS : PROCESSING_STATUS,
          aiProcessError: errorMessage,
        },
      }),
      this.prismaService.productProcessingTask.update({
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

    this.logger.error(`商品 ${productId} AI 处理失败: ${errorMessage}`);
  }
}
