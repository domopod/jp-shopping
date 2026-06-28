import { Module } from '@nestjs/common';
import { PythonCollectorService } from '../collector/python-collector.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductAiProcessorService } from './product-ai-processor.service';
import { ProductAiQueueService } from './product-ai-queue.service';
import { AgnesImageService } from './agnes-image.service';
import { ImageCenterDownloadService } from './image-center-download.service';
import { ImageCenterProcessorService } from './image-center-processor.service';
import { ImageCenterQueueService } from './image-center-queue.service';
import { ImageCenterStorageService } from './image-center-storage.service';
import { ModelPromptService } from './model-prompt.service';
import { ProductImageProcessorService } from './product-image-processor.service';
import { ProductImageQueueService } from './product-image-queue.service';
import { ProductPublishProcessorService } from './product-publish-processor.service';
import { ProductPublishQueueService } from './product-publish-queue.service';
import { ProductTranslationService } from './product-translation.service';
import { SizeChartService } from './size-chart.service';
import { SmartCropQueueService } from './smart-crop-queue.service';
import { SmartCropService } from './smart-crop.service';
import { TaobaoSessionService } from './taobao-session.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController],
  providers: [
    ProductsService,
    PrismaService,
    PythonCollectorService,
    AgnesImageService,
    ImageCenterDownloadService,
    ImageCenterProcessorService,
    ImageCenterQueueService,
    ImageCenterStorageService,
    ModelPromptService,
    ProductAiProcessorService,
    ProductAiQueueService,
    ProductImageProcessorService,
    ProductImageQueueService,
    ProductPublishProcessorService,
    ProductPublishQueueService,
    ProductTranslationService,
    SizeChartService,
    SmartCropService,
    SmartCropQueueService,
    TaobaoSessionService,
  ],
})
export class ProductsModule {}
