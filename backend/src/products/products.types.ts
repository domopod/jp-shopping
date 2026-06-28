export interface CollectorSku {
  skuCode: string;
  name?: string | null;
  color: string | null;
  size: string | null;
  price: string | null;
  imageUrl?: string | null;
}

export interface CollectorPayload {
  title: string;
  price: string | null;
  description: string | null;
  sizeInfo?: string | null;
  specification?: string | null;
  brand: string | null;
  images: string[];
  skus: CollectorSku[];
}

export interface ProcessedProductAttribute {
  name: string;
  value: string;
}

export interface ProcessedProductSku {
  skuCode: string;
  name: string;
  color: string | null;
  size: string | null;
  price: string | null;
  imageUrl: string | null;
}

export interface TaobaoProductPayload {
  title: string;
  description: string;
  selling_points: string[];
  attributes: ProcessedProductAttribute[];
  skus: ProcessedProductSku[];
}

export interface ProcessedProductResult {
  title: string;
  descriptionText: string;
  descriptionHtml: string;
  sizeInfo: string;
  specification: string;
  sellingPoints: string[];
  attributes: ProcessedProductAttribute[];
  skus: ProcessedProductSku[];
  taobaoPayload: TaobaoProductPayload;
}

export interface ProcessedProductImageResult {
  originalImageUrl: string;
  taobaoMainImageUrl: string;
  taobaoDetailImageUrl: string;
  mimeType: string;
  width: number;
  height: number;
  fileSize: number;
}

export const IMAGE_CENTER_CATEGORIES = [
  'square_main',
  'portrait_main',
  'long_main',
  'detail',
  'sku',
  'size_chart',
] as const;

export type ImageCenterCategory = (typeof IMAGE_CENTER_CATEGORIES)[number];

export const IMAGE_CENTER_GENERATION_MODES = [
  'AI_WHITE_PRODUCT',
  'AI_GENERATE',
  'AI_COMPOSE',
] as const;

export type ImageCenterGenerationMode =
  (typeof IMAGE_CENTER_GENERATION_MODES)[number];

export interface GeneratedImageAssetResult {
  category: ImageCenterCategory;
  slotIndex: number;
  storageKey: string;
  imageUrl: string;
  mimeType: string;
  width: number;
  height: number;
  fileSize: number;
  sourceImageId?: number | null;
  sourceSkuCode?: string | null;
  sourceUrl?: string | null;
  isDefault?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ImageCenterTaskPayload {
  productId: number;
  category: ImageCenterCategory;
  taskType: 'AUTO_GENERATE' | 'REGENERATE' | 'REPLACE';
  sourceImageId?: number;
  sourceSkuCode?: string;
  sourceUrl?: string;
  targetSlot?: number;
  generationMode?: ImageCenterGenerationMode;
  modelImageUrl?: string;
}

export interface TaobaoPublishArtifact {
  logPath: string;
  screenshotPath: string | null;
}

export interface TaobaoPublishLogEntry {
  time: string;
  level: 'info' | 'warn' | 'error';
  step: string;
  message: string;
}

export interface TaobaoPublishResult {
  taobaoProductId: string;
  publishedAt: string;
  checkpoint: string;
  artifacts: TaobaoPublishArtifact;
  logs: TaobaoPublishLogEntry[];
}
