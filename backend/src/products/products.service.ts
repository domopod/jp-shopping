import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Product } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PythonCollectorService } from '../collector/python-collector.service';
import {
  PRODUCT_STATUSES,
  type ListProductsDto,
} from './dto/list-products.dto';
import type { SaveTaobaoCookiesDto } from './dto/save-taobao-cookies.dto';
import type { UpdateProductDto } from './dto/update-product.dto';
import { ImageCenterDownloadService } from './image-center-download.service';
import { ImageCenterProcessorService } from './image-center-processor.service';
import { ImageCenterQueueService } from './image-center-queue.service';
import { ImageCenterStorageService } from './image-center-storage.service';
import {
  LONG_MAIN_PROMPT_KEY,
  MODEL_PROMPT_DEFINITIONS,
  ModelPromptService,
} from './model-prompt.service';
import { ProductAiQueueService } from './product-ai-queue.service';
import { ProductImageQueueService } from './product-image-queue.service';
import { ProductPublishQueueService } from './product-publish-queue.service';
import { SmartCropQueueService } from './smart-crop-queue.service';
import { SmartCropService } from './smart-crop.service';
import type { SmartCropRequestBodyDto } from './dto/smart-crop.dto';
import type { ManualCropRequestBodyDto } from './dto/manual-crop.dto';
import { TaobaoSessionService } from './taobao-session.service';
import { SizeChartService } from './size-chart.service';

interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly pythonCollectorService: PythonCollectorService,
    private readonly productAiQueueService: ProductAiQueueService,
    private readonly productImageQueueService: ProductImageQueueService,
    private readonly imageCenterQueueService: ImageCenterQueueService,
    private readonly imageCenterDownloadService: ImageCenterDownloadService,
    private readonly imageCenterProcessorService: ImageCenterProcessorService,
    private readonly imageCenterStorageService: ImageCenterStorageService,
    private readonly modelPromptService: ModelPromptService,
    private readonly productPublishQueueService: ProductPublishQueueService,
    private readonly smartCropService: SmartCropService,
    private readonly smartCropQueueService: SmartCropQueueService,
    private readonly taobaoSessionService: TaobaoSessionService,
    private readonly sizeChartService: SizeChartService,
  ) {}

  async importByUrl(url: string) {
    const task = await this.prismaService.productImportTask.create({
      data: {
        sourceUrl: url,
        status: 'PENDING',
      },
    });

    this.processImportTask(task.id, url).catch((error) => {
      console.error('importByUrl async error:', error);
    });

    return this.toImportTaskResponse(task);
  }

  async listImportTasks() {
    const tasks = await this.prismaService.productImportTask.findMany({
      take: 30,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        product: {
          select: {
            title: true,
          },
        },
      },
    });
    return tasks.map((task) => ({
      id: task.id,
      sourceUrl: task.sourceUrl,
      status: task.status,
      productId: task.productId,
      productTitle: task.product?.title || null,
      error: task.error,
      createdAt: task.createdAt.toISOString(),
      finishedAt: task.finishedAt?.toISOString() || null,
    }));
  }

  async getImportTask(taskId: number) {
    const task = await this.prismaService.productImportTask.findUnique({
      where: { id: taskId },
      include: {
        product: {
          select: {
            title: true,
          },
        },
      },
    });
    if (!task) {
      throw new NotFoundException('抓取任务不存在');
    }
    return {
      id: task.id,
      sourceUrl: task.sourceUrl,
      status: task.status,
      productId: task.productId,
      productTitle: task.product?.title || null,
      error: task.error,
      createdAt: task.createdAt.toISOString(),
      finishedAt: task.finishedAt?.toISOString() || null,
    };
  }

  private async processImportTask(taskId: number, url: string) {
    try {
      await this.prismaService.productImportTask.update({
        where: { id: taskId },
        data: { status: 'PROCESSING' },
      });

      const payload = await this.pythonCollectorService.collect(url);

      const images = payload.images.length
        ? payload.images
        : [
            'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=clean%20studio%20packshot%20of%20a%20modern%20cross-border%20fashion%20product%2C%20soft%20lighting%2C%20premium%20ecommerce%20photography&image_size=landscape_4_3',
          ];

      const skus = payload.skus.length
        ? payload.skus
        : [
            {
              skuCode: `SKU-${Date.now()}`,
              color: null,
              size: null,
              price: payload.price,
            },
          ];

      const product = await this.prismaService.$transaction(async (tx) => {
        const createdProduct = await tx.product.create({
          data: {
            sourceUrl: url,
            title: payload.title,
            price: payload.price,
            description: payload.description,
            sizeInfo: payload.sizeInfo,
            specification: payload.specification,
            brand: payload.brand,
            status: '草稿',
            aiProcessStatus: 'PROCESSING',
            imageProcessStatus: 'PROCESSING',
          },
        });

        await tx.productImage.createMany({
          data: images.map((imageUrl, index) => ({
            productId: createdProduct.id,
            imageUrl,
            isCover: index < 5,
            sortOrder: index,
          })),
        });

        await tx.productSku.createMany({
          data: skus.map((sku) => ({
            productId: createdProduct.id,
            skuCode: sku.skuCode,
            name: sku.name ?? sku.color ?? sku.skuCode,
            color: sku.color,
            size: sku.size,
            price: sku.price,
            stock: 999,
            imageUrl: sku.imageUrl,
          })),
        });

        return createdProduct;
      });

      await this.productImageQueueService.enqueueProductImages(product.id);
      this.productAiQueueService.processImmediately(product.id).catch(() => {});
      this.imageCenterQueueService.ensureProductImageCenter(product.id).catch(() => {});

      await this.prismaService.productImportTask.update({
        where: { id: taskId },
        data: {
          status: 'SUCCESS',
          productId: product.id,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.prismaService.productImportTask.update({
          where: { id: taskId },
          data: {
            status: 'FAILED',
            error: message,
            finishedAt: new Date(),
          },
        });
      } catch (updateError) {
        console.error('Failed to update import task status:', updateError);
      }
    }
  }

  private toImportTaskResponse(task: {
    id: number;
    sourceUrl: string;
    status: string;
    productId: number | null;
    error: string | null;
    createdAt: Date;
    finishedAt: Date | null;
  }) {
    return {
      taskId: task.id,
      sourceUrl: task.sourceUrl,
      status: task.status,
      productId: task.productId,
      error: task.error,
      createdAt: task.createdAt.toISOString(),
      finishedAt: task.finishedAt?.toISOString() || null,
    };
  }

  async listProducts(query: ListProductsDto) {
    const where = {
      ...(query.brand ? { brand: query.brand } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.imageStatus === 'SUCCESS'
        ? { imageCenterStatus: 'SUCCESS' }
        : query.imageStatus === 'PROCESSING'
          ? { imageCenterStatus: { not: 'SUCCESS' } }
          : {}),
      ...(query.keyword
        ? {
            OR: [
              { title: { contains: query.keyword } },
              { brand: { contains: query.keyword } },
              { sourceUrl: { contains: query.keyword } },
            ],
          }
        : {}),
    };

    const [total, products, brands] = await this.prismaService.$transaction([
      this.prismaService.product.count({ where }),
      this.prismaService.product.findMany({
        where,
        include: {
          images: {
            orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }],
            take: 1,
          },
          skus: {
            orderBy: { id: 'asc' },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prismaService.product.findMany({
        where: {
          brand: {
            not: null,
          },
        },
        select: { brand: true },
        distinct: ['brand'],
        orderBy: { brand: 'asc' },
      }),
    ]);

    return {
      items: products.map((product) => ({
        id: product.id,
        title: product.processedTitle || product.title,
        rawTitle: product.title,
        processedTitle: product.processedTitle,
        brand: product.brand,
        price: product.price,
        status: product.status,
        aiProcessStatus: product.aiProcessStatus,
        aiProcessError: product.aiProcessError,
        imageProcessStatus: product.imageProcessStatus,
        imageProcessError: product.imageProcessError,
        imageCenterStatus: product.imageCenterStatus,
        imageCenterError: product.imageCenterError,
        publishStatus: product.publishStatus,
        publishError: product.publishError,
        taobaoProductId: product.taobaoProductId,
        sourceUrl: product.sourceUrl,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
        imageUrl:
          product.images[0]?.taobaoMainImageUrl ||
          product.images[0]?.taobaoDetailImageUrl ||
          product.images[0]?.originalImageUrl ||
          product.images[0]?.imageUrl ||
          null,
        skuCount: product.skus.length,
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
      },
      filters: {
        brands: brands
          .map((item) => item.brand)
          .filter((brand): brand is string => Boolean(brand)),
        statuses: PRODUCT_STATUSES,
      },
    };
  }

  async findDetail(id: number) {
    const product = await this.prismaService.product.findUnique({
      where: { id },
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

    // 不自动 ensureProductImageCenter：避免读取产品详情时触发其他分类的 AI 生成
    // 仅在首次导入和显式 regenerate 时生成
    const imageCenter = await this.getImageCenterState(id);

    return {
      id: product.id,
      title: product.processedTitle || product.title,
      rawTitle: product.title,
      price: product.price,
      description: product.processedDescription || product.description,
      rawDescription: product.description,
      sizeInfo: product.processedSizeInfo || product.sizeInfo,
      rawSizeInfo: product.sizeInfo,
      specification: product.processedSpecification || product.specification,
      rawSpecification: product.specification,
      brand: product.brand,
      status: product.status,
      processedTitle: product.processedTitle,
      processedDescription: product.processedDescription,
      processedDescriptionHtml: product.processedDescriptionHtml,
      processedSizeInfo: product.processedSizeInfo,
      processedSpecification: product.processedSpecification,
      aiSellingPoints: Array.isArray(product.aiSellingPoints)
        ? product.aiSellingPoints
        : [],
      aiAttributes: Array.isArray(product.aiAttributes)
        ? product.aiAttributes
        : [],
      aiProcessStatus: product.aiProcessStatus,
      aiProcessError: product.aiProcessError,
      aiProcessedAt: product.aiProcessedAt?.toISOString() ?? null,
      imageProcessStatus: product.imageProcessStatus,
      imageProcessError: product.imageProcessError,
      imageProcessedAt: product.imageProcessedAt?.toISOString() ?? null,
      imageCenterStatus: imageCenter.status,
      imageCenterError: imageCenter.error,
      imageCenterProcessedAt: imageCenter.processedAt,
      publishStatus: product.publishStatus,
      publishError: product.publishError,
      publishCheckpoint: product.publishCheckpoint,
      publishResult: product.publishResult ?? null,
      taobaoProductId: product.taobaoProductId,
      publishLogPath: product.publishLogPath,
      publishScreenshotPath: product.publishScreenshotPath,
      publishedAt: product.publishedAt?.toISOString() ?? null,
      taobaoPayload: product.taobaoPayload ?? null,
      sourceUrl: product.sourceUrl,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      images: product.images.map((image) => ({
        id: image.id,
        imageUrl:
          image.taobaoDetailImageUrl ||
          image.originalImageUrl ||
          image.imageUrl,
        sourceImageUrl: image.imageUrl,
        originalImageUrl: image.originalImageUrl,
        taobaoMainImageUrl: image.taobaoMainImageUrl,
        taobaoDetailImageUrl: image.taobaoDetailImageUrl,
        processStatus: image.processStatus,
        processError: image.processError,
        processedAt: image.processedAt?.toISOString() ?? null,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        fileSize: image.fileSize,
        isCover: image.isCover,
        sortOrder: image.sortOrder,
      })),
      skus: product.skus.map((sku) => ({
        id: sku.id,
        skuCode: sku.skuCode,
        name: sku.name,
        color: sku.color,
        size: sku.size,
        price: sku.price,
        stock: sku.stock,
        imageUrl: sku.imageUrl,
      })),
      generatedImages: imageCenter.assets,
      imageGenerationTasks: imageCenter.tasks,
    };
  }

  async updateProduct(id: number, payload: UpdateProductDto) {
    await this.ensureProductExists(id);
    let shouldReprocessImages = false;
    let shouldRefreshDetailImages = false;
    let shouldRefreshSkuImages = false;
    let shouldRefreshSizeChart = false;

    await this.prismaService.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: {
          ...(payload.title !== undefined ? { title: payload.title } : {}),
          ...(payload.price !== undefined ? { price: payload.price } : {}),
          ...(payload.description !== undefined
            ? { description: payload.description }
            : {}),
          ...(payload.sizeInfo !== undefined
            ? { sizeInfo: payload.sizeInfo }
            : {}),
          ...(payload.specification !== undefined
            ? { specification: payload.specification }
            : {}),
          ...(payload.brand !== undefined ? { brand: payload.brand } : {}),
          ...(payload.sourceUrl !== undefined
            ? { sourceUrl: payload.sourceUrl }
            : {}),
          ...(payload.status !== undefined ? { status: payload.status } : {}),
        },
      });

      if (payload.images) {
        shouldReprocessImages = true;
        shouldRefreshDetailImages = true;
        const coverImageUrlSet = new Set(
          (payload.coverImages || []).map((image) => image.imageUrl),
        );

        await tx.productImage.deleteMany({
          where: { productId: id },
        });

        if (payload.images.length) {
          await tx.productImage.createMany({
            data: payload.images.map((image, index) => ({
              productId: id,
              imageUrl: image.imageUrl,
              isCover: coverImageUrlSet.has(image.imageUrl),
              sortOrder: index,
            })),
          });
        }
      }

      if (payload.skus) {
        shouldRefreshSkuImages = true;
        await tx.productSku.deleteMany({
          where: { productId: id },
        });

        if (payload.skus.length) {
          await tx.productSku.createMany({
            data: payload.skus.map((sku) => ({
              productId: id,
              skuCode: sku.skuCode,
              name: sku.name ?? sku.color ?? sku.skuCode,
              color: sku.color ?? null,
              size: sku.size ?? null,
              price: sku.price ?? null,
              stock: sku.stock ?? 999,
              imageUrl: sku.imageUrl ?? null,
            })),
          });
        }
      }

      if (payload.sizeInfo !== undefined) {
        shouldRefreshSizeChart = true;
      }
    });

    if (shouldReprocessImages) {
      await this.productImageQueueService.enqueueProductImages(id);
      await Promise.all([
        this.imageCenterQueueService.regenerateCategory({
          productId: id,
          category: 'square_main',
        }),
        this.imageCenterQueueService.regenerateCategory({
          productId: id,
          category: 'portrait_main',
        }),
        this.imageCenterQueueService.regenerateCategory({
          productId: id,
          category: 'long_main',
        }),
      ]);
    }

    if (shouldRefreshDetailImages) {
      await this.imageCenterQueueService.regenerateCategory({
        productId: id,
        category: 'detail',
      });
    }

    if (shouldRefreshSkuImages) {
      await this.imageCenterQueueService.regenerateCategory({
        productId: id,
        category: 'sku',
      });
    }

    if (shouldRefreshSizeChart) {
      await this.imageCenterQueueService.regenerateCategory({
        productId: id,
        category: 'size_chart',
      });
    }

    return this.findDetail(id);
  }

  async deleteProduct(id: number) {
    await this.ensureProductExists(id);

    await Promise.all([
      this.productImageQueueService.cancelProductTasks(id),
      this.imageCenterQueueService.cancelProductTasks(id),
    ]);

    await this.prismaService.product.delete({
      where: { id },
    });

    return {
      success: true,
      id,
    };
  }

  async deleteProducts(ids: number[]) {
    const uniqueIds = [...new Set(ids)];
    const existingProducts = await this.prismaService.product.findMany({
      where: {
        id: {
          in: uniqueIds,
        },
      },
      select: { id: true },
    });

    if (existingProducts.length !== uniqueIds.length) {
      throw new NotFoundException('部分商品不存在或已删除');
    }

    await Promise.all(
      uniqueIds.map((id) =>
        Promise.all([
          this.productImageQueueService.cancelProductTasks(id),
          this.imageCenterQueueService.cancelProductTasks(id),
        ]),
      ),
    );

    const result = await this.prismaService.product.deleteMany({
      where: {
        id: {
          in: uniqueIds,
        },
      },
    });

    return {
      success: true,
      deletedCount: result.count,
      ids: uniqueIds,
    };
  }

  async retryAiProcessing(id: number) {
    await this.ensureProductExists(id);
    await this.productAiQueueService.retry(id);

    return {
      success: true,
      id,
      aiProcessStatus: 'PROCESSING',
    };
  }

  async retryImageProcessing(id: number) {
    await this.ensureProductExists(id);
    await this.productImageQueueService.retryProductImages(id);

    return {
      success: true,
      id,
      imageProcessStatus: 'PROCESSING',
    };
  }

  async ensureImageCenter(id: number) {
    await this.ensureProductExists(id);
    return this.imageCenterQueueService.ensureProductImageCenter(id);
  }

  async getImageCenter(id: number) {
    await this.ensureProductExists(id);
    // 不自动 ensureProductImageCenter：避免读取图片中心时触发其他分类的 AI 生成
    // 仅在首次导入和显式 regenerate 时生成

    const [product, rawImages, skus, state] = await Promise.all([
      this.prismaService.product.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
        },
      }),
      this.prismaService.productImage.findMany({
        where: { productId: id },
        orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }],
      }),
      this.prismaService.productSku.findMany({
        where: { productId: id },
        orderBy: { id: 'asc' },
      }),
      this.getImageCenterState(id),
    ]);

    return {
      productId: id,
      productTitle: product?.title ?? `product-${id}`,
      status: state.status,
      error: state.error,
      processedAt: state.processedAt,
      rawImages: rawImages.map((image) => ({
        id: image.id,
        imageUrl: image.originalImageUrl || image.imageUrl,
        sourceImageUrl: image.imageUrl,
        isCover: image.isCover,
        sortOrder: image.sortOrder,
        sourceType: (image as any).sourceType || 'CRAWLED',
      })),
      skuImages: skus
        .filter((sku) => sku.imageUrl)
        .map((sku) => ({
          skuCode: sku.skuCode,
          name: sku.name,
          color: sku.color,
          size: sku.size,
          imageUrl: sku.imageUrl,
        })),
      generatedImages: state.assets,
      tasks: state.tasks,
      categories: state.groupedAssets,
    };
  }

  async regenerateImageCategory(
    id: number,
    payload: {
      category:
        | 'square_main'
        | 'portrait_main'
        | 'long_main'
        | 'detail'
        | 'sku'
        | 'size_chart';
      sourceImageId?: number;
      sourceSkuCode?: string;
      sourceUrl?: string;
      targetSlot?: number;
      generationMode?: 'AI_WHITE_PRODUCT' | 'AI_GENERATE' | 'AI_COMPOSE';
    },
  ) {
    await this.ensureProductExists(id);

    if (
      payload.category === 'sku' &&
      payload.sourceSkuCode &&
      payload.sourceUrl
    ) {
      await this.imageCenterQueueService.cancelMatchingTasks({
        productId: id,
        category: 'sku',
        sourceSkuCode: payload.sourceSkuCode,
        reason: '已被手动替换',
      });

      await this.imageCenterProcessorService.replaceSkuImage({
        productId: id,
        sourceSkuCode: payload.sourceSkuCode,
        sourceUrl: payload.sourceUrl,
        sourceImageId: payload.sourceImageId,
      });

      const taskPayload = {
        productId: id,
        category: 'sku',
        taskType: 'REPLACE',
        sourceImageId: payload.sourceImageId,
        sourceSkuCode: payload.sourceSkuCode,
        sourceUrl: payload.sourceUrl,
      } as const;
      const task = await this.prismaService.productImageGenerationTask.create({
        data: {
          productId: id,
          taskType: 'REPLACE',
          category: 'sku',
          status: 'SUCCESS',
          progress: 100,
          sourceImageId: payload.sourceImageId ?? null,
          sourceSkuCode: payload.sourceSkuCode,
          sourceUrl: payload.sourceUrl,
          payload: taskPayload as unknown as Prisma.InputJsonValue,
          result: {
            category: 'sku',
            createdAssets: 1,
            mode: 'immediate_replace',
          } as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });

      await this.imageCenterQueueService.refreshProductStatus(id);
      return {
        success: true,
        taskId: task.id,
        status: task.status,
      };
    }

    return this.imageCenterQueueService.regenerateCategory({
      productId: id,
      category: payload.category,
      sourceImageId: payload.sourceImageId,
      sourceSkuCode: payload.sourceSkuCode,
      sourceUrl: payload.sourceUrl,
      targetSlot: payload.targetSlot,
      generationMode: payload.generationMode,
    });
  }

  async uploadImageCenterRawImage(id: number, file?: UploadedImageFile) {
    await this.ensureProductExists(id);

    if (!file?.buffer?.byteLength) {
      throw new BadRequestException('未选择上传图片');
    }

    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('仅支持上传图片文件');
    }

    const extension = this.resolveUploadExtension(
      file.mimetype,
      file.originalname,
    );
    const storageKey = `product-${id}/picker-source/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const stored = await this.imageCenterStorageService.uploadBuffer(
      storageKey,
      file.buffer,
      file.mimetype,
    );
    const maxSortOrder = await this.prismaService.productImage.aggregate({
      where: { productId: id },
      _max: { sortOrder: true },
    });
    const image = await this.prismaService.productImage.create({
      data: {
        productId: id,
        imageUrl: stored.imageUrl,
        originalImageUrl: stored.imageUrl,
        isCover: false,
        sortOrder: (maxSortOrder._max.sortOrder ?? -1) + 1,
        sourceType: 'UPLOAD',
      },
    });

    return {
      success: true,
      image: {
        id: image.id,
        imageUrl: stored.imageUrl,
        sourceImageUrl: stored.imageUrl,
        isCover: false,
        sortOrder: image.sortOrder,
        sourceType: 'UPLOAD',
      },
    };
  }

  async retryImageCenterTask(id: number, taskId: number) {
    await this.ensureProductExists(id);

    const task = await this.prismaService.productImageGenerationTask.findUnique(
      {
        where: { id: taskId },
        select: { id: true, productId: true },
      },
    );

    if (!task || task.productId !== id) {
      throw new NotFoundException('图片生成任务不存在');
    }

    await this.imageCenterQueueService.retryTask(taskId);
    return {
      success: true,
      productId: id,
      taskId,
      status: 'QUEUED',
    };
  }

  async setDefaultGeneratedImage(
    id: number,
    assetId: number,
    category: 'square_main',
  ) {
    await this.ensureProductExists(id);

    const asset = await this.prismaService.productGeneratedImage.findUnique({
      where: { id: assetId },
      select: { id: true, productId: true, category: true },
    });

    if (!asset || asset.productId !== id || asset.category !== category) {
      throw new NotFoundException('生成图片不存在');
    }

    await this.prismaService.$transaction([
      this.prismaService.productGeneratedImage.updateMany({
        where: {
          productId: id,
          category,
        },
        data: {
          isDefault: false,
        },
      }),
      this.prismaService.productGeneratedImage.update({
        where: { id: assetId },
        data: {
          isDefault: true,
        },
      }),
    ]);

    return {
      success: true,
      productId: id,
      assetId,
      category,
    };
  }

  async downloadImageCenterCategory(
    id: number,
    category:
      | 'square_main'
      | 'portrait_main'
      | 'long_main'
      | 'detail'
      | 'sku'
      | 'size_chart',
  ) {
    await this.ensureProductExists(id);
    return this.imageCenterDownloadService.buildCategoryZip(id, category);
  }

  async downloadImageCenterProduct(id: number) {
    await this.ensureProductExists(id);
    return this.imageCenterDownloadService.buildProductZip(id);
  }

  async getTaobaoProduct(id: number) {
    const product = await this.prismaService.product.findUnique({
      where: { id },
      select: {
        id: true,
        aiProcessStatus: true,
        aiProcessError: true,
        taobaoPayload: true,
        publishStatus: true,
        taobaoProductId: true,
      },
    });

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    return {
      id: product.id,
      aiProcessStatus: product.aiProcessStatus,
      aiProcessError: product.aiProcessError,
      taobaoPayload: product.taobaoPayload,
      publishStatus: product.publishStatus,
      taobaoProductId: product.taobaoProductId,
    };
  }

  async getTaobaoSessionStatus() {
    return this.taobaoSessionService.getSessionStatus();
  }

  async listModelPrompts() {
    const items = await this.modelPromptService.listPrompts();
    return { items };
  }

  async updateModelPrompt(key: keyof typeof MODEL_PROMPT_DEFINITIONS, value: string) {
    const item = await this.modelPromptService.updatePromptValue(key, value);
    return { item };
  }

  async regenerateSquareMainSlot1(productId: number) {
    await this.ensureProductExists(productId);
    const result = await this.imageCenterProcessorService.generateSquareMainSlot1(productId);
    return { success: result !== null, result };
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
      skus: Array<{ sourceUrl: string; sourceSkuCode?: string }>;
      skuPanel: { x: number; y: number; width: number; height: number };
    },
  ) {
    await this.ensureProductExists(productId);
    const result = await this.imageCenterProcessorService.generateSquareMainSlot1Manual(
      productId,
      input,
    );
    return { success: result !== null, result };
  }

  async updateSizeChart(
    productId: number,
    payload: { headers: string[]; rows: string[][] },
  ) {
    await this.ensureProductExists(productId);
    const asset = await this.imageCenterProcessorService.generateSizeChartFromTable(
      productId,
      payload.headers,
      payload.rows,
    );
    if (!asset) {
      return { success: false, asset: null };
    }
    return { success: true, asset };
  }

  async getSizeChartTable(productId: number) {
    await this.ensureProductExists(productId);

    const product = await this.prismaService.product.findUnique({
      where: { id: productId },
      select: {
        processedSizeInfo: true,
        sizeInfo: true,
        generatedImages: {
          where: { category: 'size_chart', slotIndex: 0 },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const existingAsset = product?.generatedImages?.[0];
    const existingMetadata = existingAsset?.metadata as
      | { headers?: unknown; rows?: unknown }
      | null
      | undefined;
    if (
      Array.isArray(existingMetadata?.headers) &&
      existingMetadata!.headers.length > 0 &&
      Array.isArray(existingMetadata?.rows) &&
      (existingMetadata!.rows as unknown[]).length > 0
    ) {
      return {
        headers: existingMetadata!.headers as string[],
        rows: existingMetadata!.rows as string[][],
        source: 'metadata',
      };
    }

    const fallback = await this.sizeChartService.generateSizeChartPng(
      product?.processedSizeInfo,
      product?.sizeInfo,
    );
    if (!fallback) {
      return { headers: [], rows: [], source: 'empty' };
    }
    return {
      headers: fallback.headers,
      rows: fallback.rows,
      source: 'parsed',
    };
  }

  async aiComposeLongMain(
    productId: number,
    productImageUrl: string,
    modelImageUrl: string,
  ) {
    await this.ensureProductExists(productId);
    return this.imageCenterQueueService.regenerateCategory({
      productId,
      category: 'long_main',
      sourceImageId: undefined,
      sourceSkuCode: undefined,
      sourceUrl: productImageUrl,
      targetSlot: undefined,
      generationMode: 'AI_COMPOSE',
      modelImageUrl,
    });
  }

  async saveTaobaoCookies(payload: SaveTaobaoCookiesDto) {
    return this.taobaoSessionService.saveCookies(payload);
  }

  async validateTaobaoSession() {
    return this.taobaoSessionService.validateSession();
  }

  async publishProduct(id: number) {
    await this.ensureProductExists(id);
    await this.productPublishQueueService.enqueue(id);

    return {
      success: true,
      id,
      publishStatus: 'QUEUED',
    };
  }

  async publishProducts(productIds: number[]) {
    for (const productId of productIds) {
      await this.ensureProductExists(productId);
    }

    return this.productPublishQueueService.enqueueBatch(productIds);
  }

  async retryPublish(id: number) {
    await this.ensureProductExists(id);
    await this.productPublishQueueService.retry(id);

    return {
      success: true,
      id,
      publishStatus: 'QUEUED',
    };
  }

  async resumePublish(id: number) {
    await this.ensureProductExists(id);
    await this.productPublishQueueService.resume(id);

    return {
      success: true,
      id,
      publishStatus: 'QUEUED',
    };
  }

  /**
   * 智能裁切：批量立即处理图片（同步模式，适合前端点击按钮即时响应）
   * 调用 smartCropQueueService 直接执行裁切、上传并保存生成图片记录
   */
  async processSmartCropBatch(
    id: number,
    payload: SmartCropRequestBodyDto,
  ) {
    await this.ensureProductExists(id);

    const result = await this.smartCropQueueService.processImagesImmediately(
      id,
      payload.category,
      payload.images,
    );

    return {
      success: true,
      productId: id,
      category: payload.category,
      total: payload.images.length,
      createdCount: result.assets.length,
      warnings: result.warnings,
      assets: result.assets,
      meta: result.meta,
    };
  }

  /**
   * 手动裁切：根据用户指定的 offset 和 scale 裁切图片
   */
  async processManualCrop(
    id: number,
    payload: ManualCropRequestBodyDto,
  ) {
    await this.ensureProductExists(id);

    const result = await this.smartCropQueueService.processManualCropImmediately(
      id,
      payload.category,
      payload.images,
    );

    return {
      success: true,
      productId: id,
      category: payload.category,
      total: payload.images.length,
      createdCount: result.assets.length,
      warnings: result.warnings,
      assets: result.assets,
      meta: result.meta,
    };
  }

  /**
   * 智能裁切：查询异步任务的处理状态
   */
  async getSmartCropTaskStatus(id: number, taskId: number) {
    await this.ensureProductExists(id);
    const status = await this.smartCropQueueService.getTaskStatus(taskId);

    if (!status) {
      throw new NotFoundException('智能裁切任务不存在');
    }

    return {
      success: true,
      productId: id,
      ...status,
    };
  }

  private toImportResponse(product: Product) {
    return {
      id: product.id,
      title: product.processedTitle || product.title,
      rawTitle: product.title,
      processedTitle: product.processedTitle,
      brand: product.brand,
      price: product.price,
      sourceUrl: product.sourceUrl,
      status: product.status,
      aiProcessStatus: product.aiProcessStatus,
      imageProcessStatus: product.imageProcessStatus,
      imageCenterStatus: product.imageCenterStatus,
      publishStatus: product.publishStatus,
    };
  }

  private async getImageCenterState(id: number) {
    const [product, assets, tasks] = await this.prismaService.$transaction([
      this.prismaService.product.findUnique({
        where: { id },
        select: {
          imageCenterStatus: true,
          imageCenterError: true,
          imageCenterProcessedAt: true,
        },
      }),
      this.prismaService.productGeneratedImage.findMany({
        where: { productId: id },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      }),
      this.prismaService.productImageGenerationTask.findMany({
        where: { productId: id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      status: product?.imageCenterStatus ?? 'IDLE',
      error: product?.imageCenterError ?? null,
      processedAt: product?.imageCenterProcessedAt?.toISOString() ?? null,
      assets: assets.map((asset) => this.toImageCenterAsset(asset)),
      tasks: tasks.map((task) => ({
        id: task.id,
        category: task.category,
        taskType: task.taskType,
        status: task.status,
        progress: task.progress,
        sourceImageId: task.sourceImageId,
        sourceSkuCode: task.sourceSkuCode,
        sourceUrl: task.sourceUrl,
        targetSlot: task.targetSlot,
        attemptCount: task.attemptCount,
        maxAttempts: task.maxAttempts,
        lastError: task.lastError,
        finishedAt: task.finishedAt?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      })),
      groupedAssets: {
        square_main: assets
          .filter((asset) => asset.category === 'square_main')
          .map((asset) => this.toImageCenterAsset(asset)),
        portrait_main: assets
          .filter((asset) => asset.category === 'portrait_main')
          .map((asset) => this.toImageCenterAsset(asset)),
        long_main: assets
          .filter((asset) => asset.category === 'long_main')
          .map((asset) => this.toImageCenterAsset(asset)),
        detail: assets
          .filter((asset) => asset.category === 'detail')
          .map((asset) => this.toImageCenterAsset(asset)),
        sku: assets
          .filter((asset) => asset.category === 'sku')
          .map((asset) => this.toImageCenterAsset(asset)),
        size_chart: assets
          .filter((asset) => asset.category === 'size_chart')
          .map((asset) => this.toImageCenterAsset(asset)),
      },
    };
  }

  private resolveUploadExtension(mimeType: string, fileName?: string) {
    if (mimeType === 'image/png') {
      return 'png';
    }

    if (mimeType === 'image/webp') {
      return 'webp';
    }

    if (mimeType === 'image/gif') {
      return 'gif';
    }

    const nameExtension = fileName?.split('.').pop()?.trim().toLowerCase();
    if (
      nameExtension &&
      ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(nameExtension)
    ) {
      return nameExtension === 'jpeg' ? 'jpg' : nameExtension;
    }

    return 'jpg';
  }

  private toImageCenterAsset(asset: {
    id: number;
    category: string;
    slotIndex: number | null;
    imageUrl: string;
    sourceImageId: number | null;
    sourceUrl: string | null;
    sourceSkuCode: string | null;
    width: number | null;
    height: number | null;
    fileSize: number | null;
    mimeType: string | null;
    isDefault: boolean;
    sortOrder: number;
    status: string;
    error: string | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: asset.id,
      category: asset.category,
      slotIndex: asset.slotIndex,
      imageUrl: asset.imageUrl,
      sourceImageId: asset.sourceImageId,
      sourceUrl: asset.sourceUrl,
      sourceSkuCode: asset.sourceSkuCode,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize,
      mimeType: asset.mimeType,
      isDefault: asset.isDefault,
      sortOrder: asset.sortOrder,
      status: asset.status,
      error: asset.error,
      metadata: asset.metadata,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
    };
  }

  private async ensureProductExists(id: number) {
    const product = await this.prismaService.product.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('商品不存在');
    }
  }
}
