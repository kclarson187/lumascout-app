import { redirect } from 'next/navigation';
import { apiFetch, apiTry } from '@/lib/api';
import { SellerSidebar } from '@/components/seller-sidebar';

export const dynamic = 'force-dynamic';

async function getMe() {
  try { return await apiFetch<any>('/api/auth/me'); } catch { return null; }
}

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const user = await getMe();
  if (!user) redirect('/login?next=/seller');

  // Live Stripe Connect status
  const connect = await apiTry<any>('/api/me/seller/connect-status', null, { revalidate: 0 });
  const userWithConnect = { ...user, stripe_connect_status: connect?.status || user.stripe_connect_status };

  // Lightweight badges (e.g., draft/pending count) — defensive if endpoint is missing.
  const productsData = await apiTry<any>(`/api/marketplace/products?seller_user_id=${encodeURIComponent(user.user_id)}&include_unpublished=true&limit=200`, { items: [] }, { revalidate: 0 });
  const productList: any[] = Array.isArray(productsData) ? productsData : productsData?.items || productsData?.products || [];
  const pendingCount = productList.filter((p: any) => ['pending', 'draft'].includes((p.status || '').toLowerCase())).length;
  const activeCount = productList.filter((p: any) => ['active', 'approved', 'published'].includes((p.status || '').toLowerCase())).length;

  const badges: Record<string, number | string> = {};
  if (pendingCount > 0) badges['/seller/products'] = pendingCount;
  if ((connect?.status || 'disconnected') !== 'active') badges['/seller/payouts'] = '●';

  return (
    <div className="flex min-h-screen bg-bg">
      <SellerSidebar user={userWithConnect} badges={badges} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
