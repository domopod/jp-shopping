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
} from "antd";
import { useEffect, useRef, useState } from "react";
import { manualCropImage } from "@/lib/api";

const TARGET_SIZE_MAP: Record<
  "square_main" | "portrait_main" | "long_main",
  { width: number; height: number; label: string }
> = {
  square_main: { width: 1440, height: 1440, label: "1440 × 1440" },
  portrait_main: { width: 1440, height: 1920, label: "1440 × 1920" },
  long_main: { width: 1440, height: 2160, label: "1440 × 2160" },
};

const MAX_DISPLAY_WIDTH = 400;
const MAX_DISPLAY_HEIGHT = 533;

const DISPLAY_SIZE_MAP: Record<
  "square_main" | "portrait_main" | "long_main",
  { width: number; height: number }
> = {
  square_main: { width: 400, height: 400 },
  portrait_main: { width: 360, height: 480 },
  long_main: { width: 340, height: 510 },
};

interface ImageState {
  sourceUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

interface CropEditorProps {
  open: boolean;
  productId: number;
  category: "square_main" | "portrait_main" | "long_main";
  targetSlot: number | null;
  imageId: number;
  imageUrl: string;
  sourceImageUrl?: string;
  title: string;
  onClose: () => void;
  onSaved: () => void;
}

function computeCoverScale(
  naturalWidth: number,
  naturalHeight: number,
  targetWidth: number,
  targetHeight: number,
): number {
  if (!naturalWidth || !naturalHeight) return 1;
  return Math.max(targetWidth / naturalWidth, targetHeight / naturalHeight);
}

function clampOffset(
  offset: number,
  naturalDim: number,
  scale: number,
  targetDim: number,
): number {
  const scaledDim = naturalDim * scale;
  if (scaledDim <= targetDim) {
    return Math.round((scaledDim - targetDim) / 2);
  }
  return Math.max(0, Math.min(scaledDim - targetDim, Math.round(offset)));
}

export function ProductImageCropEditor({
  open,
  productId,
  category,
  targetSlot,
  imageId,
  imageUrl,
  sourceImageUrl,
  title,
  onClose,
  onSaved,
}: CropEditorProps) {
  const [image, setImage] = useState<ImageState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      document.body.classList.add("admin-modal-open");
    } else {
      document.body.classList.remove("admin-modal-open");
    }
  }, [open]);
  const dragRef = useRef<{
    type: "none" | "image";
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  }>({ type: "none", startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 });

  const targetSize = TARGET_SIZE_MAP[category];
  const displaySize = DISPLAY_SIZE_MAP[category];

  const displayScale = Math.min(
    displaySize.width / targetSize.width,
    displaySize.height / targetSize.height,
  );
  const displayWidth = targetSize.width * displayScale;
  const displayHeight = targetSize.height * displayScale;

  useEffect(() => {
    if (!open) return;
    if (!imageUrl) {
      setImage(null);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;
      const minScale = computeCoverScale(
        naturalWidth,
        naturalHeight,
        targetSize.width,
        targetSize.height,
      );
      const scaledW = naturalWidth * minScale;
      const scaledH = naturalHeight * minScale;

      setImage({
        sourceUrl: imageUrl,
        naturalWidth,
        naturalHeight,
        offsetX: 0,
        offsetY: (scaledH - targetSize.height) / 2,
        scale: minScale,
      });
    };
    img.onerror = () => {
      message.warning("图片加载失败");
    };
    img.src = imageUrl;
  }, [open, imageUrl, targetSize.width, targetSize.height]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (drag.type === "none" || !image) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (drag.type === "image") {
        const dOutX = dx / displayScale;
        const dOutY = dy / displayScale;
        setImage((prev) => {
          if (!prev) return prev;
          const offsetX = clampOffset(
            drag.startOffsetX - dOutX,
            prev.naturalWidth,
            prev.scale,
            targetSize.width,
          );
          const offsetY = clampOffset(
            drag.startOffsetY - dOutY,
            prev.naturalHeight,
            prev.scale,
            targetSize.height,
          );
          return { ...prev, offsetX, offsetY };
        });
      }
    }

    function onUp() {
      dragRef.current = {
        type: "none",
        startX: 0,
        startY: 0,
        startOffsetX: 0,
        startOffsetY: 0,
      };
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [image, displayScale, targetSize.width, targetSize.height]);

  const minScale = image
    ? computeCoverScale(
        image.naturalWidth,
        image.naturalHeight,
        targetSize.width,
        targetSize.height,
      )
    : 1;
  const maxScale = minScale * 3;

  function handleScaleChange(value: number) {
    if (!image) return;
    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;

    const oldScaledW = naturalWidth * image.scale;
    const oldScaledH = naturalHeight * image.scale;
    const newScaledW = naturalWidth * value;
    const newScaledH = naturalHeight * value;

    const overflowW = oldScaledW - targetSize.width;
    const overflowH = oldScaledH - targetSize.height;
    const panX = overflowW > 0 ? image.offsetX / overflowW : 0;
    const panY = overflowH > 0 ? image.offsetY / overflowH : 0.5;

    const newOverflowW = newScaledW - targetSize.width;
    const newOverflowH = newScaledH - targetSize.height;
    let newOffsetX;
    let newOffsetY;

    if (newOverflowW > 0) {
      newOffsetX = Math.max(0, Math.min(newOverflowW, panX * newOverflowW));
    } else {
      newOffsetX = (newScaledW - targetSize.width) / 2;
    }
    if (newOverflowH > 0) {
      newOffsetY = Math.max(0, Math.min(newOverflowH, panY * newOverflowH));
    } else {
      newOffsetY = (newScaledH - targetSize.height) / 2;
    }

    setImage((prev) =>
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
    if (!image) return;
    const minScaleVal = computeCoverScale(
      image.naturalWidth,
      image.naturalHeight,
      targetSize.width,
      targetSize.height,
    );
    const scaledH = image.naturalHeight * minScaleVal;
    setImage((prev) =>
      prev
        ? {
            ...prev,
            scale: minScaleVal,
            offsetX: 0,
            offsetY: (scaledH - targetSize.height) / 2,
          }
        : prev,
    );
  }

  async function handleSave() {
    if (!image) {
      message.error("缺少图片");
      return;
    }

    const scaledWidth = image.naturalWidth * image.scale;
    const scaledHeight = image.naturalHeight * image.scale;

    const effectiveOffsetX =
      scaledWidth > targetSize.width
        ? Math.max(
            0,
            Math.min(scaledWidth - targetSize.width, image.offsetX),
          )
        : (scaledWidth - targetSize.width) / 2;

    const effectiveOffsetY =
      scaledHeight > targetSize.height
        ? Math.max(
            0,
            Math.min(scaledHeight - targetSize.height, image.offsetY),
          )
        : (scaledHeight - targetSize.height) / 2;

    const effectiveScale = Math.max(
      computeCoverScale(
        image.naturalWidth,
        image.naturalHeight,
        targetSize.width,
        targetSize.height,
      ),
      image.scale,
    );

    setSaving(true);
    try {
      await manualCropImage(productId, {
        category,
        images: [
          {
            id: imageId,
            imageUrl: sourceImageUrl || image.sourceUrl,
            sourceImageUrl: sourceImageUrl || image.sourceUrl,
            targetSlot: targetSlot,
            offsetX: effectiveOffsetX,
            offsetY: effectiveOffsetY,
            scale: effectiveScale,
          },
        ],
      });
      message.success("裁切完成");
      onSaved();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "裁切失败，请重试",
      );
    } finally {
      setSaving(false);
    }
  }

  const imgScaledWidth = image
    ? image.naturalWidth * image.scale * displayScale
    : 0;
  const imgScaledHeight = image
    ? image.naturalHeight * image.scale * displayScale
    : 0;
  const imgLeft = image ? -image.offsetX * displayScale : 0;
  const imgTop = image ? -image.offsetY * displayScale : 0;

  return (
    <Modal
      className="admin-edit-modal admin-picker-modal"
      closable={false}
      open={open}
      centered
      title={
        <Space size={8}>
          <Typography.Title
            className="admin-picker-modal-title"
            level={4}
            style={{ margin: 0 }}
          >
            {title}
          </Typography.Title>
          <Tag color="blue">目标尺寸 {targetSize.label}</Tag>
        </Space>
      }
      width={720}
      destroyOnClose
      styles={{
        body: {
          maxHeight: "calc(100vh - 150px)",
          overflowY: "auto",
        },
      }}
      onCancel={() => {
        if (!saving) onClose();
      }}
      footer={
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <Space>
            <Button disabled={saving} onClick={handleReset}>
              重置
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
              确认裁切
            </Button>
          </Space>
        </div>
      }
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        {!image ? (
          <div
            style={{
              width: displayWidth,
              height: displayHeight,
              margin: "0 auto",
              background: "#fafafa",
              border: "1px solid #eee",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Empty description="图片加载中..." />
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
              data-role="canvas"
              style={{
                width: displayWidth,
                height: displayHeight,
                position: "relative",
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
                  target.dataset?.role === "image"
                ) {
                  dragRef.current = {
                    type: "image",
                    startX: e.clientX,
                    startY: e.clientY,
                    startOffsetX: image.offsetX,
                    startOffsetY: image.offsetY,
                  };
                }
              }}
            >
              <img
                src={image.sourceUrl}
                alt="crop"
                data-role="image"
                draggable={false}
                style={{
                  position: "absolute",
                  left: imgLeft,
                  top: imgTop,
                  width: imgScaledWidth,
                  height: imgScaledHeight,
                  maxWidth: "none",
                  maxHeight: "none",
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              />
            </div>

            <div
              style={{
                height: displayHeight,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  height: displayHeight - 40,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <Typography.Text
                  className="crop-slider-label"
                  style={{ fontSize: 12, marginBottom: 8 }}
                >
                  放大
                </Typography.Text>
                <Slider
                  vertical
                  min={minScale}
                  max={maxScale}
                  step={0.01}
                  value={image.scale}
                  onChange={handleScaleChange}
                  style={{ height: displayHeight - 80 }}
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
                  {image.scale.toFixed(2)}×
                </Typography.Text>
              </div>
            </div>
          </div>
        )}

      </Space>
    </Modal>
  );
}
