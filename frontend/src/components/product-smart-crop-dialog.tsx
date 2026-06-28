"use client";

import {
  Button,
  Empty,
  Image,
  Modal,
  Progress,
  Row,
  Col,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { smartCropImages } from "@/lib/api";

interface ProductSmartCropDialogProps {
  open: boolean;
  onClose: () => void;
  productId: number;
  category: "square_main" | "portrait_main" | "long_main";
  selectedImages: Array<{
    id: number;
    imageUrl: string;
    sourceImageUrl?: string;
    width?: number | null;
    height?: number | null;
    targetSlot?: number | null;
  }>;
  onSuccess: (results: any) => void;
}

const TARGET_SIZE_MAP: Record<
  "square_main" | "portrait_main" | "long_main",
  { width: number; height: number; label: string }
> = {
  square_main: { width: 1440, height: 1440, label: "1440 × 1440" },
  portrait_main: { width: 1440, height: 1920, label: "1440 × 1920" },
  long_main: { width: 1440, height: 2160, label: "1440 × 2160" },
};

export function ProductSmartCropDialog({
  open,
  onClose,
  productId,
  category,
  selectedImages,
  onSuccess,
}: ProductSmartCropDialogProps) {
  const [messageApi, messageContextHolder] = message.useMessage();
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<{
    success: number;
    failed: number;
    total: number;
  } | null>(null);

  const targetSize = TARGET_SIZE_MAP[category];

  useEffect(() => {
    if (!open) {
      setProcessing(false);
      setProgress(0);
      setSummary(null);
    }
  }, [open]);

  const handleStartCrop = useCallback(async () => {
    if (!selectedImages.length) {
      messageApi.warning("请至少选择一张图片");
      return;
    }

    setProcessing(true);
    setProgress(0);
    setSummary(null);

    try {
      const total = selectedImages.length;
      let successCount = 0;
      let failedCount = 0;

      for (let i = 0; i < total; i++) {
        try {
          const imageItem = selectedImages[i];
          await smartCropImages(productId, {
            category,
            images: [
              {
                id: imageItem.id,
                imageUrl: imageItem.imageUrl,
                sourceImageUrl: imageItem.sourceImageUrl,
                targetSlot: imageItem.targetSlot,
              },
            ],
          });
          successCount++;
        } catch (innerError) {
          failedCount++;
        } finally {
          setProgress(Math.round(((i + 1) / total) * 100));
        }
      }

      setSummary({ success: successCount, failed: failedCount, total });

      if (failedCount === 0) {
        messageApi.success(`裁切完成：${successCount} 张图片`);
      } else {
        messageApi.warning(
          `裁切完成：成功 ${successCount} 张，失败 ${failedCount} 张`,
        );
      }

      onSuccess({ success: successCount, failed: failedCount, total });
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "裁切任务启动失败",
      );
    } finally {
      setProcessing(false);
    }
  }, [category, messageApi, onSuccess, productId, selectedImages]);

  return (
    <Modal
      className="admin-edit-modal admin-smart-crop-modal"
      closable={false}
      footer={
        <Space>
          <Button
            className="admin-modal-cancel-button"
            disabled={processing}
            onClick={onClose}
          >
            {summary ? "关闭" : "取消"}
          </Button>
          {!summary ? (
            <Button
              loading={processing}
              type="primary"
              onClick={() => void handleStartCrop()}
            >
              开始裁切
            </Button>
          ) : null}
        </Space>
      }
      open={open}
      title={
        <Space size={8}>
          <Typography.Title
            className="admin-picker-modal-title"
            level={4}
            style={{ margin: 0 }}
          >
            智能裁切图片
          </Typography.Title>
          <Tag color="blue">目标尺寸 {targetSize.label}</Tag>
        </Space>
      }
      width={960}
      onCancel={() => {
        if (!processing) {
          onClose();
        }
      }}
    >
      {messageContextHolder}
      <div className="admin-smart-crop-body">
        {processing || summary ? (
          <div className="admin-smart-crop-progress">
            <Typography.Text strong>
              {summary
                ? `裁切完成`
                : `正在裁切 (${Math.round(
                    (progress / 100) * (selectedImages?.length || 0),
                  )} / ${selectedImages?.length || 0})`}
            </Typography.Text>
            <Progress percent={progress} status={summary ? "success" : undefined} />
            {summary ? (
              <Row gutter={16} style={{ marginTop: 12 }}>
                <Col span={12}>
                  <Tag color="green">{`成功 ${summary.success} 张`}</Tag>
                </Col>
                <Col span={12}>
                  <Tag color={summary.failed > 0 ? "red" : "default"}>
                    {`失败 ${summary.failed} 张`}
                  </Tag>
                </Col>
              </Row>
            ) : null}
          </div>
        ) : null}

        <div className="admin-smart-crop-images">
          {selectedImages?.length ? (
            <div className="admin-image-picker-grid">
              {selectedImages.map((item) => (
                <div className="admin-image-picker-item" key={`crop-${item.id}`}>
                  <Image
                    alt={`裁切目标 ${item.id}`}
                    height={148}
                    preview={false}
                    src={item.imageUrl}
                    style={{
                      width: "100%",
                      objectFit: "cover",
                      borderRadius: 12,
                    }}
                    width={148}
                  />
                  <Space orientation="vertical" size={4} style={{ marginTop: 10 }}>
                    <Typography.Text strong>
                      {item.targetSlot !== undefined && item.targetSlot !== null
                        ? `位置 ${item.targetSlot + 1}`
                        : `图片 ${item.id}`}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {item.width && item.height
                        ? `${item.width} × ${item.height}`
                        : "原始尺寸未记录"}
                    </Typography.Text>
                  </Space>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="暂无可裁切图片" />
          )}
        </div>
      </div>
    </Modal>
  );
}
