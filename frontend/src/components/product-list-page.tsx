'use client';

import { CloseCircleFilled, DeleteOutlined, EditOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Checkbox, Image, Input, Modal, Pagination, Space, message } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProductDetailContent } from '@/components/product-detail-content';
import { deleteProduct, deleteProducts, fetchProductDetail, fetchProducts, retryImageProcessing } from '@/lib/api';
import type { ProductDetail, ProductImageListStatus, ProductListItem } from '@/lib/types';
import { AdminShell } from '@/components/admin-shell';

interface ProductListPageProps {
  highlightedId?: number;
}

interface PersistedProductListState {
  keywordInput: string;
  keyword: string;
  imageStatus?: ProductImageListStatus;
  page: number;
  pageSize: number;
  scrollY: number;
  focusId?: number;
}

const PRODUCT_LIST_STATE_KEY = 'jp-shopping-product-list-state';
const PRODUCT_LIST_RETURN_KEY = 'jp-shopping-product-list-return';
const IMAGE_STATUS_META: Record<ProductImageListStatus, { label: string; className: string }> = {
  PROCESSING: { label: '处理中', className: 'admin-process-processing' },
  SUCCESS: { label: '处理完成', className: 'admin-process-success' },
};

const IMAGE_STATUS_TABS: Array<{ key: 'all' | ProductImageListStatus; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'PROCESSING', label: '处理中' },
  { key: 'SUCCESS', label: '处理完成' },
];

function getListImageStatus(record: ProductListItem): ProductImageListStatus {
  return record.imageCenterStatus === 'SUCCESS' ? 'SUCCESS' : 'PROCESSING';
}

const RETRYABLE_IMAGE_STATUSES = new Set(['IDLE', 'QUEUED', 'PROCESSING', 'FAILED']);

