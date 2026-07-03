'use client';

import { Card, Col, Descriptions, Empty, Image, Row, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ProcessStatus, ProductDetail, ProductSku } from '@/lib/types';
import { normalizeImageUrl } from '@/lib/image';

const STATUS_COLORS = {
  草稿: 'default',
  已发布: 'processing',
  失败: 'error',
} as const;

const PROCESS_COLORS: Record<ProcessStatus, string> = {
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'error',
};

const PROCESS_LABELS: Record<ProcessStatus, string> = {
  PROCESSING: '处理中',
  SUCCESS: '已完成',
  FAILED: '处理失败',
};

interface ProductDetailContentProps {
  product: ProductDetail | null;
  loading?: boolean;
}

export function ProductDetailContent({ product, loading = false }: ProductDetailContentProps) {
  const skuColumns: ColumnsType<ProductSku> = [
    {
      title: '图片',
      dataIndex: 'imageUrl',
      width: 90,
      render: (value: string | null, record) =>
        value ? (
          <Image
            alt={record.color || record.skuCode}
            height={52}
            preview={{ mask: '预览' }}
            src={normalizeImageUrl(value)}
            style={{ borderRadius: 10, objectFit: 'cover' }}
            width={52}
          />
        ) : (
          '-'
        ),
    },
    {
      title: 'SKU',
      dataIndex: 'skuCode',
    },
    {
      title: '颜色',
      dataIndex: 'color',
      render: (value: string | null) => value || '-',
    },
    {
      title: '尺码',
      dataIndex: 'size',
      render: (value: string | null) => value || '-',
    },
    {
      title: '价格',
      dataIndex: 'price',
      render: (value: string | null) => value || '-',
    },
  ];

  if (!loading && !product) {
    return (
      <Card>
        <Empty description="未找到商品信息" />
      </Card>
    );
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card loading={loading} bordered={false}>
        <Descriptions title={product?.title || '商品详情'} bordered column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="品牌">{product?.brand || '-'}</Descriptions.Item>
          <Descriptions.Item label="价格">{product?.price || '-'}</Descriptions.Item>
          <Descriptions.Item label="状态">
            {product ? <Tag color={STATUS_COLORS[product.status]}>{product.status}</Tag> : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {product ? new Date(product.createdAt).toLocaleString('zh-CN') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {product ? new Date(product.updatedAt).toLocaleString('zh-CN') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="SKU 数量">{product?.skus.length ?? 0}</Descriptions.Item>
          <Descriptions.Item label="AI 处理">
            {product?.aiProcessStatus ? <Tag color={PROCESS_COLORS[product.aiProcessStatus]}>{PROCESS_LABELS[product.aiProcessStatus]}</Tag> : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="图片处理">
            {product?.imageProcessStatus ? (
              <Tag color={PROCESS_COLORS[product.imageProcessStatus]}>{PROCESS_LABELS[product.imageProcessStatus]}</Tag>
            ) : (
              '-'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="图片完成时间">
            {product?.imageProcessedAt ? new Date(product.imageProcessedAt).toLocaleString('zh-CN') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="来源链接" span={3}>
            {product?.sourceUrl ? (
              <Typography.Link href={product.sourceUrl} target="_blank">
                {product.sourceUrl}
              </Typography.Link>
            ) : (
              '-'
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card bordered={false} title="商品图片">
            {product?.images?.length ? (
              <Image.PreviewGroup>
                <Space size={[12, 12]} wrap>
                  {product.images.map((image) => (
                    <Space key={image.id} orientation="vertical" size={8}>
                      <Image
                        alt={product.title}
                        height={100}
                        src={normalizeImageUrl(image.imageUrl)}
                        style={{ borderRadius: 12, objectFit: 'cover' }}
                        width={100}
                      />
                      {image.processStatus ? (
                        <Tag color={PROCESS_COLORS[image.processStatus]} style={{ marginInlineEnd: 0, textAlign: 'center' }}>
                          {PROCESS_LABELS[image.processStatus]}
                        </Tag>
                      ) : null}
                    </Space>
                  ))}
                </Space>
              </Image.PreviewGroup>
            ) : (
              <Empty description="暂无图片" />
            )}
          </Card>
        </Col>
        <Col span={24}>
          <Card bordered={false} title="SKU 列表">
            <Table columns={skuColumns} dataSource={product?.skus || []} pagination={false} rowKey="id" scroll={{ x: 760 }} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card bordered={false} title="商品说明">
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
              {product?.description || '暂无商品说明'}
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card bordered={false} title="尺寸信息">
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
              {product?.sizeInfo || '暂无尺寸信息'}
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card bordered={false} title="规格信息">
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
              {product?.specification || '暂无规格信息'}
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
