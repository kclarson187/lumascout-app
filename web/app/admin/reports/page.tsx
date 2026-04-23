import { apiTry } from '@/lib/api';
import { DashboardHeader } from '@/components/dashboard-parts';
import { ReportsClient } from './_client';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp?.status || 'open';
  const data = await apiTry<any>(`/api/admin/reports?status=${encodeURIComponent(status)}&limit=100`, { items: [] }, { revalidate: 0 });
  const items: any[] = Array.isArray(data) ? data : data?.items || [];

  return (
    <>
      <DashboardHeader
        eyebrow="Safety"
        title="Reports queue"
        kicker="User-submitted flags on posts, comments, spots, marketplace items, and other users."
      />
      <div className="px-6 lg:px-10 pb-16">
        <ReportsClient initialItems={items} currentStatus={status} />
      </div>
    </>
  );
}
