"use client";

import {
  Modal,
  Slider,
  Button,
  Space,
  Typography,
  Empty,
  Tag,
  message,
  Image as AntImage,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  generateSquareMainSlot1Manual,
  uploadImageCenterRawImage,
} from "@/lib/api";
import type { ImageCenterRawImage, ProductImageCenter } from "@/lib/types";

const OUTPUT_SIZE = 1440;
const DISPLAY_SIZE = 480;
const displayScale = DISPLAY_SIZE / OUTPUT_SIZE;

const DEFAULT_PANEL_RATIO = 0.18;
const MIN_PANEL_SIZE = 200;
const MAX_PANEL_SIZE_RATIO = 0.85;

interface EditorProps {
  open: boolean;
  productId: number;
  imageCenter: ProductImageCenter | null;
  onClose: () => void;
  onSaved: () => void;
}

interface BackgroundState {
  sourceUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

interface SkuImage {
  sourceUrl: string;
  sourceSkuCode?: string;
}

interface SkuPanelState {
  x: number;
  y: number;
  width: number;
  height: number;
}

type DragMode =
  | { type: "none" }
  | {
      type: "background";
      startX: number;
      startY: number;
      startOffsetX: number;
      startOffsetY: number;
    }
  | {
      type: "panel";
      startX: number;
      startY: number;
      startPanelX: number;
      startPanelY: number;
    }
  | {
      type: "panel-resize";
      startX: number;
      startY: number;
      startWidth: number;
      startHeight: number;
      startPanelX: number;
      startPanelY: number;
    };

type SourcePickerMode = "sku" | "background";

function pickSavedMetadata(
  imageCenter: ProductImageCenter | null,
): {
  backgroundUrl: string;
  backgroundOffsetX: number;
  backgroundOffsetY: number;
  backgroundScale: number;
  skuImages: SkuImage[];
  skuPanelX: number;
  skuPanelY: number;
  skuPanelWidth: number;
  skuPanelHeight: number;
} | null {
  const saved = imageCenter?.categories?.square_main?.find(
    (image) => image.slotIndex === 1,
  );
  if (!saved?.metadata) return null;
  const meta = saved.metadata as {
    generator?: string;
    background?: { sourceUrl?: string; offsetX?: number; offsetY?: number; scale?: number };
    skuPanel?: { x?: number; y?: number; width?: number; height?: number };
    skus?: Array<{ sourceUrl: string; sourceSkuCode?: string }>;
  };
  if (!meta.background?.sourceUrl) return null;
  if (!meta.skuPanel) return null;
  return {
    backgroundUrl: meta.background.sourceUrl,
    backgroundOffsetX: meta.background.offsetX ?? 0,
    backgroundOffsetY: meta.background.offsetY ?? 0,
    backgroundScale: meta.background.scale ?? 1,
    skuImages: meta.skus?.map((s) => ({
      sourceUrl: s.sourceUrl,
      sourceSkuCode: s.sourceSkuCode,
    })) ?? [],
    skuPanelX: meta.skuPanel.x ?? 0,
    skuPanelY: meta.skuPanel.y ?? 0,
    skuPanelWidth: meta.skuPanel.width ?? 200,
    skuPanelHeight: meta.skuPanel.height ?? 200,
  };
}

function pickBackgroundSource(
  imageCenter: ProductImageCenter | null,
): string {
  if (imageCenter?.categories?.long_main?.[0]?.imageUrl) {
    return imageCenter.categories.long_main[0].imageUrl;
  }
  if (imageCenter?.rawImages?.[0]?.imageUrl) {
    return imageCenter.rawImages[0].imageUrl;
  }
  if (imageCenter?.categories?.square_main?.[0]?.imageUrl) {
    return imageCenter.categories.square_main[0].imageUrl;
  }
  return "";
}

function pickSkuImages(
  imageCenter: ProductImageCenter | null,
): SkuImage[] {
  const generated = imageCenter?.categories?.sku || [];
  if (generated.length) {
    return generated
      .filter((asset) => asset?.imageUrl)
      .map((asset) => ({
        sourceUrl: asset.imageUrl,
        sourceSkuCode: asset.sourceSkuCode || undefined,
      }))
      .slice(0, 10);
  }
  const raw = imageCenter?.skuImages || [];
  return raw
    .filter((sku) => sku?.imageUrl)
    .slice(0, 10)
    .map((sku) => ({
      sourceUrl: sku.imageUrl!,
      sourceSkuCode: sku.skuCode,
    }));
}

// AI 生成的图片项（用于选择主图）
interface AiGeneratedImageItem {
  id: number;
  imageUrl: string;
  displayName: string;
}

// 判断是否用户明确点击 AI 生成的图片（generator 以 agnes-ai- 开头）
function isUserClickedAiImage(metadata?: Record<string, unknown> | null): boolean {
  if (!metadata) return false;
  const generator = (metadata as { generator?: string }).generator;
  if (!generator) return false;
  return generator.startsWith('agnes-ai-');
}

// 构建 AI 生成的图片列表（仅展示用户明确点击 AI 生成的）
function buildAiGeneratedImages(imageCenter: ProductImageCenter | null): AiGeneratedImageItem[] {
  const results: AiGeneratedImageItem[] = [];
  const seenUrls = new Set<string>();

  // 1. 1:1 主图（square_main）- slot 0, 2, 3, 4（跳过 slot 1）
  const squareMain = imageCenter?.categories?.square_main || [];
  for (const asset of squareMain) {
    if (asset.slotIndex === 1 || asset.slotIndex == null) continue;
    if (!isUserClickedAiImage(asset.metadata)) continue;
    if (!asset.imageUrl || seenUrls.has(asset.imageUrl)) continue;
    seenUrls.add(asset.imageUrl);
    results.push({
      id: asset.id,
      imageUrl: asset.imageUrl,
      displayName: `AI 1:1主图 第${asset.slotIndex + 1}张`,
    });
  }

  // 2. 3:4 主图（portrait_main）
  const portraitMain = imageCenter?.categories?.portrait_main || [];
  for (const asset of portraitMain) {
    if (asset.slotIndex == null) continue;
    if (!isUserClickedAiImage(asset.metadata)) continue;
    if (!asset.imageUrl || seenUrls.has(asset.imageUrl)) continue;
    seenUrls.add(asset.imageUrl);
    results.push({
      id: asset.id,
      imageUrl: asset.imageUrl,
      displayName: `AI 3:4主图 第${asset.slotIndex + 1}张`,
    });
  }

  // 3. 宝贝长图（long_main）
  const longMain = imageCenter?.categories?.long_main || [];
  for (const asset of longMain) {
    if (!isUserClickedAiImage(asset.metadata)) continue;
    if (!asset.imageUrl || seenUrls.has(asset.imageUrl)) continue;
    seenUrls.add(asset.imageUrl);
    results.push({
      id: asset.id,
      imageUrl: asset.imageUrl,
      displayName: "AI 宝贝长图",
    });
  }

  return results;
}

function computeCoverScale(
  naturalWidth: number,
  naturalHeight: number,
): number {
  if (!naturalWidth || !naturalHeight) return 1;
  return Math.max(OUTPUT_SIZE / naturalWidth, OUTPUT_SIZE / naturalHeight);
}

// 完整 contain：保证图片上下左右都不裁切（可能留白边）
function computeContainScale(
  naturalWidth: number,
  naturalHeight: number,
): number {
  if (!naturalWidth || !naturalHeight) return 1;
  return Math.min(OUTPUT_SIZE / naturalWidth, OUTPUT_SIZE / naturalHeight);
}

// offset 表示画布左上角对应缩放后图片的位置；负值表示图片在画布内留白居中。
function clampOffset(
  offset: number,
  naturalDim: number,
  scale: number,
): number {
  const scaledDim = naturalDim * scale;
  if (scaledDim <= OUTPUT_SIZE) {
    return Math.round((scaledDim - OUTPUT_SIZE) / 2);
  }
  return Math.max(0, Math.min(scaledDim - OUTPUT_SIZE, Math.round(offset)));
}

function computeDefaultPanel(
  count: number,
): SkuPanelState {
  const columns = count <= 5 ? 1 : 2;
  const rows = Math.ceil(count / columns) || 1;
  const panelWidth = Math.round(OUTPUT_SIZE * DEFAULT_PANEL_RATIO);
  const cellWidth = Math.floor(panelWidth / columns);
  const cellHeight = cellWidth;
  let panelHeight = cellHeight * rows;

  const maxPanelHeight = OUTPUT_SIZE * MAX_PANEL_SIZE_RATIO;
  if (panelHeight > maxPanelHeight) {
    const scale = maxPanelHeight / panelHeight;
    panelHeight = Math.round(maxPanelHeight);
    const scaledWidth = Math.round(panelWidth * scale);
    return {
      x: Math.max(0, Math.round((OUTPUT_SIZE - scaledWidth) / 2)),
      y: Math.max(0, Math.round((OUTPUT_SIZE - panelHeight) / 2)),
      width: scaledWidth,
      height: panelHeight,
    };
  }

  // 确保不超出边界
  const safeWidth = Math.min(panelWidth, OUTPUT_SIZE);
  const safeHeight = Math.min(panelHeight, OUTPUT_SIZE);
  const panelX = Math.max(0, Math.round((OUTPUT_SIZE - safeWidth) / 2));
  const panelY = Math.max(0, Math.round((OUTPUT_SIZE - safeHeight) / 2));
  return {
    x: panelX,
    y: panelY,
    width: safeWidth,
    height: safeHeight,
  };
}

export function ProductSquareMainSlot1Editor({
  open,
  productId,
  imageCenter,
  onClose,
  onSaved,
}: EditorProps) {
  const [backgroundUrl, setBackgroundUrl] = useState("");
  const [background, setBackground] = useState<BackgroundState | null>(null);
  const [bgLoadVersion, setBgLoadVersion] = useState(0);
  const [skuImages, setSkuImages] = useState<SkuImage[]>([]);
  const [skuPanel, setSkuPanel] = useState<SkuPanelState>(
    computeDefaultPanel(0),
  );
  const [saving, setSaving] = useState(false);
  const [sourcePickerMode, setSourcePickerMode] =
    useState<SourcePickerMode | null>(null);
  const [sourcePickerSelectedIds, setSourcePickerSelectedIds] = useState<
    number[]
  >([]);
  const [uploading, setUploading] = useState(false);
  const dragRef = useRef<DragMode>({ type: "none" });
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const rawSourceImages = useMemo(
    () =>
      (imageCenter?.rawImages || []).filter(
        (rawImage) => rawImage.sourceType !== "UPLOAD",
      ),
    [imageCenter],
  );

  const allSourceImages = useMemo(
    () => imageCenter?.rawImages || [],
    [imageCenter],
  );

  // 统一的 SKU 候选图片列表（从 rawImages + skuImages + categories.sku 收集）
  const skuPickerCandidateImages = useMemo(() => {
    const results: Array<{ id: number; imageUrl: string }> = [];
    const seenUrls = new Set<string>();

    // 1. 添加 rawImages 中的图片（不含 UPLOAD）
    for (const raw of rawSourceImages) {
      if (!raw.imageUrl || seenUrls.has(raw.imageUrl)) continue;
      seenUrls.add(raw.imageUrl);
      results.push({ id: raw.id, imageUrl: raw.imageUrl });
    }

    // 2. 添加 categories.sku 中的图片
    const generatedSku = imageCenter?.categories?.sku || [];
    for (const asset of generatedSku) {
      if (!asset.imageUrl || seenUrls.has(asset.imageUrl)) continue;
      seenUrls.add(asset.imageUrl);
      results.push({ id: asset.id, imageUrl: asset.imageUrl });
    }

    // 3. 添加 skuImages 中的图片
    const skuImgs = imageCenter?.skuImages || [];
    for (let i = 0; i < skuImgs.length; i++) {
      const sku = skuImgs[i];
      if (!sku.imageUrl || seenUrls.has(sku.imageUrl)) continue;
      seenUrls.add(sku.imageUrl);
      // 用负数 id 避免与真实 id 冲突
      results.push({ id: -1 - i, imageUrl: sku.imageUrl });
    }

    return results;
  }, [imageCenter, rawSourceImages]);

  const [newUploadedImages, setNewUploadedImages] = useState<
    ImageCenterRawImage[]
  >([]);

  const pickerImages = useMemo(() => {
    if (sourcePickerMode === "background") {
      const uploadedIds = new Set(newUploadedImages.map((img) => img.id));
      const otherImages = allSourceImages.filter(
        (img) => !uploadedIds.has(img.id),
      );
      // AI 生成的图片放到最前面
      const aiImages = buildAiGeneratedImages(imageCenter);
      return [...aiImages, ...newUploadedImages, ...otherImages];
    }
    if (sourcePickerMode === "sku") {
      return skuPickerCandidateImages as ImageCenterRawImage[];
    }
    return rawSourceImages;
  }, [sourcePickerMode, allSourceImages, rawSourceImages, newUploadedImages, skuPickerCandidateImages, imageCenter]);

  async function handleUploadBackgroundImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setUploading(true);
    try {
      const uploadedImage = await uploadImageCenterRawImage(productId, file);
      setNewUploadedImages((prev) => [uploadedImage, ...prev]);
      setSourcePickerSelectedIds([uploadedImage.id]);
      message.success("图片上传成功");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "上传图片失败");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const savedMeta = pickSavedMetadata(imageCenter);
    const bgUrl = savedMeta?.backgroundUrl || pickBackgroundSource(imageCenter);
    const skus = (savedMeta?.skuImages.length ? savedMeta.skuImages : null) || pickSkuImages(imageCenter);
    
    setSkuImages(skus);
    setBackgroundUrl(bgUrl);
    setBackground(null);
    setBgLoadVersion((v) => v + 1);
    
    if (savedMeta) {
      setSkuPanel({
        x: savedMeta.skuPanelX,
        y: savedMeta.skuPanelY,
        width: savedMeta.skuPanelWidth,
        height: savedMeta.skuPanelHeight,
      });
    } else {
      setSkuPanel(computeDefaultPanel(skus.length));
    }
    
    setSourcePickerMode(null);
    setSourcePickerSelectedIds([]);
  }, [open, imageCenter]);

  useEffect(() => {
    if (!backgroundUrl) return;
    const savedMeta = pickSavedMetadata(imageCenter);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;
      const minScale = OUTPUT_SIZE / naturalWidth;

      if (savedMeta && savedMeta.backgroundUrl === backgroundUrl && savedMeta.backgroundScale >= minScale - 0.001) {
        const scaledW = naturalWidth * savedMeta.backgroundScale;
        const scaledH = naturalHeight * savedMeta.backgroundScale;
        setBackground({
          sourceUrl: backgroundUrl,
          naturalWidth,
          naturalHeight,
          offsetX: scaledW > OUTPUT_SIZE ? savedMeta.backgroundOffsetX : 0,
          offsetY: scaledH > OUTPUT_SIZE ? savedMeta.backgroundOffsetY : (scaledH - OUTPUT_SIZE) / 2,
          scale: savedMeta.backgroundScale,
        });
      } else {
        const scale = OUTPUT_SIZE / naturalWidth;
        const scaledH = naturalHeight * scale;
        setBackground({
          sourceUrl: backgroundUrl,
          naturalWidth,
          naturalHeight,
          offsetX: 0,
          offsetY: (scaledH - OUTPUT_SIZE) / 2,
          scale: scale,
        });
      }
    };
    img.onerror = () => {
      message.warning("背景图片加载失败");
    };
    img.src = backgroundUrl;
  }, [backgroundUrl, imageCenter, bgLoadVersion]);

  const columns = useMemo(
    () => (skuImages.length <= 5 ? 1 : 2),
    [skuImages.length],
  );
  const rows = useMemo(
    () => Math.ceil(skuImages.length / columns) || 1,
    [skuImages.length, columns],
  );

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (drag.type === "none" || !background) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (drag.type === "background") {
        const dOutX = dx / displayScale;
        const dOutY = dy / displayScale;
        setBackground((prev) => {
          if (!prev) return prev;
          const offsetX = clampOffset(
            drag.startOffsetX - dOutX,
            prev.naturalWidth,
            prev.scale,
          );
          const offsetY = clampOffset(
            drag.startOffsetY - dOutY,
            prev.naturalHeight,
            prev.scale,
          );
          return { ...prev, offsetX, offsetY };
        });
      } else if (drag.type === "panel") {
        const dOutX = dx / displayScale;
        const dOutY = dy / displayScale;
        setSkuPanel((prev) => {
          const nextX = Math.max(
            0,
            Math.min(OUTPUT_SIZE - prev.width, drag.startPanelX + dOutX),
          );
          const nextY = Math.max(
            0,
            Math.min(OUTPUT_SIZE - prev.height, drag.startPanelY + dOutY),
          );
          return { ...prev, x: Math.round(nextX), y: Math.round(nextY) };
        });
      } else if (drag.type === "panel-resize") {
        const aspect = drag.startWidth / drag.startHeight;
        const dragDist = Math.max(dx, dy);
        const reference = Math.sqrt(
          drag.startWidth * drag.startWidth +
            drag.startHeight * drag.startHeight,
        );
        const currentDiag = reference + dragDist / displayScale;
        const scaleFactor = currentDiag / reference;

        const maxDimension = Math.round(OUTPUT_SIZE * MAX_PANEL_SIZE_RATIO);
        let newWidth = drag.startWidth * scaleFactor;
        newWidth = Math.max(MIN_PANEL_SIZE, Math.min(maxDimension, newWidth));
        let newHeight = newWidth / aspect;
        newHeight = Math.max(MIN_PANEL_SIZE, Math.min(maxDimension, newHeight));
        newWidth = newHeight * aspect;

        newWidth = Math.min(newWidth, OUTPUT_SIZE - drag.startPanelX);
        newHeight = Math.min(newHeight, OUTPUT_SIZE - drag.startPanelY);

        setSkuPanel((prev) => ({
          ...prev,
          x: drag.startPanelX,
          y: drag.startPanelY,
          width: Math.round(newWidth),
          height: Math.round(newHeight),
        }));
      }
    }

    function onUp() {
      dragRef.current = { type: "none" };
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [background]);

  // 最小缩放 = 宽度填满画布
  const minScale = background
    ? OUTPUT_SIZE / background.naturalWidth
    : 1;
  const maxScale = minScale * 3;

  function handleScaleChange(value: number) {
    if (!background) return;
    const naturalWidth = background.naturalWidth;
    const naturalHeight = background.naturalHeight;

    const oldScaledW = naturalWidth * background.scale;
    const oldScaledH = naturalHeight * background.scale;
    const newScaledW = naturalWidth * value;
    const newScaledH = naturalHeight * value;

    // 计算当前的裁切位置比例（pan = 0 表示左/上对齐，pan = 1 表示右/下对齐）
    // 水平方向：初始 offsetX = 0 → panX = 0（从左侧开始）
    // 垂直方向：初始 offsetY = (scaledH-OUTPUT_SIZE)/2 → panY = 0.5（垂直居中）
    const overflowW = oldScaledW - OUTPUT_SIZE;
    const overflowH = oldScaledH - OUTPUT_SIZE;
    const panX = overflowW > 0 ? background.offsetX / overflowW : 0;
    const panY = overflowH > 0 ? background.offsetY / overflowH : 0.5;

    // 用相同的裁切位置比例计算新的 offset
    const newOverflowW = newScaledW - OUTPUT_SIZE;
    const newOverflowH = newScaledH - OUTPUT_SIZE;
    let newOffsetX;
    let newOffsetY;

    if (newOverflowW > 0) {
      newOffsetX = Math.max(0, Math.min(newOverflowW, panX * newOverflowW));
    } else {
      newOffsetX = (newScaledW - OUTPUT_SIZE) / 2;
    }
    if (newOverflowH > 0) {
      newOffsetY = Math.max(0, Math.min(newOverflowH, panY * newOverflowH));
    } else {
      newOffsetY = (newScaledH - OUTPUT_SIZE) / 2;
    }

    setBackground((prev) =>
      prev
        ? {
            ...prev,
            scale: value,
            offsetX: newOffsetX,
            offsetY: newOffsetY,
          }
        : prev,
    );
  }

  function handleReset() {
    if (!background) return;
    const scale = OUTPUT_SIZE / background.naturalWidth;
    const scaledH = background.naturalHeight * scale;
    setBackground((prev) =>
      prev
        ? {
            ...prev,
            scale: scale,
            offsetX: 0,
            offsetY: (scaledH - OUTPUT_SIZE) / 2,
          }
        : prev,
    );
    setSkuPanel(computeDefaultPanel(skuImages.length));
  }

  function openSourcePicker(mode: SourcePickerMode) {
    setSourcePickerMode(mode);
    if (mode === "background") {
      setNewUploadedImages([]);
      const allImages = [...allSourceImages];
      const current = allImages.find(
        (rawImage) => rawImage.imageUrl === backgroundUrl,
      );
      setSourcePickerSelectedIds(current ? [current.id] : []);
      return;
    }

    const selectedIds = skuPickerCandidateImages
      .filter((candidate) =>
        skuImages.some((sku) => sku.sourceUrl === candidate.imageUrl),
      )
      .map((candidate) => candidate.id)
      .slice(0, 10);
    setSourcePickerSelectedIds(selectedIds);
  }

  function closeSourcePicker() {
    setSourcePickerMode(null);
    setSourcePickerSelectedIds([]);
  }

  function toggleSourceImage(rawImage: { id: number; imageUrl: string }) {
    setSourcePickerSelectedIds((current) => {
      if (sourcePickerMode === "background") {
        return current[0] === rawImage.id ? [] : [rawImage.id];
      }

      if (current.includes(rawImage.id)) {
        return current.filter((id) => id !== rawImage.id);
      }
      if (current.length >= 10) {
        message.warning("SKU 图片最多选择 10 张");
        return current;
      }
      return [...current, rawImage.id];
    });
  }

  function applySourcePickerSelection() {
    if (!sourcePickerMode) {
      return;
    }

    const allImages = sourcePickerMode === "background"
      ? pickerImages
      : skuPickerCandidateImages;
    const selectedImages = sourcePickerSelectedIds
      .map((selectedId) =>
        allImages.find((rawImage) => rawImage.id === selectedId),
      )
      .filter((rawImage): rawImage is ImageCenterRawImage | { id: number; imageUrl: string } => Boolean(rawImage));

    if (sourcePickerMode === "background") {
      const selectedImage = selectedImages[0];
      if (!selectedImage) {
        message.warning("请选择一张主图");
        return;
      }
      setBackgroundUrl(selectedImage.imageUrl);
      setBackground(null);
      closeSourcePicker();
      return;
    }

    if (selectedImages.length < 2 || selectedImages.length > 10) {
      message.warning("SKU 图片请选择 2-10 张");
      return;
    }

    const nextSkuImages = selectedImages.map((rawImage) => ({
      sourceUrl: rawImage.imageUrl,
    }));
    setSkuImages(nextSkuImages);
    setSkuPanel(computeDefaultPanel(nextSkuImages.length));
    closeSourcePicker();
  }

  async function handleSave() {
    if (!background) {
      message.error("缺少背景图片");
      return;
    }
    if (!skuImages.length) {
      message.error("缺少 SKU 图片");
      return;
    }
    if (skuImages.length < 2 || skuImages.length > 10) {
      message.error("SKU 图片请选择 2-10 张");
      return;
    }

    const scaledWidth = background.naturalWidth * background.scale;
    const scaledHeight = background.naturalHeight * background.scale;

    // 确保 offsetX/Y 在有效范围内：
    // - 当 scaledWidth > OUTPUT_SIZE 时，offsetX 在 [0, scaledWidth - OUTPUT_SIZE]
    // - 当 scaledWidth <= OUTPUT_SIZE 时，图片居中，offsetX 为负数
    const effectiveOffsetX =
      scaledWidth > OUTPUT_SIZE
        ? Math.max(0, Math.min(scaledWidth - OUTPUT_SIZE, background.offsetX))
        : (scaledWidth - OUTPUT_SIZE) / 2;

    const effectiveOffsetY =
      scaledHeight > OUTPUT_SIZE
        ? Math.max(0, Math.min(scaledHeight - OUTPUT_SIZE, background.offsetY))
        : (scaledHeight - OUTPUT_SIZE) / 2;

    // 确保 scale 在合理范围内
    const effectiveScale = Math.max(OUTPUT_SIZE / background.naturalWidth, background.scale);

    setSaving(true);
    try {
      await generateSquareMainSlot1Manual(productId, {
        background: {
          sourceUrl: background.sourceUrl,
          offsetX: effectiveOffsetX,
          offsetY: effectiveOffsetY,
          scale: effectiveScale,
        },
        skus: skuImages,
        skuPanel: {
          x: Math.round(skuPanel.x),
          y: Math.round(skuPanel.y),
          width: Math.round(skuPanel.width),
          height: Math.round(skuPanel.height),
        },
      });
      message.success("已生成 1:1 主图 2");
      onSaved();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "生成失败，请重试",
      );
    } finally {
      setSaving(false);
    }
  }

  const bgScaledWidth = background
    ? background.naturalWidth * background.scale * displayScale
    : 0;
  const bgScaledHeight = background
    ? background.naturalHeight * background.scale * displayScale
    : 0;
  const bgLeft = background ? -background.offsetX * displayScale : 0;
  const bgTop = background ? -background.offsetY * displayScale : 0;

  const panelLeft = skuPanel.x * displayScale;
  const panelTop = skuPanel.y * displayScale;
  const panelWidth = skuPanel.width * displayScale;
  const panelHeight = skuPanel.height * displayScale;
  const cellDisplayWidth = panelWidth / columns;
  const cellDisplayHeight = panelHeight / rows;

  const MODAL_BG = "rgba(8, 21, 49, 0.92)";

  return (
    <Modal
      className="admin-edit-modal admin-picker-modal"
      closable={false}
      centered
      open={open}
      title={
        <Space size={8}>
          <Typography.Title
            className="admin-picker-modal-title"
            level={4}
            style={{ margin: 0 }}
          >
            编辑 1:1 主图 2
          </Typography.Title>
          <Tag color="blue">目标尺寸 1440 × 1440</Tag>
        </Space>
      }
      width={960}
      destroyOnClose
      styles={{
        body: {
          maxHeight: "calc(100vh - 200px)",
          overflowY: "auto",
        },
      }}
      onCancel={() => {
        if (!saving) onClose();
      }}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
          <Space>
            <Button disabled={saving} onClick={() => openSourcePicker("sku")}>
              sku图片修改
            </Button>
            <Button
              disabled={saving}
              onClick={() => openSourcePicker("background")}
            >
              主图修改
            </Button>
          </Space>
          <Space>
            <Button disabled={saving} onClick={onClose}>
              取消
            </Button>
            <Button
              type="primary"
              loading={saving}
              onClick={() => void handleSave()}
            >
            保存并生成
          </Button>
        </Space>
        </div>
      }
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {!backgroundUrl || !background ? (
          <div
            style={{
              width: DISPLAY_SIZE,
              height: DISPLAY_SIZE,
              margin: "0 auto",
              background: "#fafafa",
              border: "1px solid #eee",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Empty description="缺少背景图片" />
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "flex-start",
              gap: 30,
            }}
          >
          <div
            style={{
              position: "relative",
              width: DISPLAY_SIZE,
              height: DISPLAY_SIZE,
              overflow: "visible",
            }}
          >
          <div
            data-role="canvas"
            style={{
              width: DISPLAY_SIZE,
              height: DISPLAY_SIZE,
              position: "absolute",
              top: 0,
              left: 0,
              overflow: "hidden",
              background: "#ffffff",
              border: "1px solid #eee",
              borderRadius: 8,
              userSelect: "none",
              cursor: "grab",
            }}
            onMouseDown={(e) => {
              const target = e.target as HTMLElement;
              if (
                target.dataset?.role === "canvas" ||
                target.dataset?.role === "background"
              ) {
                dragRef.current = {
                  type: "background",
                  startX: e.clientX,
                  startY: e.clientY,
                  startOffsetX: background.offsetX,
                  startOffsetY: background.offsetY,
                };
              }
            }}
          >
            <img
              src={background.sourceUrl}
              alt="background"
              data-role="background"
              draggable={false}
              style={{
                position: "absolute",
                left: bgLeft,
                top: bgTop,
                width: bgScaledWidth,
                height: bgScaledHeight,
                maxWidth: "none",
                maxHeight: "none",
                pointerEvents: "none",
                userSelect: "none",
              }}
            />

            <div
              data-role="sku-panel"
              onMouseDown={(e) => {
                e.stopPropagation();
                if (
                  (e.target as HTMLElement).dataset?.role === "resize-handle"
                ) {
                  dragRef.current = {
                    type: "panel-resize",
                    startX: e.clientX,
                    startY: e.clientY,
                    startWidth: skuPanel.width,
                    startHeight: skuPanel.height,
                    startPanelX: skuPanel.x,
                    startPanelY: skuPanel.y,
                  };
                  return;
                }
                dragRef.current = {
                  type: "panel",
                  startX: e.clientX,
                  startY: e.clientY,
                  startPanelX: skuPanel.x,
                  startPanelY: skuPanel.y,
                };
              }}
              style={{
                position: "absolute",
                left: panelLeft,
                top: panelTop,
                width: panelWidth,
                height: panelHeight,
                background: "#ffffff",
                border: "1px solid rgba(86, 122, 196, 0.28)",
                borderRadius: 0,
                cursor: "move",
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gridTemplateRows: `repeat(${rows}, 1fr)`,
                gap: 2,
                padding: 2,
                boxSizing: "border-box",
              }}
            >
              {skuImages.map((sku, index) => (
                <div
                  key={index}
                  style={{
                    width: "100%",
                    height: "100%",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <img
                  src={sku.sourceUrl}
                  alt={`sku-${index}`}
                  draggable={false}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    pointerEvents: "none",
                  }}
                />
                </div>
              ))}
              <div
                data-role="resize-handle"
                style={{
                  position: "absolute",
                  right: -6,
                  bottom: -6,
                  width: 16,
                  height: 16,
                  background: "#1677ff",
                  border: "2px solid #fff",
                  borderRadius: 3,
                  cursor: "nwse-resize",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }}
              />
            </div>
          </div>
          </div>
          {background && (
            <div
              style={{
                height: DISPLAY_SIZE,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  height: DISPLAY_SIZE - 40,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <Typography.Text className="crop-slider-label" style={{ fontSize: 12, marginBottom: 8, writingMode: "horizontal-tb" }}>
                  放大
                </Typography.Text>
                <Slider
                  vertical
                  min={minScale}
                  max={maxScale}
                  step={0.01}
                  value={background.scale}
                  onChange={handleScaleChange}
                  style={{ height: DISPLAY_SIZE - 80 }}
                  styles={{
                    rail: {
                      background: "rgba(135, 180, 255, 0.35)",
                    },
                    track: {
                      background: "rgba(64, 128, 255, 0.55)",
                    },
                    handle: {
                      borderColor: "#4080ff",
                    },
                  }}
                />
                <Typography.Text className="crop-scale-text" style={{ fontSize: 12, marginTop: 8 }}>
                  {background.scale.toFixed(2)}×
                </Typography.Text>
              </div>
            </div>
          )}
        </div>
        )}
      </Space>

      <Modal
        className="admin-edit-modal admin-picker-modal"
        closable={false}
        centered
        destroyOnHidden
        open={Boolean(sourcePickerMode)}
        title={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            {sourcePickerMode === "sku"
              ? "选择 SKU 图片"
              : "选择主图图片"}
            {sourcePickerMode === "background" ? (
              <>
                <Button
                  icon={<UploadOutlined />}
                  loading={uploading}
                  onClick={() => uploadInputRef.current?.click()}
                >
                  上传图片
                </Button>
                <input
                  accept="image/*"
                  ref={uploadInputRef}
                  style={{ display: "none" }}
                  type="file"
                  onChange={(event) => void handleUploadBackgroundImage(event)}
                />
              </>
            ) : null}
          </div>
        }
        width={900}
        onCancel={closeSourcePicker}
        footer={
          <Space>
            <Button onClick={closeSourcePicker}>取消</Button>
            <Button
              type="primary"
              disabled={
                sourcePickerMode === "sku"
                  ? sourcePickerSelectedIds.length < 2 ||
                    sourcePickerSelectedIds.length > 10
                  : sourcePickerSelectedIds.length !== 1
              }
              onClick={applySourcePickerSelection}
            >
              确认
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            {sourcePickerMode === "sku"
              ? `已选择 ${sourcePickerSelectedIds.length} 张，支持选择 2-10 张。`
              : "主图仅支持选择一张。"}
          </Typography.Text>
          <div
            style={{
              height: 520,
              overflowY: "auto",
            }}
          >
            {pickerImages.length ? (
              <div
                className="admin-image-picker-grid"
                style={{
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                }}
              >
                {pickerImages.map((rawImage, index) => {
                  // 检查是否是 AI 生成的图片
                  const aiImage = (rawImage as AiGeneratedImageItem);
                  const isAiImage = Boolean(aiImage.displayName);
                  return (
                    <button
                      className={`admin-image-picker-item ${
                        sourcePickerSelectedIds.includes(rawImage.id)
                          ? "admin-image-picker-item-selected"
                          : ""
                      }`}
                      key={`slot1-source-${rawImage.id}-${index}`}
                      type="button"
                      onClick={() => toggleSourceImage(rawImage)}
                    >
                      <AntImage
                        alt={isAiImage ? aiImage.displayName : `图片 ${rawImage.id}`}
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
                        style={{ display: "block", marginTop: 10 }}
                      >
                        {isAiImage ? aiImage.displayName : (rawImage as ImageCenterRawImage).isCover ? "当前抓取封面图" : "抓取图片"}
                      </Typography.Text>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Empty description="暂无可选图片" />
            )}
          </div>
        </Space>
      </Modal>
    </Modal>
  );
}
