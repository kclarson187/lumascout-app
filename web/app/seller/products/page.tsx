import Link from 'next/link';
import { apiFetch, apiTry } from '@/lib/api';
import { DashboardHeader, EmptyState } from '@/components/dashboard-parts';
import { LinkButton } from '@/components/ui/button';
import { ProductsClient } from './_client';
import { Package } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function SellerProductsPage() {
  const user = await apiFetch<any>('/api/auth/me');
  const data = await apiTry<any>(`/api/marketplace/products?seller_user_id=${encodeURIComponent(user.user_id)}&include_unpublished=true&limit=200`, { items: [] }, { revalidate: 0 });
  const products: any[] = Array.isArray(data) ? data : data?.items || data?.products || [];

  return (
    <>
      <DashboardHeader
        eyebrow="Catalog"
        title="Products"
        kicker="Everything you sell on LumaScout. Draft, pending, and live listings."
        right={<LinkButton href="/seller/products/new">New product</LinkButton>}
      />
      <div className="px-6 lg:px-10 pb-16">
        {products.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No products yet"
            body="Sell presets, location packs, city guides, route packs, and mentorship sessions. Creators keep 85%."
            cta={<LinkButton href="/seller/products/new">Create your first product</LinkButton>}
          />
        ) : (
          <ProductsClient initialProducts={products} />
        )}
      </div>
    </>
  );
}
