import {
  ImageCenterCategory,
  ModelPromptConfig,
  ImageCenterRawImage,
  ProductImageCenter,
  ProductDetail,
  ProductListResponse,
  UpdateProductPayload,
} from "@/lib/types";

function getClientApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
}

function getServerApiBaseUrl() {
  return process.env.INTERNAL_API_BASE_URL || getClientApiBaseUrl();
}

export function getApiBaseUrl() {
  if (typeof window === "undefined") {
    return getServerApiBaseUrl();
  }

  return getClientApiBaseUrl();
}

export async function fetchProductDetail(id: string): Promise<ProductDetail> {
  const response = await fetch(`${getApiBaseUrl()}/api/products/${id}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("获取商品详情失败");
  }

  return response.json();
}

export async function fetchProducts(params: {
  page: number;
  pageSize: number;
  keyword?: string;
  brand?: string;
  status?: string;
  imageStatus?: string;
}): Promise<ProductListResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("page", String(params.page));
  searchParams.set("pageSize", String(params.pageSize));

  if (params.keyword) {
    searchParams.set("keyword", params.keyword);
  }

  if (params.brand) {
    searchParams.set("brand", params.brand);
  }

  if (params.status) {
    searchParams.set("status", params.status);
  }

  if (params.imageStatus) {
    searchParams.set("imageStatus", params.imageStatus);
  }

  const response = await fetch(
    `${getApiBaseUrl()}/api/products?${searchParams.toString()}`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error("获取商品列表失败");
  }

  return response.json();
}

export async function fetchModelPrompts(): Promise<ModelPromptConfig[]> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/model-prompts`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error("获取模型提示词失败");
  }

  const result = (await response.json()) as { items: ModelPromptConfig[] };
  return result.items;
}

export async function updateModelPrompt(
  key: ModelPromptConfig["key"],
  value: string,
): Promise<ModelPromptConfig> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/model-prompts/${key}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value }),
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join("，")
      : result.message;
    throw new Error(message || "保存模型提示词失败");
  }

  const result = (await response.json()) as { item: ModelPromptConfig };
  return result.item;
}

export async function updateProduct(
  id: number,
  payload: UpdateProductPayload,
): Promise<ProductDetail> {
  const response = await fetch(`${getApiBaseUrl()}/api/products/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join("，")
      : result.message;
    throw new Error(message || "更新商品失败");
  }

  return response.json();
}

export async function deleteProduct(id: number) {
  const response = await fetch(`${getApiBaseUrl()}/api/products/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const result = (await response.json()) as { message?: string };
    throw new Error(result.message || "删除商品失败");
  }

  return response.json();
}

export async function deleteProducts(ids: number[]) {
  const response = await fetch(`${getApiBaseUrl()}/api/products/batch`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      productIds: ids,
    }),
  });

  if (!response.ok) {
    const result = (await response.json()) as { message?: string };
    throw new Error(result.message || "批量删除商品失败");
  }

  return response.json() as Promise<{
    success: true;
    deletedCount: number;
    ids: number[];
  }>;
}

export async function retryImageProcessing(id: number) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/images/retry`,
    {
      method: "POST",
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string };
    throw new Error(result.message || "图片处理重试失败");
  }

  return response.json();
}

export async function fetchProductImageCenter(
  id: number,
): Promise<ProductImageCenter> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/image-center`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error("获取图片中心失败");
  }

  return response.json();
}

export async function ensureProductImageCenter(id: number) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/image-center/ensure`,
    {
      method: "POST",
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string };
    throw new Error(result.message || "触发图片中心失败");
  }

  return response.json();
}

export async function regenerateSquareMainSlot1(id: number) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/image-center/square-main/slot1`,
    {
      method: "POST",
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string };
    throw new Error(result.message || "重新合成第二张主图失败");
  }

  return response.json();
}

