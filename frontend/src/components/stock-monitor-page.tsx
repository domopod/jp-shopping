'use client';

import { DeleteOutlined, DownloadOutlined, PlusOutlined, PushpinOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { Button, Input, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '@/components/admin-shell';
import {
  addStockMonitorProduct,
  deleteStockMonitorProduct,
  fetchStockMonitorProducts,
  refreshAllStockMonitorProducts,
  togglePinStockMonitorProduct,
} from '@/lib/api';
import type { StockMonitorProduct, StockMonitorSku } from '@/lib/types';
import { normalizeImageUrl } from '@/lib/image';

const LAST_REFRESH_KEY = 'stock-monitor-last-refresh';

function groupSkusByColor(skus: StockMonitorSku[]) {
  const groups: Record<string, StockMonitorSku[]> = {};
  for (const sku of skus) {
    const colorKey = sku.colorCode || sku.color || 'unknown';
    if (!groups[colorKey]) {
      groups[colorKey] = [];
    }
    groups[colorKey].push(sku);
  }
  return groups;
}

function formatStockDateMmDd(stockDate: string | null): string | null {
  if (!stockDate || stockDate.length !== 6) return null;
  const month = stockDate.slice(2, 4);
  const day = stockDate.slice(4, 6);
  return `${month}/${day}`;
}

function buildSizeSuffix(sku: StockMonitorSku): string {
  const code = sku.stockStatusCode;
  const isInStock = sku.stockStatus === 'IN_STOCK' || code === 8 || code === 7 || code === 1;
  if (isInStock) {
    const x = (sku.stockQuantity || 0) + (sku.storeStockQuantity || 0);
    const dateStr = formatStockDateMmDd(sku.stockDate);
    const y = sku.arrivalQuantity || 0;
    if (dateStr && y > 0) {
      return `(现货${x} · ${dateStr}到货${y})`;
    }
    if (y > 0) {
      return `(现货${x} · 到货${y})`;
    }
    return `(现货${x})`;
  }
  if (code === 5 || code === 6 || sku.stockStatus === 'BACKORDER') {
    const dateStr = formatStockDateMmDd(sku.stockDate);
    const y = sku.arrivalQuantity || 0;
    if (dateStr && y > 0) {
      return `(${dateStr}到货${y})`;
    }
    if (y > 0) {
      return `(到货${y})`;
    }
    return '';
  }
  return '';
}

function ProductStockCard({
  product,
  onDelete,
  onPin,
}: {
  product: StockMonitorProduct;
  onDelete: (id: number) => Promise<void>;
  onPin: (id: number) => Promise<void>;
}) {
  const colorGroups = groupSkusByColor(product.skus);
  const colors = Object.keys(colorGroups);
  const [imgError, setImgError] = useState(false);

  return (
    <div className={`stock-product-card ${product.isPinned ? 'is-pinned' : ''}`}>
      <div className="stock-card-main">
        <div className="stock-card-image">
          {product.imageUrl && !imgError ? (
            <img src={normalizeImageUrl(product.imageUrl)} alt={product.title} onError={() => setImgError(true)} />
          ) : (
            <div className="stock-card-img-placeholder">无图</div>
          )}
        </div>
        <div className="stock-card-info">
          <div className="stock-card-title" title={product.title}>
            {product.title}
          </div>
          {product.price && (
            <div className="stock-card-price">{product.price}</div>
          )}
          <div className="stock-card-actions">
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => void onDelete(product.id)}
              className="stock-card-delete-btn"
            />
            <Button
              type="text"
              size="small"
              icon={<PushpinOutlined />}
              onClick={() => void onPin(product.id)}
              className={`stock-card-pin-btn ${product.isPinned ? 'pinned' : ''}`}
            />
            <Button
              type="primary"
              size="small"
              className="stock-buy-btn"
              onClick={() => window.open(product.sourceUrl, '_blank')}
            >
              购买
            </Button>
          </div>
        </div>
      </div>
      <div className="stock-card-specs">
        {colors.map((colorKey) => {
          const skus = colorGroups[colorKey];
          const firstSku = skus[0];
          return (
            <div key={colorKey} className="stock-color-group">
              <div className="stock-color-name">{firstSku.color || colorKey}</div>
              <div className="stock-size-list">
                {skus.map((sku) => {
                  const statusClass =
                    sku.stockStatus === 'IN_STOCK'
                      ? 'spec-status-in-stock'
                      : sku.stockStatus === 'OUT_OF_STOCK'
                        ? 'spec-status-out-of-stock'
                        : 'spec-status-backorder';
                  const suffix = buildSizeSuffix(sku);
                  return (
                    <div key={sku.id} className={`stock-size-tag ${statusClass}`}>
                      <span className="stock-size-text">{sku.size}</span>
                      {suffix && <span className="stock-size-suffix">{suffix}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StockMonitorPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [items, setItems] = useState<StockMonitorProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchStockMonitorProducts();
      setItems(result.items);
    } catch (error) {
      messageApi.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_REFRESH_KEY) : null;
    if (saved) {
      setLastRefreshTime(saved);
    }
    loadProducts();
  }, [loadProducts]);

  const handleAdd = async () => {
    const url = urlInput.trim();
    if (!url) {
      messageApi.warning('请输入商品链接');
      return;
    }
    setAdding(true);
    try {
      await addStockMonitorProduct(url);
      messageApi.success('添加成功');
      setUrlInput('');
      await loadProducts();
    } catch (error) {
      messageApi.error((error as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const handlePin = async (id: number) => {
    try {
      const updated = await togglePinStockMonitorProduct(id);
      setItems((prev) => {
        const newItems = prev
          .map((p) => (p.id === id ? updated : p))
          .sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          });
        return newItems;
      });
    } catch (error) {
      messageApi.error((error as Error).message);
    }
  };

  const handleRefreshAll = async () => {
    if (items.length === 0) {
      messageApi.warning('暂无监控商品');
      return;
    }
    setRefreshingAll(true);
    try {
      const result = await refreshAllStockMonitorProducts();
      setItems(result.items);
      const timeStr = new Date().toLocaleString('zh-CN');
      setLastRefreshTime(timeStr);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LAST_REFRESH_KEY, timeStr);
      }
      if (result.failedCount > 0) {
        messageApi.warning(
          `刷新完成：成功 ${result.refreshedCount} 个，失败 ${result.failedCount} 个`,
        );
      } else {
        messageApi.success(`刷新完成，共更新 ${result.refreshedCount} 个商品`);
      }
    } catch (error) {
      messageApi.error((error as Error).message);
    } finally {
      setRefreshingAll(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('确认删除该商品？删除后无法恢复。')) {
      return;
    }
    try {
      await deleteStockMonitorProduct(id);
      messageApi.success('删除成功');
      await loadProducts();
    } catch (error) {
      messageApi.error((error as Error).message);
    }
  };

  const handleExportUrls = () => {
    if (items.length === 0) {
      messageApi.warning('暂无监控商品');
      return;
    }
    const csvContent = ['URL'].concat(items.map((p) => p.sourceUrl)).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `stock-monitor-urls-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    messageApi.success(`已导出 ${items.length} 个商品 URL`);
  };

  const handleImportUrls = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const urls = text.split('\n').map((line) => line.trim()).filter((line) => line && line.startsWith('http'));
        if (urls.length === 0) {
          messageApi.warning('未找到有效的商品链接');
          return;
        }
        let successCount = 0;
        let failCount = 0;
        for (const url of urls) {
          try {
            await addStockMonitorProduct(url);
            successCount++;
          } catch {
            failCount++;
          }
        }
        await loadProducts();
        if (failCount === 0) {
          messageApi.success(`导入成功，共添加 ${successCount} 个商品`);
        } else {
          messageApi.warning(`导入完成：成功 ${successCount} 个，失败 ${failCount} 个`);
        }
      } catch {
        messageApi.error('导入失败，请检查文件格式');
      }
    };
    input.click();
  };

  return (
    <AdminShell title="库存看板">
      {contextHolder}
      <div className="stock-monitor-page">
        <div className="stock-monitor-header">
          <div className="stock-add-section">
            <span className="stock-add-label">添加商品</span>
            <Input
              className="stock-url-input"
              placeholder="粘贴 MontBell 商品链接"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onPressEnter={handleAdd}
              disabled={adding}
              suffix={
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleAdd}
                  loading={adding}
                  className="stock-add-btn"
                >
                  添加
                </Button>
              }
            />
            <Button
              icon={<UploadOutlined />}
              onClick={handleImportUrls}
              className="stock-import-btn"
              type="primary"
            >
              导入
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleExportUrls}
              className="stock-export-btn"
              type="primary"
            >
              导出
            </Button>
          </div>
          <div className="stock-refresh-section">
            {lastRefreshTime && (
              <span className="stock-last-refresh">最近刷新：{lastRefreshTime}</span>
            )}
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRefreshAll}
              loading={refreshingAll}
              className="stock-refresh-btn"
              type="primary"
            >
              {refreshingAll ? '刷新中' : '刷新库存'}
            </Button>
          </div>
        </div>

        <div className="stock-monitor-list">
          {loading ? (
            <div className="stock-empty">加载中...</div>
          ) : items.length === 0 ? (
            <div className="stock-empty">暂无监控商品，请添加商品链接</div>
          ) : (
            items.map((product) => (
              <ProductStockCard
                key={product.id}
                product={product}
                onDelete={handleDelete}
                onPin={handlePin}
              />
            ))
          )}
        </div>
      </div>
    </AdminShell>
  );
}
