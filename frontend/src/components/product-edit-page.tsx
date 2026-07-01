"use client";

import {
  DownloadOutlined,
  EditOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Image,
  Input,
  Modal,
  Row,
  Space,
  Table,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { ProductSmartCropDialog } from "@/components/product-smart-crop-dialog";
import { ProductSquareMainSlot1Editor } from "@/components/product-square-main-slot1-editor";
import { ProductImageCropEditor } from "@/components/product-image-crop-editor";
import {
  aiComposeLongMain,
  downloadImageCenterCategory,
  downloadImageCenterProduct,
  fetchProductDetail,
  fetchProductImageCenter,
  fetchSizeChartTable,
  regenerateImageCategory,
  regenerateSquareMainSlot1,
  retryImageCenterTask,
  setDefaultGeneratedImage,
  smartCropImages,
  updateSizeChart,
  uploadImageCenterRawImage,
} from "@/lib/api";
import type {
  ImageCenterCategory,
  ImageCenterGeneratedImage,
  ImageCenterSkuImage,
  ImageCenterTask,
  ProductImageCenter,
} from "@/lib/types";

interface ProductEditFormValues {
  title?: string;
  brand?: string | null;
}

interface ProductEditPageProps {
  id: string;
}

interface ProductEditSnapshot {
  title: string;
  brand: string;
}

interface PickerState {
  category: "square_main" | "portrait_main" | "long_main" | "sku";
  targetSlot?: number;
  sourceSkuCode?: string;
  title: string;
}

interface FixedSlotItem {
  slotIndex: number;
  asset: ImageCenterGeneratedImage | null;
  task: ImageCenterTask | null;
  status: "SUCCESS" | "PROCESSING" | "FAILED" | "EMPTY";
}

const IMAGE_CENTER_META: Record<string, { label: string; className: string }> =
  {
    IDLE: { label: "未开始", className: "admin-process-pill" },
    QUEUED: { label: "已入队", className: "admin-process-processing" },
    PROCESSING: { label: "生成中", className: "admin-process-processing" },
    SUCCESS: { label: "已完成", className: "admin-process-success" },
    FAILED: { label: "失败", className: "admin-process-failed" },
  };

const IMAGE_CENTER_CATEGORY_LABELS: Record<ImageCenterCategory, string> = {
  square_main: "1:1主图",
  portrait_main: "3:4主图",
  long_main: "宝贝长图",
  detail: "详情图",
  sku: "SKU图",
  size_chart: "尺码图",
};

const IMAGE_CENTER_STATUS_ORDER: ImageCenterCategory[] = [
  "square_main",
  "portrait_main",
  "long_main",
  "detail",
  "sku",
  "size_chart",
];

function getSlotPendingKey(
  category: "square_main" | "portrait_main",
  slotIndex: number,
) {
  return `${category}:${slotIndex}`;
}

function isCategoryTaskProcessing(task: ImageCenterTask | null | undefined) {
  return task?.status === "PROCESSING" || task?.status === "QUEUED";
}

function findSlotAsset(
  imageCenter: ProductImageCenter | null,
  category: "square_main" | "portrait_main",
  slotIndex: number,
) {
  return (
    imageCenter?.categories?.[category]?.find(
      (asset) => (asset.slotIndex ?? asset.sortOrder ?? 0) === slotIndex,
    ) ?? null
  );
}

function getImageManagerStatusMeta(imageCenter: ProductImageCenter | null) {
  if (!imageCenter?.status) {
    return null;
  }

  const processingCategories = IMAGE_CENTER_STATUS_ORDER.filter((category) =>
    imageCenter.tasks.some(
      (task) => task.category === category && isCategoryTaskProcessing(task),
    ),
  );

  if (processingCategories.length) {
    return {
      label: `${processingCategories.map((category) => IMAGE_CENTER_CATEGORY_LABELS[category]).join("、")}生成中`,
      className: IMAGE_CENTER_META.PROCESSING.className,
    };
  }

  return (
    IMAGE_CENTER_META[imageCenter.status] || {
      label: imageCenter.status,
      className: "admin-process-pill",
    }
  );
}

function normalizeText(value?: string | null) {
  return (value || "").trim();
}

function createEditSnapshot(values: ProductEditFormValues): string {
  const snapshot: ProductEditSnapshot = {
    title: normalizeText(values.title),
    brand: normalizeText(values.brand),
  };

  return JSON.stringify(snapshot);
}

function getLatestCategoryTask(
  imageCenter: ProductImageCenter | null,
  category: ImageCenterCategory,
) {
  return imageCenter?.tasks.find((task) => task.category === category) ?? null;
}

function getLatestFailedTasks(imageCenter: ProductImageCenter | null) {
  if (!imageCenter || imageCenter.status !== "FAILED") {
    return [];
  }

  return IMAGE_CENTER_STATUS_ORDER.map((category) =>
    getLatestCategoryTask(imageCenter, category),
  ).filter((task): task is ImageCenterTask =>
    Boolean(task && task.status === "FAILED"),
  );
}

function getSlotTask(
  imageCenter: ProductImageCenter | null,
  category: ImageCenterCategory,
  slotIndex: number,
) {
  return (
    imageCenter?.tasks.find(
      (task) => task.category === category && task.targetSlot === slotIndex,
    ) ??
    imageCenter?.tasks.find(
      (task) =>
        task.category === category &&
        (task.targetSlot === undefined || task.targetSlot === null),
    ) ??
    null
  );
}

function getSkuItemTask(
  imageCenter: ProductImageCenter | null,
  sourceSkuCode?: string,
) {
  return (
    imageCenter?.tasks.find(
      (task) => task.category === "sku" && task.sourceSkuCode === sourceSkuCode,
    ) ??
    imageCenter?.tasks.find(
      (task) =>
        task.category === "sku" &&
        (task.sourceSkuCode === undefined || task.sourceSkuCode === null),
    ) ??
    null
  );
}

function buildFixedSlots(
  imageCenter: ProductImageCenter | null,
  category: "square_main" | "portrait_main",
  count: number,
): FixedSlotItem[] {
  const assets = imageCenter?.categories?.[category] || [];
  const assetMap = new Map<number, ImageCenterGeneratedImage>();

  for (const asset of assets) {
    assetMap.set(asset.slotIndex ?? asset.sortOrder ?? 0, asset);
  }

  const longMainAssets = imageCenter?.categories?.long_main || [];
  const hasLongMain = longMainAssets.length > 0;

  return Array.from({ length: count }, (_, slotIndex) => {
    const asset = assetMap.get(slotIndex) ?? null;
    const task = getSlotTask(imageCenter, category, slotIndex);

    let status: FixedSlotItem["status"] = "EMPTY";
    if (asset) {
      status = "SUCCESS";
    } else if (task?.status === "PROCESSING" || task?.status === "QUEUED") {
      status = "PROCESSING";
    } else if (task?.status === "FAILED") {
      status = "FAILED";
    } else if (category === "square_main" && slotIndex === 1 && !hasLongMain) {
      status = "PROCESSING";
    }

    return {
      slotIndex,
      asset,
      task,
      status,
    };
  });
}

function dedupeSkuSources(skuImages: ImageCenterSkuImage[]) {
  const deduped: ImageCenterSkuImage[] = [];
  const seen = new Set<string>();

  for (const sku of skuImages) {
    const key = `${sku.color || sku.name || sku.skuCode}__${sku.imageUrl || ""}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(sku);
  }

  return deduped;
}

function dedupeGeneratedSkuAssets(
  assets: ImageCenterGeneratedImage[],
  skuSourceMap: Map<string, ImageCenterSkuImage>,
) {
  const deduped: ImageCenterGeneratedImage[] = [];
  const seen = new Set<string>();

  for (const asset of assets) {
    const sku = asset.sourceSkuCode
      ? skuSourceMap.get(asset.sourceSkuCode)
      : undefined;
    const key = `${sku?.color || sku?.name || asset.sourceSkuCode || asset.id}__${asset.imageUrl}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(asset);
  }

  return deduped;
}

export function ProductEditPage({ id }: ProductEditPageProps) {
  const router = useRouter();
  const listReturnUrl = `/products?highlight=${id}`;
  const [form] = Form.useForm<ProductEditFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [imageCenter, setImageCenter] = useState<ProductImageCenter | null>(
    null,
  );
  const [imageCenterActionKey, setImageCenterActionKey] = useState<
    string | null
  >(null);
  const [pickerState, setPickerState] = useState<PickerState | null>(null);
  const [pickerSelectedImageId, setPickerSelectedImageId] = useState<
    number | null
  >(null);
  const [pickerHasUploadedImage, setPickerHasUploadedImage] = useState(false);
  const [pickerUploadedImageUrl, setPickerUploadedImageUrl] = useState<
    string | null
  >(null);
  const [pickerUploadedImageId, setPickerUploadedImageId] = useState<
    number | null
  >(null);
  const [smartCropOpen, setSmartCropOpen] = useState(false);
  const [smartCropCategory, setSmartCropCategory] = useState<
    "square_main" | "portrait_main"
  >("square_main");
  const [smartCropSelectedImages, setSmartCropSelectedImages] = useState<
    Array<{
      id: number;
      imageUrl: string;
      sourceImageUrl?: string;
      width?: number | null;
      height?: number | null;
      targetSlot?: number | null;
    }>
  >([]);
  const [optimisticProcessingSlots, setOptimisticProcessingSlots] = useState<
    Record<string, true>
  >({});
  const [isDirty, setIsDirty] = useState(false);
  const [sizeChartEditOpen, setSizeChartEditOpen] = useState(false);
  const [sizeChartHeaders, setSizeChartHeaders] = useState<string[]>([]);
  const [sizeChartRows, setSizeChartRows] = useState<string[][]>([]);
  const [sizeChartSaving, setSizeChartSaving] = useState(false);
  const [slot1EditorOpen, setSlot1EditorOpen] = useState(false);
  const [cropEditorState, setCropEditorState] = useState<{
    open: boolean;
    category: "square_main" | "portrait_main" | "long_main";
    targetSlot: number | null;
    imageId: number;
    imageUrl: string;
    sourceImageUrl: string;
    title: string;
  } | null>(null);
  const initialSnapshotRef = useRef("");
  const pickerFileInputRef = useRef<HTMLInputElement | null>(null);
  const savedScrollTopRef = useRef(0);
  const imageManagerStatusMeta = useMemo(
    () => getImageManagerStatusMeta(imageCenter),
    [imageCenter],
  );

  const loadDetail = useCallback(
    async (showMessage = false) => {
      setLoading(true);
      try {
        const [result, imageCenterResult] = await Promise.all([
          fetchProductDetail(id),
          fetchProductImageCenter(Number(id)),
        ]);
        setImageCenter(imageCenterResult);

        const initialValues: ProductEditFormValues = {
          title: result.title,
          brand: result.brand,
        };

        form.setFieldsValue(initialValues);
        initialSnapshotRef.current = createEditSnapshot(initialValues);
        setIsDirty(false);
        if (showMessage) {
          messageApi.success("商品与图片中心状态已刷新");
        }
      } catch (error) {
        messageApi.error(
          error instanceof Error ? error.message : "获取商品详情失败",
        );
      } finally {
        setLoading(false);
      }
    },
    [form, id, messageApi],
  );

  const failedImageCenterTasks = useMemo(
    () => getLatestFailedTasks(imageCenter),
    [imageCenter],
  );
  const squareSlots = useMemo(
    () =>
      buildFixedSlots(imageCenter, "square_main", 5).map((slot) =>
        optimisticProcessingSlots[
          getSlotPendingKey("square_main", slot.slotIndex)
        ]
          ? { ...slot, asset: null, status: "PROCESSING" as const }
          : slot,
      ),
    [imageCenter, optimisticProcessingSlots],
  );
  const portraitSlots = useMemo(
    () =>
      buildFixedSlots(imageCenter, "portrait_main", 5).map((slot) =>
        optimisticProcessingSlots[
          getSlotPendingKey("portrait_main", slot.slotIndex)
        ]
          ? { ...slot, asset: null, status: "PROCESSING" as const }
          : slot,
      ),
    [imageCenter, optimisticProcessingSlots],
  );
  const squareTask = useMemo(
    () => getLatestCategoryTask(imageCenter, "square_main"),
    [imageCenter],
  );
  const portraitTask = useMemo(
    () => getLatestCategoryTask(imageCenter, "portrait_main"),
    [imageCenter],
  );
  const longTask = useMemo(
    () => getLatestCategoryTask(imageCenter, "long_main"),
    [imageCenter],
  );
  const sizeChartTask = useMemo(
    () => getLatestCategoryTask(imageCenter, "size_chart"),
    [imageCenter],
  );
  const skuTask = useMemo(
    () => getLatestCategoryTask(imageCenter, "sku"),
    [imageCenter],
  );
  const detailTask = useMemo(
    () => getLatestCategoryTask(imageCenter, "detail"),
    [imageCenter],
  );
  const skuSourceMap = useMemo(
    () =>
      new Map((imageCenter?.skuImages || []).map((sku) => [sku.skuCode, sku])),
    [imageCenter],
  );
  const skuDisplayAssets = useMemo(() => {
    const assets = dedupeGeneratedSkuAssets(
      imageCenter?.categories?.sku || [],
      skuSourceMap,
    );

    if (assets.length) {
      return assets.map((asset, index) => {
        const sku = asset.sourceSkuCode
          ? skuSourceMap.get(asset.sourceSkuCode)
          : undefined;
        const skuTaskForItem = getSkuItemTask(
          imageCenter,
          asset.sourceSkuCode || undefined,
        );
        const status =
          skuTaskForItem?.status === "PROCESSING" ||
          skuTaskForItem?.status === "QUEUED"
            ? ("PROCESSING" as const)
            : skuTaskForItem?.status === "FAILED"
              ? ("FAILED" as const)
              : ("SUCCESS" as const);

        return {
          key: asset.id,
          label:
            sku?.color ||
            sku?.name ||
            asset.sourceSkuCode ||
            `SKU ${index + 1}`,
          imageUrl: asset.imageUrl,
          sourceSkuCode: asset.sourceSkuCode || undefined,
          sourceUrl: asset.sourceUrl || undefined,
          status,
          asset,
        };
      });
    }

    const dedupedSkuSources = dedupeSkuSources(imageCenter?.skuImages || []);
    return dedupedSkuSources.map((sku, index) => {
      const skuTaskForItem = getSkuItemTask(imageCenter, sku.skuCode);
      return {
        key: `${sku.skuCode}-${index}`,
        label: sku.color || sku.name || sku.skuCode,
        imageUrl: sku.imageUrl || "",
        sourceSkuCode: sku.skuCode,
        sourceUrl: sku.imageUrl || undefined,
        status:
          skuTaskForItem?.status === "PROCESSING" ||
          skuTaskForItem?.status === "QUEUED"
            ? ("PROCESSING" as const)
            : skuTaskForItem?.status === "FAILED"
              ? ("FAILED" as const)
              : ("EMPTY" as const),
        asset: null,
      };
    });
  }, [imageCenter, skuSourceMap]);

  function updateDirtyState(nextValues?: ProductEditFormValues) {
    if (!initialSnapshotRef.current) {
      setIsDirty(false);
      return;
    }

    const currentValues = nextValues ?? form.getFieldsValue(true);
    setIsDirty(
      createEditSnapshot(currentValues) !== initialSnapshotRef.current,
    );
  }

  function returnToList() {
    router.push(listReturnUrl, { scroll: false });
  }

  function showConfirm(options: {
    title: string;
    content: string;
    okText: string;
    cancelText?: string;
    danger?: boolean;
    onOk: () => void;
  }) {
    Modal.confirm({
      centered: true,
      className: "admin-edit-modal admin-confirm-modal",
      title: options.title,
      content: options.content,
      okText: options.okText,
      cancelText: options.cancelText || "取消",
      okButtonProps: options.danger ? { danger: true } : undefined,
      onOk: options.onOk,
    });
  }

  function handleCancelEdit() {
    if (!isDirty) {
      returnToList();
      return;
    }

    showConfirm({
      title: "确认放弃修改？",
      content: "当前页面有未保存的修改，放弃后本次编辑内容将丢失。",
      okText: "放弃修改",
      cancelText: "继续编辑",
      danger: true,
      onOk: returnToList,
    });
  }

  useEffect(() => {
    document.body.classList.add("admin-edit-page-body");
    return () => {
      document.body.classList.remove("admin-edit-page-body");
    };
  }, []);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    const isModalOpen = !!pickerState || !!cropEditorState?.open || slot1EditorOpen || smartCropOpen;
    if (isModalOpen) {
      document.body.classList.add("admin-modal-open");
    } else {
      document.body.classList.remove("admin-modal-open");
    }
  }, [pickerState, cropEditorState?.open, slot1EditorOpen, smartCropOpen]);

  useEffect(() => {
    if (!imageCenter) {
      return;
    }

    setOptimisticProcessingSlots((current) => {
      const next = { ...current };
      let changed = false;

      for (const key of Object.keys(current)) {
        const [category, targetValue] = key.split(":");
        if (!targetValue) {
          delete next[key];
          changed = true;
          continue;
        }

        if (category === "square_main" || category === "portrait_main") {
          const slotIndex = Number(targetValue);
          if (Number.isNaN(slotIndex)) {
            delete next[key];
            changed = true;
            continue;
          }

          if (
            findSlotAsset(imageCenter, category, slotIndex) ||
            getSlotTask(imageCenter, category, slotIndex)
          ) {
            delete next[key];
            changed = true;
          }
          continue;
        }

        if (category === "sku") {
          if (getSkuItemTask(imageCenter, targetValue)) {
            delete next[key];
            changed = true;
          }
          continue;
        }

        delete next[key];
        changed = true;
      }

      return changed ? next : current;
    });
  }, [imageCenter]);

  async function handleRegenerateCategory(
    category: ImageCenterCategory,
    payload?: {
      sourceImageId?: number | null;
      sourceSkuCode?: string | null;
      sourceUrl?: string | null;
      targetSlot?: number | null;
      generationMode?: "AI_WHITE_PRODUCT" | "AI_GENERATE" | "AI_COMPOSE";
    },
  ): Promise<boolean> {
    setImageCenterActionKey(`regenerate-${category}`);
    try {
      const result = await regenerateImageCategory(Number(id), {
        category,
        ...payload,
      });
      const isImmediateSkuReplace =
        category === "sku" &&
        payload?.sourceSkuCode &&
        result?.status === "SUCCESS";
      messageApi.success(
        isImmediateSkuReplace
          ? "SKU图已直接替换"
          : `${IMAGE_CENTER_CATEGORY_LABELS[category]}已重新入队`,
      );
      await loadDetail(true);
      return true;
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "图片重生成失败",
      );
      return false;
    } finally {
      setImageCenterActionKey(null);
    }
  }

  async function handleRegenerateSquareMainSlot1(): Promise<void> {
    setImageCenterActionKey("regenerate-square-main-slot1");
    try {
      const result = await regenerateSquareMainSlot1(Number(id));
      if (result.success) {
        messageApi.success("第二张主图合成成功");
      } else {
        messageApi.warning("合成失败，可能缺少SKU图或宝贝长图");
      }
      await loadDetail(true);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "第二张主图合成失败",
      );
    } finally {
      setImageCenterActionKey(null);
    }
  }

  async function handleOpenSizeChartEditor() {
    setSizeChartEditOpen(true);
    try {
      const result = await fetchSizeChartTable(Number(id));
      if (result?.headers?.length && result?.rows?.length) {
        setSizeChartHeaders(result.headers);
        setSizeChartRows(result.rows);
        return;
      }
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "获取尺码表内容失败",
      );
    }
    setSizeChartHeaders(["尺码", "胸围", "肩宽", "衣长", "袖长"]);
    setSizeChartRows([
      ["S", "88", "38", "64", "58"],
      ["M", "92", "39", "66", "59"],
      ["L", "96", "40", "68", "60"],
      ["XL", "100", "41", "70", "61"],
    ]);
  }

  async function handleSaveSizeChart() {
    const headers = sizeChartHeaders.map((h) => (h || "").trim());
    const rows = sizeChartRows.map((row) =>
      row.map((cell) => (cell || "").trim()),
    );

    if (!headers.length || headers.some((h) => !h)) {
      messageApi.warning("请确保每一列都有标题");
      return;
    }
    if (!rows.length) {
      messageApi.warning("至少需要一行数据");
      return;
    }

    setSizeChartSaving(true);
    try {
      const result = await updateSizeChart(Number(id), { headers, rows });
      if (!result.success || !result.asset) {
        throw new Error("生成尺码图失败");
      }
      messageApi.success("尺码图已生成");
      setSizeChartEditOpen(false);
      await loadDetail(true);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "保存尺码图失败",
      );
    } finally {
      setSizeChartSaving(false);
    }
  }

  async function handleRetryImageCenterTask(taskId: number) {
    setImageCenterActionKey(`task-${taskId}`);
    try {
      await retryImageCenterTask(Number(id), taskId);
      messageApi.success("任务已重新加入队列");
      await loadDetail(true);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "任务重试失败");
    } finally {
      setImageCenterActionKey(null);
    }
  }

  async function handleRetrySlot(
    category: "square_main" | "portrait_main",
    slotIndex: number,
    asset?: ImageCenterGeneratedImage | null,
  ) {
    const fallbackRawImage =
      imageCenter?.rawImages[slotIndex] || imageCenter?.rawImages[0];
    const sourceImageId = asset?.sourceImageId ?? fallbackRawImage?.id;
    const sourceUrl = asset?.sourceUrl ?? fallbackRawImage?.imageUrl;

    if (!sourceUrl) {
      messageApi.error("未找到可用原始图，无法重试该位置");
      return;
    }

    await handleRegenerateCategory(category, {
      targetSlot: slotIndex,
      sourceImageId,
      sourceUrl,
    });
  }

  async function handleSetDefaultGeneratedImage(assetId: number) {
    setImageCenterActionKey(`default-${assetId}`);
    try {
      await setDefaultGeneratedImage(Number(id), assetId);
      messageApi.success("已设为默认1:1主图");
      await loadDetail(true);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "设置默认主图失败",
      );
    } finally {
      setImageCenterActionKey(null);
    }
  }

  async function handleDownloadCategory(category: ImageCenterCategory) {
    setImageCenterActionKey(`download-${category}`);
    try {
      const result = await downloadImageCenterCategory(Number(id), category);
      window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "下载模块失败");
    } finally {
      setImageCenterActionKey(null);
    }
  }

  async function handleDownloadAllImages() {
    setImageCenterActionKey("download-all");
    try {
      const result = await downloadImageCenterProduct(Number(id));
      window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "下载商品图片包失败",
      );
    } finally {
      setImageCenterActionKey(null);
    }
  }

  function closePicker() {
    setPickerState(null);
    setPickerSelectedImageId(null);
    setPickerHasUploadedImage(false);
    setPickerUploadedImageUrl(null);
    setPickerUploadedImageId(null);
  }

  function closePickerWithoutPreserve() {
    setPickerState(null);
    setPickerSelectedImageId(null);
    setPickerHasUploadedImage(false);
    setPickerUploadedImageUrl(null);
    setPickerUploadedImageId(null);
  }

  function handleSubmitSelectedSourceImageAndClose(
    options?: { generationMode?: "AI_WHITE_PRODUCT" | "AI_GENERATE" | "AI_COMPOSE" },
  ): Promise<void> {
    const scrollTop = window.scrollY;
    closePicker();
    return handleSubmitSelectedSourceImage(options).finally(() => {
      // 等页面重新渲染完成后恢复滚动位置
      setTimeout(() => window.scrollTo(0, scrollTop), 0);
    });
  }

  function openPicker(
    category: "square_main" | "portrait_main",
    targetSlot: number,
  ): void;
  function openPicker(
    category: "long_main",
    targetSlot: number,
    title?: string,
  ): void;
  function openPicker(
    category: "sku",
    sourceSkuCode: string,
    title: string,
  ): void;
  function openPicker(
    category: "square_main" | "portrait_main" | "long_main" | "sku",
    target: number | string,
    title?: string,
  ) {
    setPickerSelectedImageId(null);
    setPickerHasUploadedImage(false);
    setPickerUploadedImageUrl(null);
    setPickerUploadedImageId(null);
    if (category === "sku") {
      setPickerState({
        category,
        sourceSkuCode: String(target),
        title: title || "选择SKU图来源图片",
      });
      return;
    }

    setPickerState({
      category,
      targetSlot: Number(target),
      title:
        title ||
        (category === "square_main"
          ? "选择1:1主图来源图片"
          : category === "portrait_main"
            ? "选择3:4主图来源图片"
            : "选择宝贝长图来源图片"),
    });
  }

  async function handleSubmitSelectedSourceImage(options?: {
    generationMode?: "AI_WHITE_PRODUCT" | "AI_GENERATE" | "AI_COMPOSE";
  }) {
    if (!pickerState) {
      return;
    }

    const currentPicker = pickerState;
    const isComposeMode = pickerHasUploadedImage && pickerUploadedImageUrl;

    // AI 合成模式：使用上传的图片，若右侧同时选中了抓取图片也一起传递
    if (isComposeMode) {
      const pendingKey =
        typeof currentPicker.targetSlot === "number" &&
        currentPicker.category === "square_main"
          ? getSlotPendingKey("square_main", currentPicker.targetSlot)
          : typeof currentPicker.targetSlot === "number" &&
              currentPicker.category === "portrait_main"
            ? getSlotPendingKey("portrait_main", currentPicker.targetSlot)
            : null;

      const scrollTop = window.scrollY;
      closePickerWithoutPreserve();
      if (pendingKey) {
        setOptimisticProcessingSlots((current) => ({
          ...current,
          [pendingKey]: true,
        }));
      }

      const selectedRawImage = pickerSelectedImageId
        ? imageCenter?.rawImages.find(
            (item) => item.id === pickerSelectedImageId,
          )
        : undefined;

      const success = await handleRegenerateCategory(currentPicker.category, {
        targetSlot: currentPicker.targetSlot,
        sourceImageId: selectedRawImage?.id ?? null,
        sourceUrl: pickerUploadedImageUrl!,
        sourceSkuCode: currentPicker.sourceSkuCode,
        generationMode: "AI_COMPOSE",
      });

      // 等页面重新渲染完成后恢复滚动位置
      setTimeout(() => window.scrollTo(0, scrollTop), 0);

      if (!success && pendingKey) {
        setOptimisticProcessingSlots((current) => {
          const next = { ...current };
          delete next[pendingKey];
          return next;
        });
      }
      return;
    }

    // AI 生图模式：必须从右侧选中一张抓取图片
    if (!pickerSelectedImageId) {
      return;
    }

    const rawImage = imageCenter?.rawImages.find(
      (item) => item.id === pickerSelectedImageId,
    );
    if (!rawImage) {
      messageApi.error("未找到选中的抓取图片");
      return;
    }

    const pendingKey =
      typeof currentPicker.targetSlot === "number" &&
      currentPicker.category === "square_main"
        ? getSlotPendingKey("square_main", currentPicker.targetSlot)
        : typeof currentPicker.targetSlot === "number" &&
            currentPicker.category === "portrait_main"
          ? getSlotPendingKey("portrait_main", currentPicker.targetSlot)
          : null;

    if (
      (currentPicker.category === "square_main" ||
        currentPicker.category === "portrait_main") &&
      !pendingKey
    ) {
      messageApi.error("当前修改项缺少必要参数");
      return;
    }

    const scrollTop = window.scrollY;
    closePickerWithoutPreserve();
    if (pendingKey) {
      setOptimisticProcessingSlots((current) => ({
        ...current,
        [pendingKey]: true,
      }));
    }

    const success = await handleRegenerateCategory(currentPicker.category, {
      targetSlot: currentPicker.targetSlot,
      sourceImageId: rawImage.id,
      sourceUrl: rawImage.imageUrl,
      sourceSkuCode: currentPicker.sourceSkuCode,
      generationMode: options?.generationMode,
    });

    // 等页面重新渲染完成后恢复滚动位置
    setTimeout(() => window.scrollTo(0, scrollTop), 0);

    if (!success && pendingKey) {
      setOptimisticProcessingSlots((current) => {
        const next = { ...current };
        delete next[pendingKey];
        return next;
      });
    }
  }

  const pickerConfirmLoading =
    Boolean(pickerState?.category) &&
    imageCenterActionKey === `regenerate-${pickerState?.category}`;
  const pickerSupportsAiGenerate =
    pickerState?.category === "square_main" ||
    pickerState?.category === "portrait_main" ||
    pickerState?.category === "long_main";
  const pickerAiGenerationMode =
    pickerState?.category === "square_main" && pickerState?.targetSlot === 0
      ? "AI_WHITE_PRODUCT"
      : "AI_GENERATE";

  async function handleUploadPickerImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setImageCenterActionKey("upload-picker-image");
    try {
      const uploadedImage = await uploadImageCenterRawImage(Number(id), file);
      setPickerHasUploadedImage(true);
      setPickerUploadedImageUrl(uploadedImage.imageUrl);
      setPickerUploadedImageId(uploadedImage.id ?? null);
      messageApi.success("图片上传成功");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "上传图片失败");
    } finally {
      setImageCenterActionKey(null);
    }
  }

  return (
    <AdminShell title="编辑商品">
      {contextHolder}

      <div className="admin-edit-page-bg">
        <div
          className="admin-edit-card admin-edit-surface admin-edit-form"
          style={{ display: loading ? "none" : "block" }}
        >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(_, allValues) => updateDirtyState(allValues)}
        >
          <Row gutter={16}>
            <Col xs={24} lg={12}>
              <Form.Item
                label="商品标题"
                name="title"
                rules={[{ required: true, message: "请输入商品标题" }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} lg={12}>
              <Form.Item label="品牌" name="brand">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Card
            className="admin-edit-section-card"
            bodyStyle={{ paddingBottom: 0 }}
            style={{ marginBottom: 24 }}
            title="Image Manager"
            extra={
              <Space wrap>
                {imageManagerStatusMeta ? (
                  <span
                    className={`admin-process-pill ${imageManagerStatusMeta.className || ""}`}
                  >
                    {imageManagerStatusMeta.label}
                  </span>
                ) : null}
                <Button onClick={() => void loadDetail(true)}>刷新状态</Button>
              </Space>
            }
          >
            <Space orientation="vertical" size={20} style={{ width: "100%" }}>
              <div className="admin-image-manager-panel">
                <div className="admin-image-manager-panel-header">
                  <div>
                    <Typography.Title level={5} style={{ margin: 0 }}>
                      1:1主图
                    </Typography.Title>
                    <Typography.Text type="secondary">
                      固定展示 5 个主图位置。
                    </Typography.Text>
                  </div>
                  <Space wrap>
                    {squareTask ? (
                      <span
                        className={`admin-process-pill ${IMAGE_CENTER_META[squareTask.status]?.className || ""}`}
                      >
                        {IMAGE_CENTER_META[squareTask.status]?.label ||
                          squareTask.status}
                      </span>
                    ) : null}
                    <Button
                      icon={<DownloadOutlined />}
                      loading={imageCenterActionKey === "download-square_main"}
                      onClick={() => void handleDownloadCategory("square_main")}
                    >
                      下载模块
                    </Button>
                  </Space>
                </div>

                <div className="admin-image-slot-grid admin-image-slot-grid-square">
                  {squareSlots.map((slot) => (
                    <div
                      className="admin-image-slot-card"
                      key={`square-${slot.slotIndex}`}
                    >
                      {slot.status === "SUCCESS" && slot.asset ? (
                        <div className="admin-image-slot-visual admin-image-slot-visual-square">
                          <Image
                            alt={`1:1主图 ${slot.slotIndex + 1}`}
                            src={slot.asset.imageUrl}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              borderRadius: 12,
                            }}
                          />
                        </div>
                      ) : (
                        <div className="admin-image-slot-empty admin-image-slot-visual-square">
                          <Typography.Text strong>
                            {slot.status === "PROCESSING"
                              ? "处理中"
                              : slot.status === "FAILED"
                                ? "处理失败"
                                : `位置 ${slot.slotIndex + 1}`}
                          </Typography.Text>
                          <Space
                            orientation="vertical"
                            size={8}
                            style={{ width: "100%" }}
                          >
                            {slot.status === "FAILED" ? (
                              <Button
                                block
                                loading={
                                  imageCenterActionKey ===
                                  `regenerate-square_main`
                                }
                                onClick={() =>
                                  void handleRetrySlot(
                                    "square_main",
                                    slot.slotIndex,
                                    slot.asset,
                                  )
                                }
                              >
                                重试
                              </Button>
                            ) : null}
                            <Button
                              block
                              icon={<EditOutlined />}
                              onClick={() => {
                                if (slot.slotIndex === 1) {
                                  setSlot1EditorOpen(true);
                                } else {
                                  openPicker("square_main", slot.slotIndex);
                                }
                              }}
                            >
                              修改
                            </Button>
                          </Space>
                        </div>
                      )}
                      <Space
                        orientation="vertical"
                        size={6}
                        style={{ width: "100%", marginTop: 12 }}
                      >
                        <Typography.Text strong>
                          {slot.asset?.isDefault
                            ? "默认主图"
                            : `1:1主图 ${slot.slotIndex + 1}`}
                        </Typography.Text>
                        {slot.asset ? (
                          <>
                            <Typography.Text type="secondary">
                              {slot.asset.width || "-"} ×{" "}
                              {slot.asset.height || "-"}
                            </Typography.Text>
                            <Button
                              block
                              icon={<EditOutlined />}
                              onClick={() => {
                                if (slot.slotIndex === 1) {
                                  setSlot1EditorOpen(true);
                                } else {
                                  openPicker("square_main", slot.slotIndex);
                                }
                              }}
                            >
                              修改
                            </Button>
                          </>
                        ) : null}
                      </Space>
                    </div>
                  ))}
                </div>
              </div>

              <div className="admin-image-manager-panel">
                <div className="admin-image-manager-panel-header">
                  <div>
                    <Typography.Title level={5} style={{ margin: 0 }}>
                      3:4主图
                    </Typography.Title>
                    <Typography.Text type="secondary">
                      固定展示 5 个竖版主图位置。
                    </Typography.Text>
                  </div>
                  <Space wrap>
                    {portraitTask ? (
                      <span
                        className={`admin-process-pill ${IMAGE_CENTER_META[portraitTask.status]?.className || ""}`}
                      >
                        {IMAGE_CENTER_META[portraitTask.status]?.label ||
                          portraitTask.status}
                      </span>
                    ) : null}
                    <Button
                      icon={<DownloadOutlined />}
                      loading={
                        imageCenterActionKey === "download-portrait_main"
                      }
                      onClick={() =>
                        void handleDownloadCategory("portrait_main")
                      }
                    >
                      下载模块
                    </Button>
                  </Space>
                </div>

                <div className="admin-image-slot-grid admin-image-slot-grid-square">
                  {portraitSlots.map((slot) => (
                    <div
                      className="admin-image-slot-card"
                      key={`portrait-${slot.slotIndex}`}
                    >
                      {slot.status === "SUCCESS" && slot.asset ? (
                        <div className="admin-image-slot-visual admin-image-slot-visual-portrait">
                          <Image
                            alt={`3:4主图 ${slot.slotIndex + 1}`}
                            src={slot.asset.imageUrl}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              borderRadius: 12,
                            }}
                          />
                        </div>
                      ) : (
                        <div className="admin-image-slot-empty admin-image-slot-visual-portrait">
                          <Typography.Text strong>
                            {slot.status === "PROCESSING"
                              ? "处理中"
                              : slot.status === "FAILED"
                                ? "处理失败"
                                : `位置 ${slot.slotIndex + 1}`}
                          </Typography.Text>
                          <Space
                            orientation="vertical"
                            size={8}
                            style={{ width: "100%" }}
                          >
                            {slot.status === "FAILED" ? (
                              <Button
                                block
                                loading={
                                  imageCenterActionKey ===
                                  `regenerate-portrait_main`
                                }
                                onClick={() =>
                                  void handleRetrySlot(
                                    "portrait_main",
                                    slot.slotIndex,
                                    slot.asset,
                                  )
                                }
                              >
                                重试
                              </Button>
                            ) : null}
                            <Button
                              block
                              icon={<EditOutlined />}
                              onClick={() =>
                                openPicker("portrait_main", slot.slotIndex)
                              }
                            >
                              修改
                            </Button>
                          </Space>
                        </div>
                      )}
                      <Space
                        orientation="vertical"
                        size={6}
                        style={{ width: "100%", marginTop: 12 }}
                      >
                        <Typography.Text
                          strong
                        >{`3:4主图 ${slot.slotIndex + 1}`}</Typography.Text>
                        {slot.asset ? (
                          <>
                            <Typography.Text type="secondary">
                              {slot.asset.width || "-"} ×{" "}
                              {slot.asset.height || "-"}
                            </Typography.Text>
                            <Button
                              block
                              icon={<EditOutlined />}
                              onClick={() =>
                                openPicker("portrait_main", slot.slotIndex)
                              }
                            >
                              修改
                            </Button>
                          </>
                        ) : null}
                      </Space>
                    </div>
                  ))}
                </div>
              </div>

              <div className="admin-image-manager-two-column">
                <div className="admin-image-manager-panel">
                  <div className="admin-image-manager-panel-header">
                    <div>
                      <Typography.Title level={5} style={{ margin: 0 }}>
                        宝贝长图
                      </Typography.Title>
                    </div>
                    <Space wrap>
                      {longTask ? (
                        <span
                          className={`admin-process-pill ${IMAGE_CENTER_META[longTask.status]?.className || ""}`}
                        >
                          {IMAGE_CENTER_META[longTask.status]?.label ||
                            longTask.status}
                        </span>
                      ) : null}
                    </Space>
                  </div>

                  {longTask?.status === "PROCESSING" ||
                  longTask?.status === "QUEUED" ? (
                    <div className="admin-image-slot-empty admin-image-single-card">
                      <Typography.Text strong>处理中</Typography.Text>
                      <Button
                        icon={<EditOutlined />}
                        onClick={() =>
                          openPicker("long_main", 0, "选择宝贝长图来源图片")
                        }
                        style={{ marginTop: 12 }}
                      >
                        修改
                      </Button>
                    </div>
                  ) : imageCenter?.categories.long_main?.[0] ? (
                    <div className="admin-image-single-card">
                      <Image
                        alt="宝贝长图"
                        src={imageCenter.categories.long_main[0].imageUrl}
                        style={{
                          width: "100%",
                          height: 360,
                          objectFit: "cover",
                          borderRadius: 12,
                        }}
                      />
                      <Space
                        orientation="vertical"
                        size={8}
                        style={{ width: "100%", marginTop: 12 }}
                      >
                        <Typography.Text type="secondary">
                          {imageCenter.categories.long_main[0].width || "-"} ×{" "}
                          {imageCenter.categories.long_main[0].height || "-"}
                        </Typography.Text>
                        <Button
                          block
                          icon={<EditOutlined />}
                          onClick={() =>
                            openPicker("long_main", 0, "选择宝贝长图来源图片")
                          }
                        >
                          修改
                        </Button>
                      </Space>
                    </div>
                  ) : (
                    <div className="admin-image-slot-empty admin-image-single-card">
                      <Typography.Text strong>
                        {longTask?.status === "PROCESSING" ||
                        longTask?.status === "QUEUED"
                          ? "处理中"
                          : longTask?.status === "FAILED"
                            ? "处理失败"
                            : "暂无长图"}
                      </Typography.Text>
                      {longTask?.status === "FAILED" ? (
                        <Button
                          onClick={() =>
                            void handleRegenerateCategory("long_main")
                          }
                        >
                          重试
                        </Button>
                      ) : null}
                      <Button
                        icon={<EditOutlined />}
                        onClick={() =>
                          openPicker("long_main", 0, "选择宝贝长图来源图片")
                        }
                      >
                        修改
                      </Button>
                    </div>
                  )}
                </div>

                <div className="admin-image-manager-panel">
                  <div className="admin-image-manager-panel-header">
                    <div>
                      <Typography.Title level={5} style={{ margin: 0 }}>
                        尺码图
                      </Typography.Title>
                    </div>
                    <Space wrap>
                      {sizeChartTask ? (
                        <span
                          className={`admin-process-pill ${IMAGE_CENTER_META[sizeChartTask.status]?.className || ""}`}
                        >
                          {IMAGE_CENTER_META[sizeChartTask.status]?.label ||
                            sizeChartTask.status}
                        </span>
                      ) : null}
                      <Button
                        icon={<ReloadOutlined />}
                        loading={
                          imageCenterActionKey === "regenerate-size_chart"
                        }
                        onClick={() =>
                          void handleRegenerateCategory("size_chart")
                        }
                      >
                        重新生成
                      </Button>
                      <Button
                        icon={<EditOutlined />}
                        onClick={() => void handleOpenSizeChartEditor()}
                      >
                        修改
                      </Button>
                      <Button
                        icon={<DownloadOutlined />}
                        loading={imageCenterActionKey === "download-size_chart"}
                        onClick={() =>
                          void handleDownloadCategory("size_chart")
                        }
                      >
                        下载模块
                      </Button>
                    </Space>
                  </div>

                  {imageCenter?.categories.size_chart?.[0] ? (
                    <div className="admin-image-single-card admin-image-single-card-size">
                      <Image
                        alt="尺码图"
                        src={imageCenter.categories.size_chart[0].imageUrl}
                        style={{
                          width: "100%",
                          height: "auto",
                          objectFit: "contain",
                          borderRadius: 12,
                          background: "#fff",
                        }}
                      />
                    </div>
                  ) : (
                    <div className="admin-image-slot-empty admin-image-single-card admin-image-single-card-size">
                      <Typography.Text strong>
                        {sizeChartTask?.status === "PROCESSING" ||
                        sizeChartTask?.status === "QUEUED"
                          ? "处理中"
                          : sizeChartTask?.status === "FAILED"
                            ? "处理失败"
                            : "暂无尺码图"}
                      </Typography.Text>
                      {sizeChartTask?.status === "FAILED" ? (
                        <Button
                          onClick={() =>
                            void handleRegenerateCategory("size_chart")
                          }
                        >
                          重试
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <Modal
                open={sizeChartEditOpen}
                title="修改尺码图内容"
                width={900}
                confirmLoading={sizeChartSaving}
                okText="生成尺码图"
                cancelText="取消"
                onCancel={() => {
                  if (sizeChartSaving) return;
                  setSizeChartEditOpen(false);
                }}
                onOk={() => void handleSaveSizeChart()}
                destroyOnHidden
              >
                <Space
                  orientation="vertical"
                  size={12}
                  style={{ width: "100%" }}
                >
                  <Typography.Text type="secondary">
                    点击单元格直接编辑内容，使用下方按钮可以添加/删除行或列。
                  </Typography.Text>
                  <div
                    style={{
                      border: "1px solid #f0f0f0",
                      borderRadius: 8,
                      overflow: "auto",
                    }}
                  >
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        background: "#fff",
                      }}
                    >
                      <thead>
                        <tr>
                          <th
                            style={{
                              border: "1px solid #f0f0f0",
                              padding: 8,
                              background: "#fafafa",
                              width: 56,
                              textAlign: "center",
                              fontSize: 12,
                              color: "#999",
                            }}
                          >
                            #
                          </th>
                          {sizeChartHeaders.map((header, colIndex) => (
                            <th
                              key={`h-${colIndex}`}
                              style={{
                                border: "1px solid #f0f0f0",
                                padding: 4,
                                background: "#fafafa",
                                minWidth: 140,
                              }}
                            >
                              <Input
                                size="small"
                                value={header}
                                onChange={(event) => {
                                  const next = [...sizeChartHeaders];
                                  next[colIndex] = event.target.value;
                                  setSizeChartHeaders(next);
                                }}
                              />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sizeChartRows.map((row, rowIndex) => (
                          <tr key={`r-${rowIndex}`}>
                            <td
                              style={{
                                border: "1px solid #f0f0f0",
                                padding: 8,
                                textAlign: "center",
                                fontSize: 12,
                                color: "#999",
                              }}
                            >
                              {rowIndex + 1}
                            </td>
                            {row.map((cell, colIndex) => (
                              <td
                                key={`c-${rowIndex}-${colIndex}`}
                                style={{
                                  border: "1px solid #f0f0f0",
                                  padding: 4,
                                }}
                              >
                                <Input
                                  size="small"
                                  value={cell}
                                  onChange={(event) => {
                                    const nextRows = sizeChartRows.map(
                                      (r, rIdx) => {
                                        if (rIdx !== rowIndex) return r;
                                        const nextRow = [...r];
                                        nextRow[colIndex] =
                                          event.target.value;
                                        return nextRow;
                                      },
                                    );
                                    setSizeChartRows(nextRows);
                                  }}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Space wrap>
                    <Button
                      size="small"
                      onClick={() => {
                        const newRow = sizeChartHeaders.map(() => "");
                        setSizeChartRows([...sizeChartRows, newRow]);
                      }}
                    >
                      + 添加行
                    </Button>
                    <Button
                      size="small"
                      disabled={sizeChartRows.length <= 1}
                      onClick={() => {
                        if (sizeChartRows.length <= 1) return;
                        setSizeChartRows(sizeChartRows.slice(0, -1));
                      }}
                    >
                      - 删除最后一行
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        setSizeChartHeaders([
                          ...sizeChartHeaders,
                          `列${sizeChartHeaders.length + 1}`,
                        ]);
                        setSizeChartRows(
                          sizeChartRows.map((row) => [...row, ""]),
                        );
                      }}
                    >
                      + 添加列
                    </Button>
                    <Button
                      size="small"
                      disabled={sizeChartHeaders.length <= 1}
                      onClick={() => {
                        if (sizeChartHeaders.length <= 1) return;
                        setSizeChartHeaders(
                          sizeChartHeaders.slice(0, -1),
                        );
                        setSizeChartRows(
                          sizeChartRows.map((row) => row.slice(0, -1)),
                        );
                      }}
                    >
                      - 删除最后一列
                    </Button>
                  </Space>
                </Space>
              </Modal>

              <div className="admin-image-manager-panel">
                <div className="admin-image-manager-panel-header">
                  <div>
                    <Typography.Title level={5} style={{ margin: 0 }}>
                      SKU图
                    </Typography.Title>
                    <Typography.Text type="secondary">
                      每个颜色规格仅展示一张图。
                    </Typography.Text>
                  </div>
                  <Space wrap>
                    {skuTask ? (
                      <span
                        className={`admin-process-pill ${IMAGE_CENTER_META[skuTask.status]?.className || ""}`}
                      >
                        {IMAGE_CENTER_META[skuTask.status]?.label ||
                          skuTask.status}
                      </span>
                    ) : null}
                    <Button
                      icon={<DownloadOutlined />}
                      loading={imageCenterActionKey === "download-sku"}
                      onClick={() => void handleDownloadCategory("sku")}
                    >
                      下载模块
                    </Button>
                  </Space>
                </div>

                {skuDisplayAssets.length ? (
                  <div className="admin-image-wide-grid">
                    {skuDisplayAssets.map((item) => (
                      <div className="admin-image-manager-item" key={item.key}>
                        {item.status === "SUCCESS" && item.imageUrl ? (
                          <Image
                            alt={item.label}
                            height={148}
                            src={item.imageUrl}
                            style={{
                              width: "100%",
                              objectFit: "cover",
                              borderRadius: 12,
                            }}
                            width={148}
                          />
                        ) : (
                          <div className="admin-image-slot-empty admin-image-slot-visual-square">
                            <Typography.Text strong>
                              {item.status === "PROCESSING"
                                ? "处理中"
                                : item.status === "FAILED"
                                  ? "处理失败"
                                  : "暂无图片"}
                            </Typography.Text>
                            {item.status === "FAILED" ? (
                              <Button
                                block
                                loading={
                                  imageCenterActionKey === "regenerate-sku"
                                }
                                onClick={() =>
                                  void handleRegenerateCategory("sku", {
                                    sourceSkuCode: item.sourceSkuCode,
                                    sourceUrl: item.sourceUrl,
                                  })
                                }
                              >
                                重试
                              </Button>
                            ) : null}
                          </div>
                        )}
                        <Space
                          orientation="vertical"
                          size={6}
                          style={{ width: "100%", marginTop: 10 }}
                        >
                          <Typography.Text strong>{item.label}</Typography.Text>
                          {item.asset?.sourceSkuCode ? (
                            <Typography.Text type="secondary">
                              来源 SKU：{item.asset.sourceSkuCode}
                            </Typography.Text>
                          ) : null}
                          {item.sourceSkuCode ? (
                            <Button
                              block
                              onClick={() =>
                                openPicker(
                                  "sku",
                                  item.sourceSkuCode as string,
                                  `选择SKU图「${item.label}」来源图片`,
                                )
                              }
                            >
                              修改
                            </Button>
                          ) : null}
                        </Space>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty description="暂无SKU图" />
                )}
              </div>

              <div className="admin-image-manager-panel">
                <div className="admin-image-manager-panel-header">
                  <div>
                    <Typography.Title level={5} style={{ margin: 0 }}>
                      详情图
                    </Typography.Title>
                    <Typography.Text type="secondary">
                      通栏展示全部详情图。
                    </Typography.Text>
                  </div>
                  <Space wrap>
                    {detailTask ? (
                      <span
                        className={`admin-process-pill ${IMAGE_CENTER_META[detailTask.status]?.className || ""}`}
                      >
                        {IMAGE_CENTER_META[detailTask.status]?.label ||
                          detailTask.status}
                      </span>
                    ) : null}
                    <Button
                      icon={<DownloadOutlined />}
                      loading={imageCenterActionKey === "download-detail"}
                      onClick={() => void handleDownloadCategory("detail")}
                    >
                      下载模块
                    </Button>
                  </Space>
                </div>

                {imageCenter?.categories.detail?.length ? (
                  <div className="admin-image-wide-grid">
                    {imageCenter.categories.detail.map((asset, index) => (
                      <div className="admin-image-manager-item" key={asset.id}>
                        <Image
                          alt={`详情图 ${index + 1}`}
                          height={164}
                          src={asset.imageUrl}
                          style={{
                            width: "100%",
                            objectFit: "cover",
                            borderRadius: 12,
                          }}
                          width={164}
                        />
                        <Space
                          orientation="vertical"
                          size={6}
                          style={{ width: "100%", marginTop: 10 }}
                        >
                          <Typography.Text
                            strong
                          >{`详情图 ${index + 1}`}</Typography.Text>
                        </Space>
                      </div>
                    ))}
                  </div>
                ) : detailTask?.status === "FAILED" ? (
                  <div className="admin-image-slot-empty admin-image-single-card">
                    <Typography.Text strong>详情图处理失败</Typography.Text>
                    <Typography.Text type="secondary">
                      {detailTask.lastError || "请重新处理详情图"}
                    </Typography.Text>
                    <Button
                      loading={imageCenterActionKey === `task-${detailTask.id}`}
                      onClick={() =>
                        void handleRetryImageCenterTask(detailTask.id)
                      }
                    >
                      重试任务
                    </Button>
                  </div>
                ) : detailTask?.status === "PROCESSING" ||
                  detailTask?.status === "QUEUED" ? (
                  <div className="admin-image-slot-empty admin-image-single-card">
                    <Typography.Text strong>处理中</Typography.Text>
                    <Typography.Text type="secondary">
                      详情图正在生成中
                    </Typography.Text>
                  </div>
                ) : (
                  <Empty description="暂无详情图" />
                )}
              </div>

              {failedImageCenterTasks.length ? (
                <div className="admin-image-manager-panel">
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    失败任务
                  </Typography.Title>
                  <Space
                    orientation="vertical"
                    size={12}
                    style={{ width: "100%", marginTop: 14 }}
                  >
                    {failedImageCenterTasks.map((task) => (
                      <div className="admin-image-task-item" key={task.id}>
                        <div>
                          <Typography.Text strong>
                            {IMAGE_CENTER_CATEGORY_LABELS[task.category]}
                          </Typography.Text>
                          <Typography.Paragraph
                            style={{ margin: "4px 0 0" }}
                            type="secondary"
                          >
                            {task.lastError || "任务失败"}
                          </Typography.Paragraph>
                        </div>
                        <Button
                          loading={imageCenterActionKey === `task-${task.id}`}
                          onClick={() =>
                            void handleRetryImageCenterTask(task.id)
                          }
                        >
                          重试任务
                        </Button>
                      </div>
                    ))}
                  </Space>
                </div>
              ) : null}
            </Space>
          </Card>

          <div className="admin-edit-actions-bar">
            <div className="admin-edit-actions-inner">
              <Space>
                <Button
                  className="admin-form-cancel-button"
                  onClick={handleCancelEdit}
                >
                  取消
                </Button>
                <Button
                  icon={<DownloadOutlined />}
                  loading={imageCenterActionKey === "download-all"}
                  onClick={() => void handleDownloadAllImages()}
                >
                  下载全部
                </Button>
              </Space>
            </div>
          </div>
        </Form>
      </div>
      </div>

      <Modal
        className="admin-edit-modal admin-picker-modal"
        closable={false}
        centered
        footer={
          <Space>
            <Button className="admin-modal-cancel-button" onClick={closePicker}>
              取消
            </Button>
            {pickerState?.category === "long_main" ? (
              <>
                {/* AI 合成：左侧上传 + 右侧选择 */}
                {pickerUploadedImageUrl && pickerSelectedImageId ? (
                  <Button
                    icon={<ThunderboltOutlined />}
                    loading={pickerConfirmLoading}
                    type="primary"
                    onClick={async () => {
                      const selectedRawImage =
                        imageCenter?.rawImages.find(
                          (r) => r.id === pickerSelectedImageId,
                        );
                      if (!pickerUploadedImageUrl || !selectedRawImage?.imageUrl) {
                        return;
                      }
                      const productImg = selectedRawImage.imageUrl;
                      const modelImg = pickerUploadedImageUrl;
                      const scrollTop = window.scrollY;
                      setImageCenterActionKey("regenerate-long_main");
                      closePicker();
                      try {
                        await aiComposeLongMain(
                          Number(id),
                          productImg,
                          modelImg,
                        );
                        await loadDetail(true);
                      } catch (error) {
                        messageApi.error(
                          error instanceof Error
                            ? error.message
                            : "AI 合成失败",
                        );
                      } finally {
                        setImageCenterActionKey(null);
                        // 等页面重新渲染完成后恢复滚动位置
                        setTimeout(() => window.scrollTo(0, scrollTop), 0);
                      }
                    }}
                  >
                    AI 合成
                  </Button>
                ) : null}
                {/* AI生图：只上传 或 只选择 */}
                {(pickerUploadedImageUrl && !pickerSelectedImageId) ||
                (!pickerUploadedImageUrl && pickerSelectedImageId) ? (
                  <Button
                    icon={<ThunderboltOutlined />}
                    loading={pickerConfirmLoading}
                    type="primary"
                    onClick={async () => {
                      let sourceUrl: string | null = null;
                      let sourceImageId: number | null = null;

                      if (pickerUploadedImageUrl) {
                        sourceUrl = pickerUploadedImageUrl;
                        sourceImageId = pickerUploadedImageId;
                      } else if (pickerSelectedImageId) {
                        const rawImage = imageCenter?.rawImages.find(
                          (r) => r.id === pickerSelectedImageId,
                        );
                        if (rawImage) {
                          sourceUrl = rawImage.imageUrl;
                          sourceImageId = rawImage.id;
                        }
                      }

                      if (!sourceUrl) {
                        return;
                      }

                      const scrollTop = window.scrollY;
                      setImageCenterActionKey("regenerate-long_main");
                      closePicker();
                      try {
                        await regenerateImageCategory(Number(id), {
                          category: "long_main",
                          sourceUrl,
                          sourceImageId,
                          generationMode: "AI_GENERATE",
                        });
                        await loadDetail(true);
                      } catch (error) {
                        messageApi.error(
                          error instanceof Error
                            ? error.message
                            : "AI生图失败",
                        );
                      } finally {
                        setImageCenterActionKey(null);
                        // 等页面重新渲染完成后恢复滚动位置
                        setTimeout(() => window.scrollTo(0, scrollTop), 0);
                      }
                    }}
                  >
                    AI生图
                  </Button>
                ) : null}
                <Button
                  disabled={
                    !!(
                      (pickerHasUploadedImage &&
                        pickerUploadedImageUrl &&
                        pickerSelectedImageId) ||
                      !(pickerUploadedImageUrl || pickerSelectedImageId)
                    )
                  }
                  loading={pickerConfirmLoading}
                  type={
                    (pickerUploadedImageUrl || pickerSelectedImageId) &&
                    !(pickerHasUploadedImage && pickerUploadedImageUrl && pickerSelectedImageId)
                      ? "primary"
                      : undefined
                  }
                  onClick={() => {
                    let cropImageId: number | null = null;
                    let cropImageUrl: string | null = null;

                    if (pickerHasUploadedImage && pickerUploadedImageUrl) {
                      cropImageId = pickerUploadedImageId;
                      cropImageUrl = pickerUploadedImageUrl;
                    } else if (pickerSelectedImageId) {
                      const rawImage = imageCenter?.rawImages.find(
                        (item) => item.id === pickerSelectedImageId,
                      );
                      if (rawImage) {
                        cropImageId = rawImage.id;
                        cropImageUrl = rawImage.imageUrl;
                      }
                    }

                    if (!cropImageUrl || !cropImageId || !pickerState) {
                      return;
                    }

                    const targetSlot = pickerState.targetSlot ?? null;

                    savedScrollTopRef.current = window.scrollY;
                    closePicker();
                    setTimeout(() => {
                      setCropEditorState({
                        open: true,
                        category: "long_main",
                        targetSlot,
                        imageId: cropImageId,
                        imageUrl: cropImageUrl,
                        sourceImageUrl: cropImageUrl,
                        title: "裁切宝贝长图",
                      });
                    }, 0);
                  }}
                >
                  裁切图片
                </Button>
              </>
            ) : pickerState?.category === "square_main" ||
              pickerState?.category === "portrait_main" ? (
              <>
                <Button
                  disabled={!pickerSelectedImageId}
                  icon={<ThunderboltOutlined />}
                  loading={pickerConfirmLoading}
                  type={pickerSelectedImageId ? "primary" : undefined}
                  onClick={() =>
                    void handleSubmitSelectedSourceImage({
                      generationMode: pickerAiGenerationMode,
                    })
                  }
                >
                  AI 生图
                </Button>
                <Button
                  disabled={!pickerSelectedImageId}
                  loading={pickerConfirmLoading}
                  type={pickerSelectedImageId ? "primary" : undefined}
                  onClick={() => {
                    const rawImage = imageCenter?.rawImages.find(
                      (item) => item.id === pickerSelectedImageId,
                    );
                    if (!rawImage || !pickerState) {
                      return;
                    }

                    const category = pickerState.category as
                      | "square_main"
                      | "portrait_main";
                    const slot = pickerState.targetSlot ?? 0;

                    savedScrollTopRef.current = window.scrollY;
                    closePicker();
                    setTimeout(() => {
                      setCropEditorState({
                        open: true,
                        category,
                        targetSlot: slot,
                        imageId: rawImage.id,
                        imageUrl: rawImage.imageUrl,
                        sourceImageUrl: rawImage.imageUrl,
                        title:
                          category === "square_main"
                            ? `裁切1:1主图 ${slot + 1}`
                            : `裁切3:4主图 ${slot + 1}`,
                      });
                    }, 0);
                  }}
                >
                  裁切图片
                </Button>
              </>
            ) : (
              <>
                {pickerSupportsAiGenerate ? (
                  <Button
                    disabled={!pickerSelectedImageId}
                    icon={<ThunderboltOutlined />}
                    loading={pickerConfirmLoading}
                    onClick={() =>
                      void handleSubmitSelectedSourceImage({
                        generationMode: pickerAiGenerationMode,
                      })
                    }
                  >
                    AI 生成
                  </Button>
                ) : null}
                <Button
                  className="admin-modal-ok-button"
                  disabled={!pickerSelectedImageId}
                  loading={pickerConfirmLoading}
                  type="primary"
                  onClick={() => void handleSubmitSelectedSourceImage()}
                >
                  确认
                </Button>
              </>
            )}
          </Space>
        }
        open={Boolean(pickerState)}
        title={
          <div className="admin-picker-modal-header-row">
            <Typography.Title
              className="admin-picker-modal-title"
              level={4}
              style={{ margin: 0 }}
            >
              {pickerState?.title || "选择来源图片"}
            </Typography.Title>
            <div className="admin-picker-modal-header-actions">
              {pickerState?.category !== "square_main" &&
                pickerState?.category !== "portrait_main" &&
                pickerState?.category !== "sku" &&
                pickerState?.category !== "long_main" ? (
                <>
                  <Button
                    icon={<UploadOutlined />}
                    loading={imageCenterActionKey === "upload-picker-image"}
                    onClick={() => pickerFileInputRef.current?.click()}
                  >
                    上传图片
                  </Button>
                  <input
                    accept="image/*"
                    ref={pickerFileInputRef}
                    style={{ display: "none" }}
                    type="file"
                    onChange={(event) => void handleUploadPickerImage(event)}
                  />
                </>
              ) : null}
            </div>
          </div>
        }
        width={1080}
        onCancel={closePicker}
      >
        <div className="admin-picker-modal-layout">
          {pickerState?.category === "long_main" ? (
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  width: 260,
                  minHeight: 520,
                  flexShrink: 0,
                  padding: 20,
                  border: "1px solid rgba(86, 122, 196, 0.16)",
                  borderRadius: 16,
                  backgroundColor: "rgba(8, 21, 49, 0.92)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Typography.Text
                  strong
                  style={{ display: "block", marginBottom: 12, color: "#e4ebff" }}
                >
                  上传图片
                </Typography.Text>
                {pickerUploadedImageUrl ? (
                  <div style={{ marginBottom: 12 }}>
                    <Image
                      alt="已上传图片"
                      preview={false}
                      src={pickerUploadedImageUrl}
                      style={{
                        width: "100%",
                        height: 260,
                        objectFit: "cover",
                        borderRadius: 12,
                        border: "2px solid #4ade80",
                      }}
                    />
                    <Typography.Text
                      style={{
                        display: "block",
                        marginTop: 10,
                        fontSize: 12,
                        textAlign: "center",
                        color: "#e4ebff",
                      }}
                    >
                      已上传 · 可点击&quot;AI 合成&quot;使用这张图片
                    </Typography.Text>
                  </div>
                ) : null}
                {pickerUploadedImageUrl ? (
                  <Space style={{ width: "100%", marginTop: "auto" }}>
                    <Button
                      icon={<UploadOutlined />}
                      loading={imageCenterActionKey === "upload-picker-image"}
                      onClick={() => pickerFileInputRef.current?.click()}
                      style={{ flex: 1 }}
                      type="primary"
                    >
                      重新选择
                    </Button>
                    <Button
                      onClick={() => {
                        setPickerHasUploadedImage(false);
                        setPickerUploadedImageUrl(null);
                        setPickerUploadedImageId(null);
                      }}
                      style={{ flex: 1 }}
                    >
                      清空
                    </Button>
                  </Space>
                ) : (
                  <Button
                    icon={<UploadOutlined />}
                    loading={imageCenterActionKey === "upload-picker-image"}
                    onClick={() => pickerFileInputRef.current?.click()}
                    style={{ width: "100%", marginTop: "auto" }}
                    type="primary"
                  >
                    选择图片
                  </Button>
                )}
                <input
                  accept="image/*"
                  ref={pickerFileInputRef}
                  style={{ display: "none" }}
                  type="file"
                  onChange={(event) => void handleUploadPickerImage(event)}
                />

              </div>
              <div
                style={{
                  flex: 1,
                  maxHeight: 520,
                  overflowY: "auto",
                  minWidth: 0,
                }}
              >
                {imageCenter?.rawImages.length ? (
                  <div
                    className="admin-image-picker-grid"
                    style={{
                      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                    }}
                  >
                    {imageCenter.rawImages
                      .filter(
                        (rawImage) => rawImage.sourceType !== "UPLOAD",
                      )
                      .map((rawImage) => (
                        <button
                          className={`admin-image-picker-item ${
                            pickerSelectedImageId === rawImage.id
                              ? "admin-image-picker-item-selected"
                              : ""
                          }`}
                          key={`picker-${rawImage.id}`}
                          type="button"
                          onClick={() =>
                            setPickerSelectedImageId((prev) =>
                              prev === rawImage.id ? null : rawImage.id,
                            )
                          }
                        >
                          <Image
                            alt={`原始图 ${rawImage.id}`}
                            height={148}
                            preview={false}
                            src={rawImage.imageUrl}
                            style={{
                              width: "100%",
                              objectFit: "cover",
                              borderRadius: 12,
                            }}
                            width={148}
                          />
                          <Typography.Text
                            style={{ display: "block", marginTop: 8, fontSize: 12, fontWeight: 400 }}
                          >
                            {rawImage.isCover
                            ? "当前抓取封面图"
                            : "抓取图片"}
                          </Typography.Text>
                        </button>
                      ))}
                  </div>
                ) : (
                  <Empty description="暂无可选抓取图片" />
                )}
              </div>
            </div>
          ) : (
            <div className="admin-picker-modal-scroll">
              {imageCenter?.rawImages.length ? (
                <div className="admin-image-picker-grid">
                  {imageCenter.rawImages
                    .filter(
                      (rawImage) => rawImage.sourceType !== "UPLOAD",
                    )
                    .map((rawImage) => (
                      <button
                        className={`admin-image-picker-item ${
                          pickerSelectedImageId === rawImage.id
                            ? "admin-image-picker-item-selected"
                            : ""
                        }`}
                        key={`picker-${rawImage.id}`}
                        type="button"
                        onClick={() =>
                          setPickerSelectedImageId((prev) =>
                            prev === rawImage.id ? null : rawImage.id,
                          )
                        }
                      >
                        <Image
                          alt={`原始图 ${rawImage.id}`}
                          height={148}
                          preview={false}
                          src={rawImage.imageUrl}
                          style={{
                            width: "100%",
                            objectFit: "cover",
                            borderRadius: 12,
                          }}
                          width={148}
                        />
                        <Typography.Text
                          style={{ display: "block", marginTop: 8, fontSize: 12, fontWeight: 400 }}
                        >
                          {rawImage.isCover ? "当前抓取封面图" : "抓取图片"}
                        </Typography.Text>
                      </button>
                    ))}
                </div>
              ) : (
                <Empty description="暂无可选抓取图片" />
              )}
            </div>
          )}
        </div>
      </Modal>

      <ProductSquareMainSlot1Editor
        open={slot1EditorOpen}
        productId={Number(id)}
        imageCenter={imageCenter}
        onClose={() => setSlot1EditorOpen(false)}
        onSaved={() => {
          setSlot1EditorOpen(false);
          void loadDetail(true);
        }}
      />

      <ProductSmartCropDialog
        open={smartCropOpen}
        onClose={() => setSmartCropOpen(false)}
        productId={Number(id)}
        category={smartCropCategory}
        selectedImages={smartCropSelectedImages}
        onSuccess={() => void loadDetail(true)}
      />

      <ProductImageCropEditor
        open={cropEditorState?.open ?? false}
        productId={Number(id)}
        category={cropEditorState?.category ?? "square_main"}
        targetSlot={cropEditorState?.targetSlot ?? null}
        imageId={cropEditorState?.imageId ?? 0}
        imageUrl={cropEditorState?.imageUrl ?? ""}
        sourceImageUrl={cropEditorState?.sourceImageUrl ?? ""}
        title={cropEditorState?.title ?? "裁切图片"}
        onClose={() => setCropEditorState(null)}
        onSaved={() => {
          const scrollTop = savedScrollTopRef.current;
          setCropEditorState(null);
          void loadDetail(true).then(() => {
            const restore = () => window.scrollTo(0, scrollTop);
            setTimeout(restore, 0);
            setTimeout(restore, 100);
            setTimeout(restore, 300);
          });
        }}
      />
    </AdminShell>
  );
}
