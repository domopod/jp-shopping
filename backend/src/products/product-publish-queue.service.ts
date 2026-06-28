import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductPublishProcessorService, CaptchaPausedError } from './product-publish-processor.service';
import { PUBLISH_CHECKPOINTS, PUBLISH_STATUSES } from './product-publish.constants';
import type { TaobaoPublishResult } from './products.types';

@Injectable()
export class ProductPublishQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProductPublishQueueService.name);
  private readonly pollIntervalMs = 2000;
  private readonly retryDelayMs = 5000;
  private readonly lockTimeoutMs = 10 * 60 * 1000;
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly productPublishProcessorService: ProductPublishProcessorService,
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
    await this.prismaService.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          publishStatus: PUBLISH_STATUSES.QUEUED,
          publishError: null,
          publishCheckpoint: PUBLISH_CHECKPOINTS.PREPARE,
        },
      });

      await tx.productPublishTask.upsert({
        where: { productId },
        create: {
          productId,
          status: PUBLISH_STATUSES.QUEUED,
          checkpoint: PUBLISH_CHECKPOINTS.PREPARE,
          attemptCount: 0,
          maxAttempts: 3,
          availableAt: new Date(),
          lockedAt: null,
          lastError: null,
          latestLogPath: null,
          latestScreenshotPath: null,
          publishResult: Prisma.JsonNull,
          finishedAt: null,
        },
        update: {
          status: PUBLISH_STATUSES.QUEUED,
          checkpoint: PUBLISH_CHECKPOINTS.PREPARE,
          availableAt: new Date(),
          lockedAt: null,
          lastError: null,
          finishedAt: null,
        },
      });
    });

    void this.processNextTask();
  }

  async enqueueBatch(productIds: number[]) {
    for (const productId of productIds) {
      await this.enqueue(productId);
    }

    return {
      success: true,
      count: productIds.length,
      productIds,
    };
  }

  async retry(productId: number) {
    await this.prismaService.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          publishStatus: PUBLISH_STATUSES.QUEUED,
          publishError: null,
        },
      });

      await tx.productPublishTask.upsert({
        where: { productId },
        create: {
          productId,
          status: PUBLISH_STATUSES.QUEUED,
          checkpoint: PUBLISH_CHECKPOINTS.PREPARE,
          attemptCount: 0,
          maxAttempts: 3,
          availableAt: new Date(),
        },
        update: {
          status: PUBLISH_STATUSES.QUEUED,
          checkpoint: PUBLISH_CHECKPOINTS.PREPARE,
          attemptCount: 0,
          availableAt: new Date(),
          lockedAt: null,
          lastError: null,
          finishedAt: null,
        },
      });
    });

    void this.processNextTask();
  }

  async resume(productId: number) {
    await this.prismaService.$transaction(async (tx) => {
      const task = await tx.productPublishTask.findUnique({
        where: { productId },
        select: { checkpoint: true },
      });

      await tx.product.update({
        where: { id: productId },
        data: {
          publishStatus: PUBLISH_STATUSES.QUEUED,
          publishError: null,
          publishCheckpoint: task?.checkpoint || PUBLISH_CHECKPOINTS.PREPARE,
        },
      });

      await tx.productPublishTask.upsert({
        where: { productId },
        create: {
          productId,
          status: PUBLISH_STATUSES.QUEUED,
          checkpoint: task?.checkpoint || PUBLISH_CHECKPOINTS.PREPARE,
          attemptCount: 0,
          maxAttempts: 3,
          availableAt: new Date(),
        },
        update: {
          status: PUBLISH_STATUSES.QUEUED,
          availableAt: new Date(),
          lockedAt: null,
          lastError: null,
          finishedAt: null,
        },
      });
    });

    void this.processNextTask();
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
      const result = await this.productPublishProcessorService.processProduct(productId, taskId, attemptCount + 1);
      await this.markSuccess(taskId, productId, attemptCount + 1, result);
    } catch (error) {
      if (error instanceof CaptchaPausedError) {
        await this.markWaitingCaptcha(taskId, productId, error);
        return;
      }

      const message = error instanceof Error ? error.message : '淘宝自动发布失败';
      await this.markFailure(taskId, productId, attemptCount + 1, maxAttempts, message);
    }
  }

  private async claimNextTask() {
    const now = new Date();
    const staleLock = new Date(now.getTime() - this.lockTimeoutMs);
    const task = await this.prismaService.productPublishTask.findFirst({
      where: {
        status: { in: [PUBLISH_STATUSES.QUEUED, PUBLISH_STATUSES.PROCESSING] },
        availableAt: { lte: now },
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleLock } }],
      },
      orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
    });

    if (!task) {
      return null;
    }

    const claimed = await this.prismaService.productPublishTask.updateMany({
      where: {
        id: task.id,
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleLock } }],
      },
      data: {
        status: PUBLISH_STATUSES.PROCESSING,
        lockedAt: now,
      },
    });

    if (!claimed.count) {
      return null;
    }

    await this.prismaService.product.update({
      where: { id: task.productId },
      data: {
        publishStatus: PUBLISH_STATUSES.PROCESSING,
      },
    });

    return task;
  }

  private async markSuccess(taskId: number, productId: number, attemptCount: number, result: TaobaoPublishResult) {
    await this.prismaService.$transaction([
      this.prismaService.product.update({
        where: { id: productId },
        data: {
          status: '已发布',
          publishStatus: PUBLISH_STATUSES.SUCCESS,
          publishError: null,
          publishCheckpoint: result.checkpoint,
          publishResult: result as unknown as Prisma.InputJsonValue,
          taobaoProductId: result.taobaoProductId,
          publishLogPath: result.artifacts.logPath,
          publishScreenshotPath: result.artifacts.screenshotPath,
          publishedAt: new Date(result.publishedAt),
        },
      }),
      this.prismaService.productPublishTask.update({
        where: { id: taskId },
        data: {
          status: PUBLISH_STATUSES.SUCCESS,
          checkpoint: result.checkpoint,
          attemptCount,
          lockedAt: null,
          lastError: null,
          latestLogPath: result.artifacts.logPath,
          latestScreenshotPath: result.artifacts.screenshotPath,
          publishResult: result as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(result.publishedAt),
        },
      }),
    ]);
  }

  private async markWaitingCaptcha(taskId: number, productId: number, error: CaptchaPausedError) {
    await this.prismaService.$transaction([
      this.prismaService.product.update({
        where: { id: productId },
        data: {
          publishStatus: PUBLISH_STATUSES.WAITING_CAPTCHA,
          publishError: error.message,
          publishCheckpoint: error.checkpoint,
          publishScreenshotPath: error.artifactPath,
        },
      }),
      this.prismaService.productPublishTask.update({
        where: { id: taskId },
        data: {
          status: PUBLISH_STATUSES.WAITING_CAPTCHA,
          checkpoint: error.checkpoint,
          lockedAt: null,
          lastError: error.message,
          latestScreenshotPath: error.artifactPath,
        },
      }),
    ]);
  }

  private async markFailure(
    taskId: number,
    productId: number,
    attemptCount: number,
    maxAttempts: number,
    rawErrorMessage: string,
  ) {
    const parsed = this.parseStructuredError(rawErrorMessage);
    const exhausted = attemptCount >= maxAttempts;

    await this.prismaService.$transaction([
      this.prismaService.product.update({
        where: { id: productId },
        data: {
          status: exhausted ? '失败' : '草稿',
          publishStatus: exhausted ? PUBLISH_STATUSES.FAILED : PUBLISH_STATUSES.QUEUED,
          publishError: parsed.message,
          publishLogPath: parsed.logPath,
          publishScreenshotPath: parsed.screenshotPath,
        },
      }),
      this.prismaService.productPublishTask.update({
        where: { id: taskId },
        data: {
          status: exhausted ? PUBLISH_STATUSES.FAILED : PUBLISH_STATUSES.QUEUED,
          attemptCount,
          lockedAt: null,
          lastError: parsed.message,
          latestLogPath: parsed.logPath,
          latestScreenshotPath: parsed.screenshotPath,
          availableAt: exhausted ? new Date() : new Date(Date.now() + this.retryDelayMs),
          finishedAt: exhausted ? new Date() : null,
        },
      }),
    ]);

    this.logger.error(`商品 ${productId} 淘宝发布失败: ${parsed.message}`);
  }

  private parseStructuredError(rawErrorMessage: string) {
    try {
      const parsed = JSON.parse(rawErrorMessage) as {
        message?: string;
        logPath?: string | null;
        screenshotPath?: string | null;
      };

      return {
        message: parsed.message || rawErrorMessage,
        logPath: parsed.logPath || null,
        screenshotPath: parsed.screenshotPath || null,
      };
    } catch {
      return {
        message: rawErrorMessage,
        logPath: null,
        screenshotPath: null,
      };
    }
  }
}
