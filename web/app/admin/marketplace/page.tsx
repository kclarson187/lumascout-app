import { apiTry } from '@/lib/api';
import { DashboardHeader } from '@/components/dashboard-parts';
import { MarketplaceModerationClient } from './_client';

export const dynamic = 'force-dynamic';

export default async function MarketplaceAdminPage() {
  const [pending, purchases] = await Promise.all([
    apiTry<any>('/api/admin/marketplace/pending?limit=50', { items: [] }, { revalidate: 0 }),
    apiTry<any>('/api/admin/marketplace/purchases?limit=20', { items: [] }, { revalidate: 0 }),
  ]);
  const pendingList: any[] = Array.isArray(pending) ? pending : pending?.items || [];
  const purchaseList: any[] = Array.isArray(purchases) ? purchases : purchases?.items || [];

  return (
    <>
      <DashboardHeader
        eyebrow="Moderation"
        title="Marketplace"
        kicker="Review listings, feature top sellers, and handle refunds."
      />
      <div className="px-6 lg:px-10 pb-16">
        <MarketplaceModerationClient initialPending={pendingList} purchases={purchaseList} />
      </div>
    </>
  );
}
