import { apiTry } from '@/lib/api';
import { DashboardHeader, EmptyState } from '@/components/dashboard-parts';
import { LinkButton } from '@/components/ui/button';
import { Users, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type Tab = 'followers' | 'following';

export default async function FollowersPage({ searchParams }: { searchParams: Promise<{ tab?: Tab }> }) {
  const sp = await searchParams;
  const tab: Tab = sp?.tab === 'following' ? 'following' : 'followers';

  const [followers, following] = await Promise.all([
    apiTry<any[]>('/api/me/followers', [], { revalidate: 0 }),
    apiTry<any[]>('/api/me/following', [], { revalidate: 0 }),
  ]);

  const list: any[] = tab === 'followers' ? (Array.isArray(followers) ? followers : []) : (Array.isArray(following) ? following : []);

  return (
    <>
      <DashboardHeader
        eyebrow="Network"
        title={tab === 'followers' ? 'Your followers' : 'People you follow'}
        kicker="Photographers connected to your work on LumaScout."
        right={<LinkButton href="/photographers" variant="outline">Find creators</LinkButton>}
      />

      {/* Tabs */}
      <div className="border-b border-border bg-surface-1">
        <div className="px-6 lg:px-10 flex gap-1">
          {[
            { key: 'followers', label: 'Followers', count: followers?.length || 0 },
            { key: 'following', label: 'Following', count: following?.length || 0 },
          ].map((t) => (
            <Link
              key={t.key}
              href={`/dashboard/followers?tab=${t.key}`}
              className={`inline-flex items-center gap-2 px-4 py-3 -mb-px text-sm border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-brand text-ink font-semibold'
                  : 'border-transparent text-ink-muted hover:text-ink'
              }`}
            >
              {t.label}
              <span className="text-xs text-ink-dim">{t.count.toLocaleString()}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="px-6 lg:px-10 py-10">
        {list.length === 0 ? (
          <EmptyState
            icon={Users}
            title={tab === 'followers' ? 'No followers yet' : 'You’re not following anyone yet'}
            body={tab === 'followers'
              ? 'Share your spots and build a verified profile to attract followers.'
              : 'Browse photographers and follow people whose work you love.'}
            cta={<LinkButton href="/photographers">Browse photographers</LinkButton>}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((u: any, i: number) => (
              <Link
                key={u.user_id || i}
                href={u.username ? `/u/${u.username}` : '#'}
                className="group flex items-center gap-4 rounded-2xl border border-border bg-surface-1 p-4 transition-colors hover:border-strong"
              >
                <div
                  className="h-12 w-12 shrink-0 rounded-full bg-surface-2 bg-cover bg-center"
                  style={u.avatar_url ? { backgroundImage: `url(${u.avatar_url})` } : undefined}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-ink">{u.name || u.username || 'Photographer'}</p>
                    {u.verification_status === 'verified' && <ShieldCheck size={12} className="text-brand" />}
                  </div>
                  <p className="truncate text-xs text-ink-muted">
                    @{u.username}{[u.city, u.state].filter(Boolean).length ? ` · ${[u.city, u.state].filter(Boolean).join(', ')}` : ''}
                  </p>
                </div>
                {u.plan && u.plan !== 'free' && (
                  <span className="shrink-0 text-[10px] uppercase tracking-widest text-brand border border-brand/30 rounded-full px-2.5 py-1">
                    {u.plan}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
