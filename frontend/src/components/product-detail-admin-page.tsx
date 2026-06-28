'use client';

import { ArrowLeftOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Space, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminShell } from '@/components/admin-shell';
import { ProductDetailContent } from '@/components/product-detail-content';
import { deleteProduct, fetchProductDetail } from '@/lib/api';
import type { ProductDetail } from '@/lib/types';

interface ProductDetailAdminPageProps {
  id: string;
}

export function ProductDetailAdminPage({ id }: ProductDetailAdminPageProps) {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchProductDetail(id);
      setProduct(result);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '获取商品详情失败');
    } finally {
      setLoading(false);
    }
  }, [id, messageApi]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  return (
    <AdminShell
      title="商品详情"
      extra={
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/products')}>
            返回列表
          </Button>
          {product ? (
            <>
              <Button icon={<EditOutlined />} type="primary" onClick={() => router.push(`/products/${product.id}/edit`)}>
                编辑商品
              </Button>
              <Popconfirm
                cancelText="取消"
                okText="删除"
                title="确认删除该商品？"
                onConfirm={async () => {
                  if (!product) return;
                  try {
                    await deleteProduct(product.id);
                    messageApi.success('商品已删除');
                    router.push('/products');
                  } catch (error) {
                    messageApi.error(error instanceof Error ? error.message : '删除失败');
                  }
                }}
              >
                <Button danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            </>
          ) : null}
        </Space>
      }
    >
      {contextHolder}
      <ProductDetailContent loading={loading} product={product} />
    </AdminShell>
  );
}