const IMAGE_STATUS_COUNTS_INITIAL: Record<'all' | ProductImageListStatus, number> = {
  all: 0,
  PROCESSING: 0,
  SUCCESS: 0,
};
export function ProductListPage({ highlightedId = 0 }: ProductListPageProps) {
  const router = useRouter();
  const [messageApi, contextHolder] = message.useMessage();
  const [stateReady, setStateReady] = useState(false);
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [imageStatus, setImageStatus] = useState<ProductImageListStatus | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<'all' | ProductImageListStatus, number>>(IMAGE_STATUS_COUNTS_INITIAL);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailProduct, setDetailProduct] = useState<ProductDetail | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const restoreScrollRef = useRef<number | null>(null);
  const restoreFocusIdRef = useRef<number | null>(null);
  const previousKeywordRef = useRef('');

  const persistListState = useCallback(
    (overrides: Partial<PersistedProductListState> = {}) => {
      if (typeof window === 'undefined') {
        return;
      }

      const nextState: PersistedProductListState = {
        keywordInput,
        keyword,
        imageStatus,
        page,
        pageSize,
        scrollY: window.scrollY,
        ...overrides,
      };

      window.sessionStorage.setItem(PRODUCT_LIST_STATE_KEY, JSON.stringify(nextState));
    },
    [imageStatus, keyword, keywordInput, page, pageSize],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      setStateReady(true);
      return;
    }

    const shouldRestore = window.sessionStorage.getItem(PRODUCT_LIST_RETURN_KEY) === '1';
    window.sessionStorage.removeItem(PRODUCT_LIST_RETURN_KEY);

    if (!shouldRestore) {
      setStateReady(true);
      return;
    }

    const rawState = window.sessionStorage.getItem(PRODUCT_LIST_STATE_KEY);
    if (rawState) {
      try {
        const parsedState = JSON.parse(rawState) as Partial<PersistedProductListState>;
        setKeywordInput(parsedState.keywordInput || '');
        setKeyword(parsedState.keyword || '');
        setImageStatus(parsedState.imageStatus || undefined);
        setPage(parsedState.page && parsedState.page > 0 ? parsedState.page : 1);
        setPageSize(parsedState.pageSize && parsedState.pageSize > 0 ? parsedState.pageSize : 10);
        restoreScrollRef.current = typeof parsedState.scrollY === 'number' ? parsedState.scrollY : 0;
        restoreFocusIdRef.current = typeof parsedState.focusId === 'number' ? parsedState.focusId : null;
      } catch {
        window.sessionStorage.removeItem(PRODUCT_LIST_STATE_KEY);
      }
    }

    setStateReady(true);
  }, []);

  const loadStatusCounts = useCallback(async () => {
    try {
      const [allResult, processingResult, successResult] = await Promise.all([
        fetchProducts({
          page: 1,
          pageSize: 1,
          keyword: keyword || undefined,
        }),
        fetchProducts({
          page: 1,
          pageSize: 1,
          keyword: keyword || undefined,
          imageStatus: 'PROCESSING',
        }),
        fetchProducts({
          page: 1,
          pageSize: 1,
          keyword: keyword || undefined,
          imageStatus: 'SUCCESS',
        }),
      ]);

      setStatusCounts({
        all: allResult.pagination.total,
        PROCESSING: processingResult.pagination.total,
        SUCCESS: successResult.pagination.total,
      });
    } catch {
      // Ignore count refresh failures to keep the list usable.
    }
  }, [keyword]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchProducts({
        page,
        pageSize,
        keyword: keyword || undefined,
        imageStatus,
      });

      setItems(result.items);
      setTotal(result.pagination.total);
      setSelectedIds([]);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '获取商品列表失败');
    } finally {
      setLoading(false);
    }
  }, [imageStatus, keyword, messageApi, page, pageSize]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([loadProducts(), loadStatusCounts()]);
      messageApi.success('已刷新完成');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '刷新失败');
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, loadProducts, loadStatusCounts, messageApi]);

  useEffect(() => {
    if (!stateReady) {
      return;
    }

    void loadProducts();
  }, [loadProducts, stateReady]);

  useEffect(() => {
    if (!stateReady) {
      return;
    }

    void loadStatusCounts();
  }, [loadStatusCounts, stateReady]);

  useEffect(() => {
    if (!stateReady) {
      return;
    }

    persistListState();
  }, [persistListState, stateReady]);

  useEffect(() => {
    if (!stateReady || loading || restoreScrollRef.current === null || typeof window === 'undefined') {
      return;
    }

    const scrollY = restoreScrollRef.current;
    restoreScrollRef.current = null;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: 'auto' });
    });
  }, [items, loading, stateReady]);

  useEffect(() => {
    if (!stateReady || loading || typeof window === 'undefined') {
      return;
    }

    const focusId = restoreFocusIdRef.current;
    if (!focusId) {
      return;
    }

    const row = document.querySelector<HTMLElement>(`[data-product-row-id="${focusId}"]`);
    if (!row) {
      return;
    }

    restoreFocusIdRef.current = null;
    window.requestAnimationFrame(() => {
      row.scrollIntoView({ block: 'center', behavior: 'auto' });
    });
  }, [items, loading, stateReady]);

  const activeStatusLabel = useMemo(
    () => (imageStatus ? IMAGE_STATUS_META[imageStatus].label : '全部'),
    [imageStatus],
  );
  const hasSelection = selectedIds.length > 0;

  function toggleSelected(id: number, checked: boolean) {
    setSelectedIds((current) => (checked ? [...current, id] : current.filter((item) => item !== id)));
  }

  function extractSourceHost(sourceUrl: string) {
    try {
      return new URL(sourceUrl).host.replace(/^www\./, '');
    } catch {
      return sourceUrl;
    }
  }

  function applyKeywordSearch(nextValue: string) {
    const trimmedKeyword = nextValue.trim();

    if (trimmedKeyword === keyword) {
      setKeywordInput(trimmedKeyword);
      return;
    }

    previousKeywordRef.current = keyword;
    setKeywordInput(trimmedKeyword);
    setPage(1);
    setKeyword(trimmedKeyword);
  }

  function handleSearchClear() {
    if (!keyword) {
      setKeywordInput('');
      return;
    }

    const restoreKeyword = previousKeywordRef.current || '';
    setKeywordInput(restoreKeyword);
    setPage(1);
    setKeyword(restoreKeyword);
  }

  async function refreshListAfterDelete(deletedCount = 1) {
    setSelectedIds([]);

    if (items.length - deletedCount <= 0 && page > 1) {
      setPage((current) => current - 1);
    } else {
      await loadProducts();
    }

    await loadStatusCounts();
  }

  async function handleDelete(record: ProductListItem) {
    if (!window.confirm('确认删除该商品？删除后无法恢复。')) {
      return;
    }
    try {
      await deleteProduct(record.id);
      messageApi.success('商品已删除');
      await refreshListAfterDelete();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '删除失败');
    }
  }

  async function handleBatchDelete() {
    if (!hasSelection) {
      return;
    }
    if (!window.confirm(`确认删除已选中的 ${selectedIds.length} 个商品？删除后无法恢复。`)) {
      return;
    }

    const ids = [...selectedIds];

    try {
      const result = await deleteProducts(ids);
      messageApi.success(`已删除 ${result.deletedCount} 个商品`);
      await refreshListAfterDelete(ids.length);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '批量删除失败');
    }
  }

  async function openDetail(id: number) {
    setDetailOpen(true);
    setDetailLoading(true);

    try {
      const result = await fetchProductDetail(String(id));
      setDetailProduct(result);
    } catch (error) {
      setDetailOpen(false);
      messageApi.error(error instanceof Error ? error.message : '获取商品详情失败');
    } finally {
      setDetailLoading(false);
    }
  }

  function navigateToEdit(id: number) {
    persistListState({ focusId: id });
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(PRODUCT_LIST_RETURN_KEY, '1');
    }
    router.push(`/products/${id}/edit`, { scroll: false });
  }

  async function handleDetailDelete() {
    if (!detailProduct) {
      return;
    }
    if (!window.confirm('确认删除该商品？删除后无法恢复。')) {
      return;
    }
    try {
      await deleteProduct(detailProduct.id);
      messageApi.success('商品已删除');
      setDetailOpen(false);
      setDetailProduct(null);
      await refreshListAfterDelete();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '删除失败');
    }
  }

  async function handleRetryImages(record: ProductListItem) {
    try {
      await retryImageProcessing(record.id);
      messageApi.success('已重新加入图片处理队列');
      await loadProducts();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '图片重试失败');
    }
  }

  return (
    <AdminShell
      title="商品管理"
      extra={
        <button className="admin-refresh-button" onClick={() => void handleRefresh()} disabled={isRefreshing}>
          <ReloadOutlined className={`admin-refresh-icon ${isRefreshing ? 'admin-refresh-icon-spinning' : ''}`} />
          刷新
        </button>
      }
    >
      {contextHolder}
      <div className="admin-products-page">
        <div className="admin-products-toolbar">
          <div className="admin-toolbar-main">
            <div className="admin-status-tabs">
              {IMAGE_STATUS_TABS.map((tab) => (
                <button
                  key={tab.key}
                  className={`admin-status-tab${
                    (tab.key === 'all' ? !imageStatus : imageStatus === tab.key) ? ' admin-status-tab-active' : ''
                  }`}
                  onClick={() => {
                    setPage(1);
                    setImageStatus(tab.key === 'all' ? undefined : tab.key);
                  }}
                  type="button"
                >
                  {tab.label}
                  <span>{statusCounts[tab.key]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="admin-filter-row">
            {hasSelection ? (
              <button
                className="admin-action-chip admin-action-chip-danger admin-batch-delete-button"
                type="button"
                onClick={() => void handleBatchDelete()}
              >
                <DeleteOutlined />
                批量删除({selectedIds.length})
              </button>
            ) : null}
            <Input
              allowClear={{ clearIcon: <CloseCircleFilled className="admin-search-clear-icon" /> }}
              className="admin-search-input"
              onClear={handleSearchClear}
              onChange={(event) => setKeywordInput(event.target.value)}
              onPressEnter={() => applyKeywordSearch(keywordInput)}
              placeholder="搜索标题、品牌、来源链接"
              prefix={<SearchOutlined />}
              suffix={
                <Button className="admin-search-submit" type="primary" onClick={() => applyKeywordSearch(keywordInput)}>
                  搜索
                </Button>
              }
              value={keywordInput}
            />
          </div>
        </div>

        <div className="admin-list-head">
          <div className="admin-list-head-check">
            <Checkbox
              checked={items.length > 0 && selectedIds.length === items.length}
              indeterminate={selectedIds.length > 0 && selectedIds.length < items.length}
              onChange={(event) =>
                setSelectedIds(event.target.checked ? items.map((item) => item.id) : [])
              }
            />
          </div>
          <div>商品信息</div>
          <div>价格</div>
          <div>更新时间</div>
          <div>状态</div>
          <div>操作</div>
        </div>

        <div className="admin-list-body">
          {items.map((record) => {
            const selected = selectedIds.includes(record.id);
            const highlighted = highlightedId === record.id;

            return (
              <div
                key={record.id}
                data-product-row-id={record.id}
                className={`admin-product-row${selected ? ' admin-product-row-selected' : ''}${
                  highlighted ? ' admin-product-row-highlight' : ''
                }`}
              >
                <div className="admin-product-check">
                  <Checkbox checked={selected} onChange={(event) => toggleSelected(record.id, event.target.checked)} />
                </div>

                <div className="admin-product-info">
                  {record.imageUrl ? (
                    <Image
                      alt={record.title}
                      className="admin-product-image"
                      height={72}
                      preview={{ mask: '预览' }}
                      src={record.imageUrl}
                      width={72}
                    />
                  ) : (
                    <div className="admin-product-image admin-product-image-empty">NO IMAGE</div>
                  )}
                  <div className="admin-product-copy">
                    <div className="admin-product-brand">品牌: {record.brand || '未识别'}</div>
                    <div className="admin-product-title">{record.title}</div>
                    <div className="admin-product-source">来源: {extractSourceHost(record.sourceUrl)}</div>
                  </div>
                </div>

                <div className="admin-product-metric">{record.price || '-'}</div>
                <div className="admin-product-metric admin-product-time">
                  {new Date(record.updatedAt).toLocaleDateString('zh-CN')}
                </div>
                <div>
                  <span className={`admin-status-pill ${IMAGE_STATUS_META[getListImageStatus(record)].className}`}>
                    {IMAGE_STATUS_META[getListImageStatus(record)].label}
                  </span>
                </div>

                <div className="admin-product-actions">
                  <div className="admin-action-row">
                    <button
                      className="admin-action-chip admin-action-chip-danger"
                      type="button"
                      onClick={() => handleDelete(record)}
                    >
                      <DeleteOutlined />
                      删除
                    </button>

                    <button
                      className="admin-action-chip admin-action-chip-info"
                      onClick={() => navigateToEdit(record.id)}
                      type="button"
                    >
                      <EditOutlined />
                      查看
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {!loading && items.length === 0 ? (
            <div className="admin-empty-state">当前筛选下暂无商品，试试切换状态或重新抓取商品。</div>
          ) : null}
        </div>

        <div className="admin-pagination-bar">
          <div className="admin-pagination-meta">
            当前状态: {activeStatusLabel} · 共 {total} 条
          </div>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger
            onChange={(nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            }}
          />
        </div>
      </div>

      <Modal
        className="admin-fullscreen-modal"
        closeIcon
        destroyOnHidden
        footer={null}
        open={detailOpen}
        title={
          <div className="admin-fullscreen-modal-title">
            <span>{detailProduct?.title || '商品详情'}</span>
            {detailProduct ? (
              <Space wrap>
                <Button icon={<EditOutlined />} type="primary" onClick={() => navigateToEdit(detailProduct.id)}>
                  编辑商品
                </Button>
                <Button danger icon={<DeleteOutlined />} onClick={() => handleDetailDelete()}>
                  删除
                </Button>
              </Space>
            ) : null}
          </div>
        }
        width="100vw"
        onCancel={() => {
          setDetailOpen(false);
          setDetailProduct(null);
        }}
      >
        <ProductDetailContent loading={detailLoading} product={detailProduct} />
      </Modal>
    </AdminShell>
  );
}
