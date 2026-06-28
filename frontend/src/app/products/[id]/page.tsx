import { ProductDetailAdminPage } from '@/components/product-detail-admin-page';

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <ProductDetailAdminPage id={id} />;
}
