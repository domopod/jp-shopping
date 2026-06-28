/* eslint-disable @next/next/no-img-element */
import { Boxes, ImageIcon, Link2, PackageSearch } from 'lucide-react';
import type { ProductDetail } from '@/lib/types';

interface ProductDetailViewProps {
  product: ProductDetail;
}

export function ProductDetailView({ product }: ProductDetailViewProps) {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-10 lg:px-10">
      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <section className="surface rounded-[28px] border border-white/10 p-8">
          <p className="text-sm uppercase tracking-[0.3em] text-accentSoft">Product Archive</p>
          <h1 className="mt-4 text-3xl font-semibold text-white lg:text-4xl">{product.title}</h1>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <InfoItem label="品牌" value={product.brand || '未识别'} />
            <InfoItem label="价格" value={product.price || '未识别'} />
            <InfoItem label="抓取时间" value={new Date(product.createdAt).toLocaleString('zh-CN')} />
            <InfoItem label="商品 ID" value={String(product.id)} />
          </div>
          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center gap-2 text-sm text-white/70">
              <Link2 className="h-4 w-4 text-accent" />
              来源链接
            </div>
            <a className="mt-3 block break-all text-sm leading-6 text-accentSoft hover:text-accent" href={product.sourceUrl} rel="noreferrer" target="_blank">
              {product.sourceUrl}
            </a>
          </div>
        </section>

        <section className="surface rounded-[28px] border border-white/10 p-8">
          <div className="flex items-center gap-2 text-accentSoft">
            <Boxes className="h-5 w-5" />
            <span className="text-sm uppercase tracking-[0.3em] text-white/70">Capture Summary</span>
          </div>
          <div className="mt-6 space-y-4">
            <MiniStat label="图片数量" value={`${product.images.length} 张`} />
            <MiniStat label="SKU 数量" value={`${product.skus.length} 个`} />
            <MiniStat label="描述状态" value={product.description ? '已采集' : '空'} />
          </div>
        </section>
      </div>

      <section className="surface rounded-[28px] border border-white/10 p-8">
        <div className="flex items-center gap-2 text-accentSoft">
          <ImageIcon className="h-5 w-5" />
          <span className="text-sm uppercase tracking-[0.3em] text-white/70">Image Gallery</span>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {product.images.map((image) => (
            <div key={image.id} className="overflow-hidden rounded-[22px] border border-white/10 bg-white/5">
              <img alt={product.title} className="h-64 w-full object-cover" src={image.imageUrl} />
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <article className="surface rounded-[28px] border border-white/10 p-8">
          <div className="flex items-center gap-2 text-accentSoft">
            <PackageSearch className="h-5 w-5" />
            <span className="text-sm uppercase tracking-[0.3em] text-white/70">商品説明</span>
          </div>
          <div className="mt-6 whitespace-pre-wrap text-sm leading-7 text-slate-200">
            {product.description || '暂无商品描述'}
          </div>
        </article>

        <article className="surface rounded-[28px] border border-white/10 p-8">
          <p className="text-sm uppercase tracking-[0.3em] text-white/70">SKU Matrix</p>
          <div className="mt-6 overflow-hidden rounded-[20px] border border-white/10">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead className="bg-white/5 text-left text-white/70">
                <tr>
                  <th className="px-4 py-3 font-medium">图片</th>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">颜色</th>
                  <th className="px-4 py-3 font-medium">尺码</th>
                  <th className="px-4 py-3 font-medium">价格</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {product.skus.map((sku) => (
                  <tr key={sku.id} className="bg-white/[0.02] text-slate-200">
                    <td className="px-4 py-3">
                      {sku.imageUrl ? (
                        <img
                          alt={sku.color || sku.skuCode}
                          className="h-14 w-14 rounded-xl border border-white/10 object-cover"
                          src={sku.imageUrl}
                        />
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3">{sku.skuCode}</td>
                    <td className="px-4 py-3">{sku.color || '-'}</td>
                    <td className="px-4 py-3">{sku.size || '-'}</td>
                    <td className="px-4 py-3">{sku.price || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="surface rounded-[28px] border border-white/10 p-8">
          <p className="text-sm uppercase tracking-[0.3em] text-white/70">サイズ</p>
          <div className="mt-6 whitespace-pre-wrap text-sm leading-7 text-slate-200">
            {product.sizeInfo || '暂无尺寸信息'}
          </div>
        </article>

        <article className="surface rounded-[28px] border border-white/10 p-8">
          <p className="text-sm uppercase tracking-[0.3em] text-white/70">仕様</p>
          <div className="mt-6 whitespace-pre-wrap text-sm leading-7 text-slate-200">
            {product.specification || '暂无规格信息'}
          </div>
        </article>
      </section>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-white/60">{label}</p>
      <p className="mt-3 text-lg font-medium text-white">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-white/60">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
