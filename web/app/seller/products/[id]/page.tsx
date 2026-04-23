import { notFound } from 'next/navigation';
import { apiTry } from '@/lib/api';
import { DashboardHeader } from '@/components/dashboard-parts';
import { ProductForm } from '../_form';

export const dynamic = 'force-dynamic';

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await apiTry<any>(`/api/marketplace/products/${encodeURIComponent(id)}`, null, { revalidate: 0 });
  if (!product || (!product.product_id && !product.id)) return notFound();

  return (
    <>
      <DashboardHeader
        eyebrow={`Status: ${(product.status || 'draft').toUpperCase()}`}
        title={`Edit — ${product.title || ''}`}
        kicker="Make changes and save. Major edits may trigger a re-review."
      />
      <div className="px-6 lg:px-10 pb-16">
        <ProductForm mode="edit" initial={product} />
      </div>
    </>
  );
}
