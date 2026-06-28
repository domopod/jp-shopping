import { ProductListPage } from '@/components/product-list-page';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ highlight?: string }>;
}) {
  const params = await searchParams;
  const highlightedId = Number(params.highlight || 0);

  return <ProductListPage highlightedId={Number.isFinite(highlightedId) ? highlightedId : 0} />;
}
