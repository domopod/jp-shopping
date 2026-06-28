'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle, CheckCircle2, XCircle, Clock, ImageIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getImportApiUrl, getImportTasksApiUrl } from '@/lib/api';
import type { ImportTaskDetail, ImportTaskResponse } from '@/lib/types';

const STATUS_CONFIG: Record<
  ImportTaskDetail['status'],
  { label: string; className: string }
> = {
  PENDING: {
    label: '等待中',
    className: 'text-gray-600 bg-gray-100',
  },
  PROCESSING: {
    label: '抓取中',
    className: 'text-blue-700 bg-blue-100',
  },
  SUCCESS: {
    label: '已完成',
    className: 'text-green-700 bg-green-100',
  },
  FAILED: {
    label: '失败',
    className: 'text-red-700 bg-red-100',
  },
};

function formatDateTime(value: string | null) {
  if (!value) return '-';
  try {
    const date = new Date(value);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  } catch {
    return value;
  }
}

function StatusBadge({ status }: { status: ImportTaskDetail['status'] }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
    >
      {status === 'PROCESSING' ? (
        <LoaderCircle className="h-3 w-3 animate-spin" />
      ) : status === 'SUCCESS' ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : status === 'FAILED' ? (
        <XCircle className="h-3 w-3" />
      ) : (
        <Clock className="h-3 w-3" />
      )}
      {config.label}
    </span>
  );
}

export function ImportPanel() {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tasks, setTasks] = useState<ImportTaskDetail[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const intervalMs = 3000;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function refreshTasks() {
      try {
        const response = await fetch(getImportTasksApiUrl(), { cache: 'no-store' });
        if (!response.ok) return;
        const data = (await response.json()) as ImportTaskDetail[];
        if (!cancelled) {
          setTasks(data);
        }
      } catch {
        // ignore errors on silent refresh
      } finally {
        if (!cancelled) setIsLoadingTasks(false);
      }
    }

    refreshTasks();

    const hasInProgress = () =>
      tasks.some((t) => t.status === 'PENDING' || t.status === 'PROCESSING');

    timer = setInterval(() => {
      if (hasInProgress()) {
        refreshTasks();
      }
    }, intervalMs);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [tasks.length]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!url.trim()) {
      setError('请输入商品 URL');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(getImportApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const errorResult = (await response.json()) as { message?: string };
        throw new Error(errorResult.message || '提交失败');
      }

      const result = (await response.json()) as ImportTaskResponse;
      setUrl('');
      setTasks((prev) => {
        const next = [
          {
            id: result.taskId,
            sourceUrl: result.sourceUrl,
            status: result.status,
            productId: result.productId,
            productTitle: null,
            error: result.error,
            createdAt: result.createdAt,
            finishedAt: result.finishedAt,
          },
          ...prev,
        ];
        return next.slice(0, 30);
      });
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '提交失败';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="admin-panel admin-import-panel">
      <form className="space-y-5" onSubmit={handleSubmit}>
        <label className="admin-field-label" htmlFor="product-url">
          商品 URL
        </label>
        <div className="admin-import-row">
          <input
            id="product-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/product/123"
            className="admin-input"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="admin-primary-button"
          >
            {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {isSubmitting ? '提交中...' : '抓取商品'}
          </button>
        </div>
        {error ? <p className="admin-error-text">{error}</p> : null}
      </form>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">抓取记录</h2>
          <p className="text-xs text-gray-300">最多显示最近 30 条</p>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-gray-700 bg-gray-900">
          {isLoadingTasks && tasks.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-gray-300">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              加载抓取记录中...
            </div>
          ) : tasks.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-300">暂无抓取记录</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-700 text-sm">
              <thead className="bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-200">URL</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-200 w-28">状态</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-200 w-44">抓取时间</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-200 w-32">完成时间</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-200 w-24">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 bg-gray-900">
                {tasks.map((task) => {
                  const hasProduct = task.status === 'SUCCESS' && task.productId != null;
                  return (
                    <tr key={task.id} className="hover:bg-gray-800">
                      <td className="max-w-md px-4 py-3 align-top">
                        <div className="truncate text-white" title={task.sourceUrl}>
                          {task.sourceUrl}
                        </div>
                        {task.productTitle ? (
                          <div className="mt-1 truncate text-xs text-gray-300" title={task.productTitle}>
                            {task.productTitle}
                          </div>
                        ) : null}
                        {task.error ? (
                          <div className="mt-1 text-xs text-red-400" title={task.error}>
                            错误：{task.error}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <StatusBadge status={task.status} />
                      </td>
                      <td className="px-4 py-3 align-top text-gray-300">
                        {formatDateTime(task.createdAt)}
                      </td>
                      <td className="px-4 py-3 align-top text-gray-300">
                        {formatDateTime(task.finishedAt)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {hasProduct ? (
                          <button
                            type="button"
                            onClick={() =>
                              router.push(`/products/${task.productId as number}/edit`)
                            }
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300"
                          >
                            <ImageIcon className="h-3.5 w-3.5" />
                            查看
                          </button>
                        ) : (
                          <span className="text-xs text-gray-500">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