export async function generateSquareMainSlot1Manual(
  id: number,
  payload: {
    background: { sourceUrl: string; offsetX: number; offsetY: number; scale: number };
    skus: Array<{ sourceUrl: string; sourceSkuCode?: string }>;
    skuPanel: { x: number; y: number; width: number; height: number };
  },
) {
  if (!payload.background?.sourceUrl) {
    throw new Error("缺少背景图片");
  }
  if (!payload.skus?.length) {
    throw new Error("缺少 SKU 图片");
  }
  if (payload.skus.length < 2 || payload.skus.length > 10) {
    throw new Error("SKU 图片请选择 2-10 张");
  }
  const invalidSku = payload.skus.find((s) => !s.sourceUrl);
  if (invalidSku) {
    throw new Error("SKU 图片地址无效");
  }
  if (payload.background.scale < 0.01) {
    throw new Error("背景缩放比例无效");
  }
  if (
    !payload.skuPanel ||
    !payload.skuPanel.width ||
    !payload.skuPanel.height ||
    payload.skuPanel.width < 1 ||
    payload.skuPanel.height < 1
  ) {
    throw new Error("SKU 面板尺寸无效");
  }

  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/image-center/square-main/slot1/manual`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    let messageVal = "手动生成第二张主图失败";
    try {
      const result = JSON.parse(text) as { message?: string | string[] };
      messageVal = Array.isArray(result.message)
        ? result.message.join("；")
        : result.message || messageVal;
    } catch {
      // 非 JSON 响应，直接使用文本或默认消息
    }
    throw new Error(messageVal);
  }

  return response.json();
}

export async function regenerateImageCategory(
  id: number,
  payload: {
    category: ImageCenterCategory;
    sourceImageId?: number | null;
    sourceSkuCode?: string | null;
    sourceUrl?: string | null;
    targetSlot?: number | null;
    generationMode?: "AI_WHITE_PRODUCT" | "AI_GENERATE" | "AI_COMPOSE";
  },
) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/image-center/regenerate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join("，")
      : result.message;
    throw new Error(message || "图片重生成失败");
  }

  return response.json();
}

export async function uploadImageCenterRawImage(
  id: number,
  file: File,
): Promise<ImageCenterRawImage> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/image-center/raw-images/upload`,
    {
      method: "POST",
      body: formData,
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join("，")
      : result.message;
    throw new Error(message || "上传图片失败");
  }

  const result = (await response.json()) as { image: ImageCenterRawImage };
  return result.image;
}

export async function retryImageCenterTask(id: number, taskId: number) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/image-center/tasks/${taskId}/retry`,
    {
      method: "POST",
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string };
    throw new Error(result.message || "任务重试失败");
  }

  return response.json();
}

export async function setDefaultGeneratedImage(id: number, assetId: number) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/image-center/generated-images/${assetId}/default`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        category: "square_main",
      }),
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string };
    throw new Error(result.message || "设置默认主图失败");
  }

  return response.json();
}

export async function downloadImageCenterCategory(
  id: number,
  category: ImageCenterCategory,
) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/image-center/download/${category}`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string };
    throw new Error(result.message || "下载模块失败");
  }

  return response.json() as Promise<{
    fileName: string;
    filePath: string;
    downloadUrl: string;
  }>;
}

export async function downloadImageCenterProduct(id: number) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/image-center/download`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string };
    throw new Error(result.message || "下载商品图片包失败");
  }

  return response.json() as Promise<{
    fileName: string;
    filePath: string;
    downloadUrl: string;
  }>;
}

export interface SmartCropImageItem {
  id: number | null;
  imageUrl: string;
  sourceImageUrl?: string;
  sourceSkuCode?: string | null;
  targetSlot?: number | null;
}

export async function smartCropImages(
  id: number,
  payload: {
    category: "square_main" | "portrait_main" | "long_main";
    images: SmartCropImageItem[];
  },
) {
  const response = await fetch(`${getApiBaseUrl()}/api/products/${id}/smart-crop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join("，")
      : result.message;
    throw new Error(message || `裁切失败 (${response.status})`);
  }

  return response.json();
}

export interface ManualCropImageItem {
  id: number;
  imageUrl: string;
  sourceImageUrl?: string;
  sourceSkuCode?: string | null;
  targetSlot?: number | null;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export async function manualCropImage(
  id: number,
  payload: {
    category: "square_main" | "portrait_main" | "long_main";
    images: ManualCropImageItem[];
  },
) {
  const response = await fetch(`${getApiBaseUrl()}/api/products/${id}/manual-crop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join("，")
      : result.message;
    throw new Error(message || `手动裁切失败 (${response.status})`);
  }

  return response.json();
}

