import { apiTry } from '@/lib/api';
import { DashboardHeader } from '@/components/dashboard-parts';
import { SpotsModerationClient } from './_client';

export const dynamic = 'force-dynamic';

export default async function SpotsModerationPage() {
  const [uploads, all] = await Promise.all([
    apiTry<any[]>('/api/admin/spot-uploads/pending?limit=50', [], { revalidate: 0 }),
    apiTry<any[]>('/api/admin/pending?type=spots', [], { revalidate: 0 }),
  ]);
  const pending: any[] = Array.isArray(uploads) ? uploads : (uploads as any)?.items || [];

  return (
    <>
      <DashboardHeader
        eyebrow="Moderation"
        title="Spot moderation"
        kicker="Approve new uploads, edit covers, feature the best — or hide what breaks the rules."
      />
      <div className="px-6 lg:px-10 pb-16">
        <SpotsModerationClient initialPending={pending} />
      </div>
    </>
  );
}
