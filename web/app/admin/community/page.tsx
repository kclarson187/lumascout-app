import { apiTry } from '@/lib/api';
import { DashboardHeader } from '@/components/dashboard-parts';
import { CommunityModerationClient } from './_client';

export const dynamic = 'force-dynamic';

export default async function CommunityPage() {
  const [content, summary] = await Promise.all([
    apiTry<any>('/api/admin/community/content?limit=40', { items: [] }, { revalidate: 0 }),
    apiTry<any>('/api/admin/community/summary', {}, { revalidate: 0 }),
  ]);
  const items: any[] = Array.isArray(content) ? content : content?.items || [];

  return (
    <>
      <DashboardHeader
        eyebrow="Moderation"
        title="Community"
        kicker="Posts, polls, and comments flagged or recently active."
      />
      <div className="px-6 lg:px-10 pb-16">
        {/* Summary */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-8">
          {[
            { label: 'Posts', value: summary?.posts ?? summary?.posts_count ?? items.filter((i: any) => i.type === 'post').length },
            { label: 'Polls', value: summary?.polls ?? summary?.polls_count ?? items.filter((i: any) => i.type === 'poll').length },
            { label: 'Comments', value: summary?.comments ?? summary?.comments_count ?? 0 },
            { label: 'Flagged', value: summary?.flagged ?? summary?.flags_count ?? 0 },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-surface-1 p-4">
              <p className="text-[10px] uppercase tracking-widest text-ink-dim">{s.label}</p>
              <p className="mt-2 font-display text-3xl tracking-tightest">{(s.value ?? 0).toLocaleString()}</p>
            </div>
          ))}
        </div>

        <CommunityModerationClient initialItems={items} />
      </div>
    </>
  );
}
