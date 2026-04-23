import { apiTry } from '@/lib/api';
import { DashboardHeader, EmptyState } from '@/components/dashboard-parts';
import { LinkButton } from '@/components/ui/button';
import { Eye, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

function timeAgo(iso?: string) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function ViewersPage() {
  const [viewers, summary] = await Promise.all([
    apiTry<any[]>('/api/me/viewers', [], { revalidate: 0 }),
    apiTry<any>('/api/me/viewers/summary', {}, { revalidate: 0 }),
  ]);
  const list: any[] = Array.isArray(viewers) ? viewers : viewers?.items || [];
  const total = summary?.total ?? summary?.count ?? list.length;

  return (
    <>
      <DashboardHeader
        eyebrow="Pro perk"
        title="Who viewed your profile"
        kicker={`${total.toLocaleString()} photographers have viewed your profile recently.`}
        right={<LinkButton href="/pricing" variant="outline">Upgrade for more</LinkButton>}
      />
      <div className="px-6 lg:px-10 py-10">
        {list.length === 0 ? (
          <EmptyState
            icon={Eye}
            title="No viewers yet"
            body="Post spots, follow other photographers, and upload to the community to attract profile visits."
            cta={<LinkButton href="/photographers">Explore photographers</LinkButton>}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((v: any, i: number) => {
              const viewer = v.viewer || v;
              const uname = viewer.username || viewer.viewer_username;
              return (
                <Link key={v.view_id || i} href={uname ? `/u/${uname}` : '#'} className="group flex items-center gap-4 rounded-2xl border border-border bg-surface-1 p-4 transition-colors hover:border-strong">
                  <div
                    className="h-12 w-12 shrink-0 rounded-full bg-surface-2 bg-cover bg-center"
                    style={viewer.avatar_url ? { backgroundImage: `url(${viewer.avatar_url})` } : undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-ink">{viewer.name || uname || 'A photographer'}</p>
                      {(viewer.verification_status === 'verified') && <ShieldCheck size={12} className="text-brand" />}
                    </div>
                    <p className="truncate text-xs text-ink-muted">
                      {[viewer.viewer_city || viewer.city, viewer.viewer_state || viewer.state].filter(Boolean).join(', ') || 'Recent'}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-ink-dim">{timeAgo(v.last_viewed_at || v.first_viewed_at)}</p>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
