import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  Prisma,
  type ProductGeneratedImage,
  type ProductImageGenerationTask,
} from '@prisma/client';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { RedisMemoryServer } from 'redis-memory-server';
import { PrismaService } from '../prisma/prisma.service';
import {
  IMAGE_CENTER_QUEUE_NAME,
  IMAGE_CENTER_STATUS,
  IMAGE_CENTER_TASK_STATUS,
} from './image-center.constants';
import { ImageCenterStorageService } from './image-center-storage.service';
import { ConfigService } from '@nestjs/config';
import { ImageCenterProcessorService } from './image-center-processor.service';
import {
  IMAGE_CENTER_CATEGORIES,
  type ImageCenterCategory,
  type ImageCenterTaskPayload,
} from './products.types';

@Injectable()
export class ImageCenterQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImageCenterQueueService.name);
  private readonly retryDelayMs = 5000;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private embeddedRedis: RedisMemoryServer | null = null;
  private localPendingTaskIds: number[] = [];
  private localActiveCount = 0;
  private readonly cancelledProductIds = new Set<number>();
  private readonly cancelledTaskIds = new Set<number>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly imageCenterProcessorService: ImageCenterProcessorService,
    private readonly imageCenterStorageService: ImageCenterStorageService,
  ) {}

  async onModuleInit() {
    let connection: ConnectionOptions | null = null;
    try {
      connection = await this.getQueueConnection();
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.warn(
        `图片中心 Redis 初始化失败，退回本地异步执行模式: ${message}`,
      );
    }

    if (!connection) {
      this.logger.warn('REDIS_URL 未配置，图片生成中心将退回本地异步执行模式');
      await this.recoverLocalPendingTasks();
      return;
    }

    this.queue = new Queue(IMAGE_CENTER_QUEUE_NAME, { connection });
    this.worker = new Worker(
      IMAGE_CENTER_QUEUE_NAME,
      async (job) => {
        const taskId = Number(job.data.taskId);
        await this.processTask(taskId);
      },
      {
        connection,
        concurrency: this.getWorkerConcurrency(),
      },
    );
    this.worker.on('error', (error) => {
      this.logger.error(`图片中心 Worker 运行异常: ${error.message}`);
    });

    if (this.embeddedRedis) {
      await this.recoverRedisPendingTasks();
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.embeddedRedis?.stop();
  }

  async ensureProductImageCenter(productId: number) {
    const [existingAssets, existingTasks] =
      await this.prismaService.$transaction([
        this.prismaService.productGeneratedImage.findMany({
          where: { productId },
          select: { category: true },
        }),
        this.prismaService.productImageGenerationTask.findMany({
          where: { productId },
          select: { category: true },
        }),
      ]);
    const existingCategories = new Set([
      ...existingAssets.map((item) => item.category),
      ...existingTasks.map((item) => item.category),
    ]);

    let createdCount = 0;
    for (const category of IMAGE_CENTER_CATEGORIES) {
      if (existingCategories.has(category)) {
        continue;
      }
      if (category === 'detail' || category === 'sku' || category === 'size_chart') {
        try {
          await this.handleDirectCategory(productId, category);
          createdCount += 1;
        } catch (error) {
          this.logger.error(
            `直接处理 ${category} 图片失败: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        continue;
      }
      await this.enqueueTask({
        productId,
        category,
        taskType: 'AUTO_GENERATE',
        generationMode: category === 'long_main' ? 'AI_GENERATE' : undefined,
      });
      createdCount += 1;
    }

    await this.syncProductStatus(productId);
    return {
      success: true,
      createdCount,
    };
  }

  private async handleDirectCategory(
    productId: number,
    category: 'detail' | 'sku' | 'size_chart',
  ) {
    const taskPayload: ImageCenterTaskPayload = {
      productId,
      category,
      taskType: 'AUTO_GENERATE',
    };
    const task = await this.prismaService.productImageGenerationTask.create({
      data: {
        productId,
        category,
        taskType: 'AUTO_GENERATE',
        status: 'PROCESSING',
        payload: taskPayload as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      const isCancelled = async () => {
        const latest = await this.prismaService.productImageGenerationTask.findUnique({
          where: { id: task.id },
          select: { status: true },
        });
        return latest?.status === 'CANCELLED';
      };

      if (category === 'detail') {
        await this.imageCenterProcessorService.processTask(task.id, {
          productId,
          category: 'detail',
          taskType: 'AUTO_GENERATE',
        }, { isCancelled });
      } else if (category === 'size_chart') {
        await this.imageCenterProcessorService.processTask(task.id, {
          productId,
          category: 'size_chart',
          taskType: 'AUTO_GENERATE',
        }, { isCancelled });
      } else {
        await this.imageCenterProcessorService.processTask(task.id, {
          productId,
          category: 'sku',
          taskType: 'AUTO_GENERATE',
        }, { isCancelled });
      }

      await this.prismaService.productImageGenerationTask.update({
        where: { id: task.id },
        data: { status: 'SUCCESS', finishedAt: new Date() },
      });
    } catch (error) {
      await this.prismaService.productImageGenerationTask.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async regenerateCategory(input: {
    productId: number;
    category: ImageCenterCategory;
    sourceImageId?: number;
    sourceSkuCode?: string;
    sourceUrl?: string;
    targetSlot?: number;
    generationMode?: ImageCenterTaskPayload['generationMode'];
    modelImageUrl?: string;
  }) {
    const existingAssets = await this.prismaService.productGeneratedImage.findMany({
      where: {
        productId: input.productId,
        category: input.category,
        ...(input.targetSlot !== undefined
          ? { slotIndex: input.targetSlot }
          : {}),
        ...(input.sourceSkuCode ? { sourceSkuCode: input.sourceSkuCode } : {}),
      },
    });

    for (const asset of existingAssets) {
      await this.imageCenterStorageService.deleteObject(asset.storageKey);
    }

    await this.prismaService.productGeneratedImage.deleteMany({
      where: {
        productId: input.productId,
        category: input.category,
        ...(input.targetSlot !== undefined
          ? { slotIndex: input.targetSlot }
          : {}),
        ...(input.sourceSkuCode ? { sourceSkuCode: input.sourceSkuCode } : {}),
      },
    });

    if (
      input.category === 'detail' ||
      input.category === 'sku' ||
      input.category === 'size_chart'
    ) {
      const taskPayload: ImageCenterTaskPayload = {
        productId: input.productId,
        category: input.category,
        taskType: 'REGENERATE',
        sourceImageId: input.sourceImageId,
        sourceSkuCode: input.sourceSkuCode,
        sourceUrl: input.sourceUrl,
      };
      const task = await this.prismaService.productImageGenerationTask.create({
        data: {
          productId: input.productId,
          category: input.category,
          taskType: 'REGENERATE',
          status: 'PROCESSING',
          payload: taskPayload as unknown as Prisma.InputJsonValue,
        },
      });

      try {
        const isCancelled = async () => {
          const latest = await this.prismaService.productImageGenerationTask.findUnique({
            where: { id: task.id },
            select: { status: true },
          });
          return latest?.status === 'CANCELLED';
        };

        await this.imageCenterProcessorService.processTask(task.id, {
          productId: input.productId,
          category: input.category,
          taskType: 'REGENERATE',
          sourceImageId: input.sourceImageId,
          sourceSkuCode: input.sourceSkuCode,
          sourceUrl: input.sourceUrl,
        }, { isCancelled });

        await this.prismaService.productImageGenerationTask.update({
          where: { id: task.id },
          data: { status: 'SUCCESS', finishedAt: new Date() },
        });

        await this.syncProductStatus(input.productId);
        return {
          success: true,
          taskId: task.id,
          status: 'SUCCESS',
        };
      } catch (error) {
        await this.prismaService.productImageGenerationTask.update({
          where: { id: task.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            lastError: error instanceof Error ? error.message : String(error),
          },
        });
        await this.syncProductStatus(input.productId);
        return {
          success: false,
          taskId: task.id,
          status: 'FAILED',
        };
      }
    }

    const task = await this.enqueueTask({
      productId: input.productId,
      category: input.category,
      taskType: 'REGENERATE',
      sourceImageId: input.sourceImageId,
      sourceSkuCode: input.sourceSkuCode,
      sourceUrl: input.sourceUrl,
      targetSlot: input.targetSlot,
      generationMode: input.generationMode,
      modelImageUrl: input.modelImageUrl,
    });

    await this.syncProductStatus(input.productId);

    return {
      success: true,
      taskId: task.id,
      status: task.status,
    };
  }

  async retryTask(taskId: number) {
    const task = await this.prismaService.productImageGenerationTask.findUnique(
      {
        where: { id: taskId },
      },
    );

    if (!task) {
      throw new Error('图片生成任务不存在');
    }

    await this.updateTaskIfExists(taskId, {
      status: IMAGE_CENTER_TASK_STATUS.QUEUED,
      lastError: null,
      progress: 0,
    });
    await this.dispatchTask(taskId);
    await this.syncProductStatus(task.productId);
  }

  async cancelMatchingTasks(input: {
    productId: number;
    category: ImageCenterCategory;
    sourceSkuCode?: string;
    targetSlot?: number;
    reason?: string;
  }) {
    const tasks = await this.prismaService.productImageGenerationTask.findMany({
      where: {
        productId: input.productId,
        category: input.category,
        status: {
          in: [
            IMAGE_CENTER_TASK_STATUS.QUEUED,
            IMAGE_CENTER_TASK_STATUS.PROCESSING,
          ],
        },
        ...(input.sourceSkuCode ? { sourceSkuCode: input.sourceSkuCode } : {}),
        ...(input.targetSlot !== undefined
          ? { targetSlot: input.targetSlot }
          : {}),
      },
      select: {
        id: true,
        queueJobId: true,
      },
    });

    if (!tasks.length) {
      return {
        success: true,
        count: 0,
      };
    }

    const cancelledIds = tasks.map((task) => task.id);
    cancelledIds.forEach((taskId) => this.cancelledTaskIds.add(taskId));

    if (this.queue) {
      for (const task of tasks) {
        if (!task.queueJobId) {
          continue;
        }

        const job = await this.queue.getJob(task.queueJobId);
        await job?.remove();
      }
    }

    if (this.localPendingTaskIds.length) {
      const cancelledIdSet = new Set(cancelledIds);
      this.localPendingTaskIds = this.localPendingTaskIds.filter(
        (taskId) => !cancelledIdSet.has(taskId),
      );
    }

    await this.prismaService.productImageGenerationTask.updateMany({
      where: {
        id: { in: cancelledIds },
      },
      data: {
        status: IMAGE_CENTER_TASK_STATUS.FAILED,
        progress: 0,
        lastError: input.reason || '已被手动替换',
        finishedAt: new Date(),
      },
    });

    await this.syncProductStatus(input.productId);
    return {
      success: true,
      count: cancelledIds.length,
    };
  }

  async refreshProductStatus(productId: number) {
    await this.syncProductStatus(productId);
  }

  async listProductTasks(productId: number) {
    return this.prismaService.productImageGenerationTask.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancelProductTasks(productId: number) {
    this.cancelledProductIds.add(productId);

    const tasks = await this.prismaService.productImageGenerationTask.findMany({
      where: {
        productId,
        status: {
          in: [
            IMAGE_CENTER_TASK_STATUS.QUEUED,
            IMAGE_CENTER_TASK_STATUS.PROCESSING,
          ],
        },
      },
      select: {
        id: true,
        queueJobId: true,
      },
    });

    if (this.queue) {
      for (const task of tasks) {
        if (!task.queueJobId) {
          continue;
        }

        try {
          const job = await this.queue.getJob(task.queueJobId);
          if (job) {
            await job.remove();
          }
        } catch (error) {
          this.logger.warn(
            `取消任务 ${task.queueJobId} 失败（可能被 worker 锁定）: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    if (this.localPendingTaskIds.length) {
      const cancelledTaskIds = new Set(tasks.map((task) => task.id));
      this.localPendingTaskIds = this.localPendingTaskIds.filter(
        (taskId) => !cancelledTaskIds.has(taskId),
      );
    }
  }

  async processTask(taskId: number) {
    const task = await this.prismaService.productImageGenerationTask.findUnique(
      {
        where: { id: taskId },
      },
    );
    if (!task) {
      return;
    }

    if (
      this.isProductCancelled(task.productId) ||
      this.isTaskCancelled(taskId)
    ) {
      return;
    }

    const rawPayload = task.payload as unknown as ImageCenterTaskPayload;
    const payload: ImageCenterTaskPayload = {
      productId: rawPayload.productId ?? task.productId,
      category: (rawPayload.category ?? task.category) as ImageCenterCategory,
      taskType: (rawPayload.taskType ?? task.taskType) as ImageCenterTaskPayload['taskType'],
      sourceImageId: rawPayload.sourceImageId,
      sourceSkuCode: rawPayload.sourceSkuCode,
      sourceUrl: rawPayload.sourceUrl,
      targetSlot: rawPayload.targetSlot,
      generationMode: rawPayload.generationMode,
      modelImageUrl: rawPayload.modelImageUrl,
    };
    const started = await this.updateTaskIfExists(taskId, {
      status: IMAGE_CENTER_TASK_STATUS.PROCESSING,
      progress: 10,
    });
    if (!started) {
      return;
    }
    await this.syncProductStatus(task.productId);

    try {
      const result = await this.imageCenterProcessorService.processTask(
        taskId,
        payload,
        {
          isCancelled: async () =>
            this.isProductCancelled(task.productId) ||
            this.isTaskCancelled(taskId),
        },
      );
      if (this.isTaskCancelled(taskId)) {
        throw new Error('已被手动替换');
      }
      await this.updateTaskIfExists(taskId, {
        status: IMAGE_CENTER_TASK_STATUS.SUCCESS,
        progress: 100,
        result: {
          createdAssets: result.length,
          category: payload.category,
        } as Prisma.InputJsonValue,
        finishedAt: new Date(),
        lastError: null,
      });
    } catch (error) {
      const attemptCount = task.attemptCount + 1;
      const cancelled = this.isTaskCancelled(taskId);
      const message = cancelled
        ? '已被手动替换'
        : error instanceof Error
          ? error.message
          : '图片生成失败';
      const exhausted = cancelled || attemptCount >= task.maxAttempts;

      const updated = await this.updateTaskIfExists(taskId, {
        status: exhausted
          ? IMAGE_CENTER_TASK_STATUS.FAILED
          : IMAGE_CENTER_TASK_STATUS.QUEUED,
        attemptCount,
        progress: 0,
        lastError: message,
        finishedAt: exhausted ? new Date() : null,
      });

      if (updated && !exhausted) {
        await this.dispatchTask(
          taskId,
          this.getRetryDelayMs(attemptCount, message),
        );
      }
    }

    await this.syncProductStatus(task.productId);
  }

  private async enqueueTask(payload: ImageCenterTaskPayload) {
    const existingTask = await this.findEquivalentPendingTask(payload);
    if (existingTask) {
      return existingTask;
    }

    const task = await this.prismaService.productImageGenerationTask.create({
      data: {
        productId: payload.productId,
        taskType: payload.taskType,
        category: payload.category,
        status: IMAGE_CENTER_TASK_STATUS.QUEUED,
        sourceImageId: payload.sourceImageId ?? null,
        sourceSkuCode: payload.sourceSkuCode ?? null,
        sourceUrl: payload.sourceUrl ?? null,
        targetSlot: payload.targetSlot ?? null,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });

    await this.markOlderQueuedTasksAsSuperseded(task);
    await this.dispatchTask(task.id);
    return task;
  }

  private async dispatchTask(taskId: number, delay = 0) {
    if (this.queue) {
      const task =
        await this.prismaService.productImageGenerationTask.findUnique({
          where: { id: taskId },
          select: {
            taskType: true,
          },
        });
      const job = await this.queue.add(
        'image-center-task',
        { taskId },
        {
          delay,
          priority: this.getJobPriority(task?.taskType),
          lifo: true,
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );
      await this.updateTaskIfExists(taskId, {
        queueJobId: job.id?.toString() || null,
      });
      return;
    }

    const schedule = async () => {
      await this.enqueueLocalTask(taskId);
      this.processLocalQueue();
    };

    if (delay > 0) {
      setTimeout(() => {
        void schedule();
      }, delay);
      return;
    }

    await schedule();
  }

  private processLocalQueue() {
    while (
      this.localActiveCount < this.getLocalConcurrency() &&
      this.localPendingTaskIds.length
    ) {
      const nextTaskId = this.localPendingTaskIds.shift();
      if (!nextTaskId) {
        continue;
      }

      this.localActiveCount += 1;
      void this.processTask(nextTaskId).finally(() => {
        this.localActiveCount = Math.max(0, this.localActiveCount - 1);
        this.processLocalQueue();
      });
    }
  }

  private async recoverLocalPendingTasks() {
    const pendingTasks =
      await this.prismaService.productImageGenerationTask.findMany({
        where: {
          status: {
            in: [
              IMAGE_CENTER_TASK_STATUS.QUEUED,
              IMAGE_CENTER_TASK_STATUS.PROCESSING,
            ],
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

    if (!pendingTasks.length) {
      return;
    }

    const latestTaskIds = new Set<number>();
    const duplicateTaskIds: number[] = [];
    const seen = new Set<string>();

    for (const task of pendingTasks) {
      const key = `${task.productId}:${task.category}`;
      if (!seen.has(key)) {
        seen.add(key);
        latestTaskIds.add(task.id);
        continue;
      }

      duplicateTaskIds.push(task.id);
    }

    if (duplicateTaskIds.length) {
      await this.prismaService.productImageGenerationTask.updateMany({
        where: {
          id: { in: duplicateTaskIds },
        },
        data: {
          status: IMAGE_CENTER_TASK_STATUS.FAILED,
          progress: 0,
          lastError: '已被较新的同类任务替代',
          finishedAt: new Date(),
        },
      });
    }

    const recoverIds = Array.from(latestTaskIds);
    if (!recoverIds.length) {
      return;
    }

    await this.prismaService.productImageGenerationTask.updateMany({
      where: {
        id: { in: recoverIds },
      },
      data: {
        status: IMAGE_CENTER_TASK_STATUS.QUEUED,
        progress: 0,
        finishedAt: null,
      },
    });

    for (const taskId of recoverIds) {
      await this.dispatchTask(taskId);
    }

    this.logger.log(`已恢复本地图片中心待处理任务: ${recoverIds.length} 个`);
  }

  private async recoverRedisPendingTasks() {
    const pendingTasks =
      await this.prismaService.productImageGenerationTask.findMany({
        where: {
          status: {
            in: [
              IMAGE_CENTER_TASK_STATUS.QUEUED,
              IMAGE_CENTER_TASK_STATUS.PROCESSING,
            ],
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

    if (!pendingTasks.length) {
      return;
    }

    for (const task of [...pendingTasks].reverse()) {
      await this.dispatchTask(task.id);
    }

    this.logger.log(
      `已恢复 Redis 图片中心待处理任务: ${pendingTasks.length} 个`,
    );
  }

  private getRetryDelayMs(attemptCount: number, message: string) {
    if (message.includes('503') || message.includes('超时')) {
      return Math.max(this.retryDelayMs, 30000 * attemptCount);
    }

    return this.retryDelayMs;
  }

  private async enqueueLocalTask(taskId: number) {
    if (this.localPendingTaskIds.includes(taskId)) {
      return;
    }

    const task = await this.prismaService.productImageGenerationTask.findUnique(
      {
        where: { id: taskId },
        select: {
          id: true,
          taskType: true,
          createdAt: true,
        },
      },
    );

    if (!task) {
      return;
    }

    this.localPendingTaskIds.push(task.id);
    this.localPendingTaskIds.sort((leftId, rightId) => {
      if (leftId === rightId) {
        return 0;
      }

      const leftIsCurrent = leftId === task.id;
      const rightIsCurrent = rightId === task.id;
      if (leftIsCurrent || rightIsCurrent) {
        return leftIsCurrent ? -1 : 1;
      }

      return rightId - leftId;
    });
  }

  private async findEquivalentPendingTask(payload: ImageCenterTaskPayload) {
    return this.prismaService.productImageGenerationTask.findFirst({
      where: {
        productId: payload.productId,
        category: payload.category,
        taskType: payload.taskType,
        status: {
          in: [
            IMAGE_CENTER_TASK_STATUS.QUEUED,
            IMAGE_CENTER_TASK_STATUS.PROCESSING,
          ],
        },
        sourceImageId: payload.sourceImageId ?? null,
        sourceSkuCode: payload.sourceSkuCode ?? null,
        sourceUrl: payload.sourceUrl ?? null,
        targetSlot: payload.targetSlot ?? null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async markOlderQueuedTasksAsSuperseded(
    task: ProductImageGenerationTask,
  ) {
    const where: Prisma.ProductImageGenerationTaskWhereInput = {
      productId: task.productId,
      category: task.category,
      status: IMAGE_CENTER_TASK_STATUS.QUEUED,
      id: {
        not: task.id,
      },
    };

    if (task.targetSlot !== null && task.targetSlot !== undefined) {
      where.targetSlot = task.targetSlot;
    }

    await this.prismaService.productImageGenerationTask.updateMany({
      where,
      data: {
        status: IMAGE_CENTER_TASK_STATUS.FAILED,
        progress: 0,
        lastError: '已被较新的同类任务替代',
        finishedAt: new Date(),
      },
    });
  }

  private getJobPriority(taskType?: string | null) {
    switch (taskType) {
      case 'REGENERATE':
        return 1;
      case 'REPLACE':
        return 2;
      default:
        return 10;
    }
  }

  private async syncProductStatus(productId: number) {
    const [tasks, generated] = await this.prismaService.$transaction([
      this.prismaService.productImageGenerationTask.findMany({
        where: { productId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prismaService.productGeneratedImage.findMany({
        where: { productId },
      }),
    ]);

    const latestTasks = this.getLatestTasksByCategory(tasks);
    const status = this.calculateProductStatus(latestTasks, generated);
    const latestError =
      Array.from(latestTasks.values()).find((task) => task.lastError)
        ?.lastError ?? null;

    const result = await this.prismaService.product.updateMany({
      where: { id: productId },
      data: {
        imageCenterStatus: status,
        imageCenterError:
          status === IMAGE_CENTER_STATUS.FAILED ? latestError : null,
        imageCenterProcessedAt:
          status === IMAGE_CENTER_STATUS.SUCCESS ? new Date() : null,
      },
    });

    if (!result.count) {
      this.logger.warn(
        `商品不存在或已失效，跳过图片中心状态同步: ${productId}`,
      );
    }
  }

  private getLatestTasksByCategory(tasks: ProductImageGenerationTask[]) {
    const latestTasks = new Map<
      ImageCenterCategory,
      ProductImageGenerationTask
    >();

    for (const task of tasks) {
      if (
        !IMAGE_CENTER_CATEGORIES.includes(task.category as ImageCenterCategory)
      ) {
        continue;
      }

      const category = task.category as ImageCenterCategory;
      const existing = latestTasks.get(category);
      if (
        !existing ||
        existing.createdAt < task.createdAt ||
        (existing.createdAt.getTime() === task.createdAt.getTime() &&
          existing.id < task.id)
      ) {
        latestTasks.set(category, task);
      }
    }

    return latestTasks;
  }

  private async updateTaskIfExists(
    taskId: number,
    data: Prisma.ProductImageGenerationTaskUpdateManyMutationInput,
  ) {
    const result =
      await this.prismaService.productImageGenerationTask.updateMany({
        where: { id: taskId },
        data,
      });

    if (!result.count) {
      this.logger.warn(`图片生成任务不存在或已失效，跳过更新: ${taskId}`);
      return false;
    }

    return true;
  }

  private calculateProductStatus(
    tasksByCategory: Map<ImageCenterCategory, ProductImageGenerationTask>,
    generated: ProductGeneratedImage[],
  ) {
    const generatedCategories = new Set(
      generated.map((item) => item.category as ImageCenterCategory),
    );
    const latestTasks = Array.from(tasksByCategory.values());

    if (
      latestTasks.some(
        (task) =>
          task.status === IMAGE_CENTER_TASK_STATUS.PROCESSING ||
          task.status === IMAGE_CENTER_TASK_STATUS.QUEUED,
      )
    ) {
      return IMAGE_CENTER_STATUS.PROCESSING;
    }

    if (
      latestTasks.some(
        (task) => task.status === IMAGE_CENTER_TASK_STATUS.FAILED,
      )
    ) {
      return IMAGE_CENTER_STATUS.FAILED;
    }

    if (!latestTasks.length && !generated.length) {
      return IMAGE_CENTER_STATUS.IDLE;
    }

    const allCategoriesCompleted = IMAGE_CENTER_CATEGORIES.every((category) => {
      if (generatedCategories.has(category)) {
        return true;
      }

      const task = tasksByCategory.get(category);
      return task?.status === IMAGE_CENTER_TASK_STATUS.SUCCESS;
    });

    if (allCategoriesCompleted) {
      return IMAGE_CENTER_STATUS.SUCCESS;
    }

    return IMAGE_CENTER_STATUS.PROCESSING;
  }

  private async getQueueConnection(): Promise<ConnectionOptions | null> {
    const redisUrl = this.configService.get<string>('REDIS_URL')?.trim();
    if (redisUrl) {
      return this.parseRedisConnection(redisUrl);
    }

    if (!this.shouldUseEmbeddedRedis()) {
      return null;
    }

    const embeddedRedisUrl = await this.ensureEmbeddedRedisUrl();
    return this.parseRedisConnection(embeddedRedisUrl);
  }

  private parseRedisConnection(redisUrl: string): ConnectionOptions {
    const parsed = new URL(redisUrl);
    const dbPath = parsed.pathname.replace(/^\//, '');

    return {
      host: parsed.hostname,
      port: Number(parsed.port || '6379'),
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      db: dbPath ? Number(dbPath) : 0,
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  }

  private shouldUseEmbeddedRedis() {
    const value = this.configService
      .get<string>('IMAGE_CENTER_EMBEDDED_REDIS')
      ?.trim()
      .toLowerCase();
    return value !== 'false';
  }

  private async ensureEmbeddedRedisUrl() {
    if (!this.embeddedRedis) {
      this.embeddedRedis = new RedisMemoryServer({
        instance: {
          ip: '127.0.0.1',
        },
      });
      const host = await this.embeddedRedis.getHost();
      const port = await this.embeddedRedis.getPort();
      this.logger.log(`已启动嵌入式 Redis: redis://${host}:${port}/0`);
      return `redis://${host}:${port}/0`;
    }

    const host = await this.embeddedRedis.getHost();
    const port = await this.embeddedRedis.getPort();
    return `redis://${host}:${port}/0`;
  }

  private getWorkerConcurrency() {
    return this.getPositiveIntegerConfig('IMAGE_CENTER_WORKER_CONCURRENCY', 2);
  }

  private getLocalConcurrency() {
    return this.getPositiveIntegerConfig('IMAGE_CENTER_LOCAL_CONCURRENCY', 2);
  }

  private getPositiveIntegerConfig(key: string, fallback: number) {
    const raw = this.configService.get<string>(key)?.trim();
    const parsed = raw ? Number(raw) : fallback;
    if (!Number.isFinite(parsed) || parsed < 1) {
      return fallback;
    }

    return Math.floor(parsed);
  }

  private isProductCancelled(productId: number) {
    return this.cancelledProductIds.has(productId);
  }

  private isTaskCancelled(taskId: number) {
    return this.cancelledTaskIds.has(taskId);
  }
}
