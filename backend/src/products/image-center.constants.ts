import type { ImageCenterCategory } from './products.types';

export const IMAGE_CENTER_QUEUE_NAME = 'product-image-center';

export const IMAGE_CENTER_STATUS = {
  IDLE: 'IDLE',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;

export const IMAGE_CENTER_TASK_STATUS = {
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;

export const IMAGE_CATEGORY_TARGETS: Record<
  ImageCenterCategory,
  { count: number; width: number; height: number; format: 'jpg' | 'png' }
> = {
  square_main: { count: 5, width: 1440, height: 1440, format: 'jpg' },
  portrait_main: { count: 5, width: 1440, height: 1920, format: 'jpg' },
  long_main: { count: 1, width: 1440, height: 2160, format: 'jpg' },
  detail: { count: 0, width: 1440, height: 2160, format: 'jpg' },
  sku: { count: 0, width: 1440, height: 1440, format: 'jpg' },
  size_chart: { count: 1, width: 1440, height: 1440, format: 'png' },
};

export const IMAGE_CENTER_DOWNLOAD_CATEGORIES = [
  'square_main',
  'portrait_main',
  'long_main',
  'detail',
  'sku',
  'size_chart',
] as const;
