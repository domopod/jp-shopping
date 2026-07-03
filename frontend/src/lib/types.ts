export type ProductStatus = '草稿' | '已发布' | '失败';
export type ProcessStatus = 'PROCESSING' | 'SUCCESS' | 'FAILED';
export type ImageCenterStatus = 'IDLE' | 'QUEUED' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
export type ProductImageListStatus = 'PROCESSING' | 'SUCCESS';
export type ImageCenterCategory =
  | 'square_main'
  | 'portrait_main'
  | 'long_main'
  | 'detail'
  | 'sku'
  | 'size_chart';

export interface ProductImage {
  id: number;
  imageUrl: string;
  sourceImageUrl?: string;
  originalImageUrl?: string | null;
  taobaoMainImageUrl?: string | null;
  taobaoDetailImageUrl?: string | null;
  processStatus?: ProcessStatus;
  processError?: string | null;
  processedAt?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  isCover?: boolean;
  sortOrder: number;
}

export interface ProductSku {
  id: number;
  skuCode: string;
  name?: string | null;
  color: string | null;
  size: string | null;
  price: string | null;
  imageUrl?: string | null;
}

export interface ProductDetail {
  id: number;
  title: string;
  price: string | null;
  description: string | null;
  sizeInfo?: string | null;
  specification?: string | null;
  brand: string | null;
  status: ProductStatus;
  aiProcessStatus?: ProcessStatus;
  aiProcessError?: string | null;
  aiProcessedAt?: string | null;
  imageProcessStatus?: ProcessStatus;
  imageProcessError?: string | null;
  imageProcessedAt?: string | null;
  imageCenterStatus?: ImageCenterStatus;
  imageCenterError?: string | null;
  imageCenterProcessedAt?: string | null;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
  images: ProductImage[];
  skus: ProductSku[];
  generatedImages?: ImageCenterGeneratedImage[];
  imageGenerationTasks?: ImageCenterTask[];
}

export interface ProductListItem {
  id: number;
  title: string;
  brand: string | null;
  price: string | null;
  status: ProductStatus;
  aiProcessStatus?: ProcessStatus;
  aiProcessError?: string | null;
  imageProcessStatus?: ProcessStatus;
  imageProcessError?: string | null;
  imageCenterStatus?: ImageCenterStatus;
  imageCenterError?: string | null;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
  imageUrl: string | null;
  skuCount: number;
}

export interface ProductListResponse {
  items: ProductListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  filters: {
    brands: string[];
    statuses: ProductStatus[];
  };
}

export interface ImportProductResponse {
  id: number;
  title: string;
  brand: string | null;
  price: string | null;
  sourceUrl: string;
  status: ProductStatus;
  aiProcessStatus?: ProcessStatus;
  imageProcessStatus?: ProcessStatus;
  imageCenterStatus?: ImageCenterStatus;
}

export type ImportTaskStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';

export interface ImportTaskResponse {
  taskId: number;
  sourceUrl: string;
  status: ImportTaskStatus;
  productId: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ImportTaskDetail {
  id: number;
  sourceUrl: string;
  status: ImportTaskStatus;
  productId: number | null;
  productTitle: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ImageCenterGeneratedImage {
  id: number;
  category: ImageCenterCategory;
  slotIndex?: number | null;
  imageUrl: string;
  sourceImageId?: number | null;
  sourceUrl?: string | null;
  sourceSkuCode?: string | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  mimeType?: string | null;
  isDefault?: boolean;
  sortOrder: number;
  status: string;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImageCenterTask {
  id: number;
  category: ImageCenterCategory;
  taskType: string;
  status: string;
  progress: number;
  sourceImageId?: number | null;
  sourceSkuCode?: string | null;
  sourceUrl?: string | null;
  targetSlot?: number | null;
  attemptCount: number;
  maxAttempts: number;
  lastError?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImageCenterRawImage {
  id: number;
  imageUrl: string;
  sourceImageUrl?: string;
  isCover?: boolean;
  sortOrder: number;
  sourceType?: string;
}

export interface ImageCenterSkuImage {
  skuCode: string;
  name?: string | null;
  color?: string | null;
  size?: string | null;
  imageUrl?: string | null;
}

export interface ProductImageCenter {
  productId: number;
  productTitle: string;
  status: ImageCenterStatus;
  error?: string | null;
  processedAt?: string | null;
  rawImages: ImageCenterRawImage[];
  skuImages: ImageCenterSkuImage[];
  generatedImages: ImageCenterGeneratedImage[];
  tasks: ImageCenterTask[];
  categories: Record<ImageCenterCategory, ImageCenterGeneratedImage[]>;
}

export interface ModelPromptConfig {
  key: 'long_main_prompt_template' | 'long_main_compose_prompt' | 'square_main_white_prompt' | 'square_main_expand_prompt' | 'portrait_main_expand_prompt';
  label: string;
  description: string;
  value: string;
  defaultValue: string;
  placeholders: string[];
  updatedAt?: string | null;
}

export interface UpdateProductPayload {
  title?: string;
  description?: string | null;
  sizeInfo?: string | null;
  specification?: string | null;
  brand?: string | null;
  sourceUrl?: string;
  status?: ProductStatus;
  images?: Array<{
    imageUrl: string;
    isCover?: boolean;
  }>;
  coverImages?: Array<{
    imageUrl: string;
  }>;
  skus?: Array<{
    skuCode: string;
    name?: string | null;
    color?: string | null;
    size?: string | null;
    price?: string | null;
    imageUrl?: string | null;
  }>;
}

export type StockStatus = 'IN_STOCK' | 'OUT_OF_STOCK' | 'BACKORDER';

export interface StockMonitorSku {
  id: number;
  skuCode: string;
  color: string | null;
  colorCode: string | null;
  size: string | null;
  stockStatus: StockStatus;
  stockStatusCode: number | null;
  stockQuantity: number | null;
  storeStockQuantity: number | null;
  transferableStockQuantity: number | null;
  arrivalQuantity: number | null;
  stockDate: string | null;
  restockDate: string | null;
  price: string | null;
  lastCheckedAt: string | null;
}

export interface StockMonitorProduct {
  id: number;
  sourceUrl: string;
  title: string;
  brand: string | null;
  price: string | null;
  imageUrl: string | null;
  isPinned: boolean;
  lastCheckedAt: string | null;
  checkStatus: string;
  checkError: string | null;
  createdAt: string;
  updatedAt: string;
  skus: StockMonitorSku[];
}

export interface StockMonitorListResponse {
  items: StockMonitorProduct[];
  total: number;
}