export function getImportApiUrl() {
  return `${getClientApiBaseUrl()}/api/products/import`;
}

export function getImportTasksApiUrl() {
  return `${getClientApiBaseUrl()}/api/products/import/tasks`;
}

export function getImportTaskApiUrl(taskId: number) {
  return `${getClientApiBaseUrl()}/api/products/import/tasks/${taskId}`;
}

export async function fetchSizeChartTable(id: number) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/image-center/size-chart`,
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join("，")
      : result.message;
    throw new Error(message || "获取尺码表内容失败");
  }

  return response.json() as Promise<{
    headers: string[];
    rows: string[][];
    source: string;
  }>;
}

export async function aiComposeLongMain(
  id: number,
  productImageUrl: string,
  modelImageUrl: string,
) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/ai-compose-long-main`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productImageUrl,
        modelImageUrl,
      }),
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join("，")
      : result.message;
    throw new Error(message || "AI 合成失败");
  }

  return response.json() as Promise<{
    success: boolean;
    asset: {
      imageUrl: string;
      width: number;
      height: number;
    } | null;
  }>;
}

export async function updateSizeChart(
  id: number,
  payload: { headers: string[]; rows: string[][] },
) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/products/${id}/image-center/size-chart`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        headers: payload.headers,
        rows: payload.rows.map((cells) => ({ cells })),
      }),
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join("，")
      : result.message;
    throw new Error(message || "更新尺码图失败");
  }

  return response.json() as Promise<{
    success: boolean;
    asset: {
      imageUrl: string;
      category: string;
      slotIndex: number;
      width: number;
      height: number;
    } | null;
  }>;
}

export async function fetchStockMonitorProducts(): Promise<{
  items: import('@/lib/types').StockMonitorProduct[];
  total: number;
}> {
  const response = await fetch(`${getApiBaseUrl()}/api/stock-monitor/products`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join('，')
      : result.message;
    throw new Error(message || '获取库存监控列表失败');
  }

  return response.json();
}

export async function addStockMonitorProduct(url: string) {
  const response = await fetch(`${getApiBaseUrl()}/api/stock-monitor/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join('，')
      : result.message;
    throw new Error(message || '添加商品失败');
  }

  return response.json();
}

export async function deleteStockMonitorProduct(id: number) {
  const response = await fetch(`${getApiBaseUrl()}/api/stock-monitor/products/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const result = (await response.json()) as { message?: string };
    throw new Error(result.message || '删除商品失败');
  }

  return response.json();
}

export async function refreshStockMonitorProduct(
  id: number,
): Promise<import('@/lib/types').StockMonitorProduct> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/stock-monitor/products/${id}/refresh`,
    {
      method: 'POST',
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join('，')
      : result.message;
    throw new Error(message || '刷新库存失败');
  }

  return response.json();
}

export async function togglePinStockMonitorProduct(
  id: number,
): Promise<import('@/lib/types').StockMonitorProduct> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/stock-monitor/products/${id}/pin`,
    {
      method: 'POST',
    },
  );

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join('，')
      : result.message;
    throw new Error(message || '置顶操作失败');
  }

  return response.json();
}

export async function refreshAllStockMonitorProducts(): Promise<{
  items: import('@/lib/types').StockMonitorProduct[];
  total: number;
  refreshedCount: number;
  failedCount: number;
}> {
  const response = await fetch(`${getApiBaseUrl()}/api/stock-monitor/refresh-all`, {
    method: 'POST',
  });

  if (!response.ok) {
    const result = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(result.message)
      ? result.message.join('，')
      : result.message;
    throw new Error(message || '批量刷新库存失败');
  }

  return response.json();
}
