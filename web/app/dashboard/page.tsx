import Link from 'next/link';
import { apiFetch, apiTry } from '@/lib/api';
import { DashboardHeader } from '@/components/dashboard-parts';
import { Eye, Users, Bookmark, Folder, MessageSquareText, Map, TrendingUp, ArrowRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function DashboardOverview() {
  const user = await apiFetch<any>('/api/auth/me');
  const [saved, collections, viewers, followers, conversations] = await Promise.all([
    apiTry<any[]>('/api/me/saved', [], { revalidate: 0 }),
    apiTry<any[]>('/api/me/collections', [], { revalidate: 0 }),
    apiTry<any>('/api/me/viewers/summary', { total: 0 }, { revalidate: 0 }),
    apiTry<any[]>('/api/me/followers', [], { revalidate: 0 }),
    apiTry<any[]>('/api/me/conversations', [], { revalidate: 0 }),
  ]);

  const savedCount = Array.isArray(saved) ? saved.length : 0;
  const collectionsCount = Array.isArray(collections) ? collections.length : 0;
  const viewersCount = viewers?.total ?? viewers?.count ?? (Array.isArray(viewers) ? viewers.length : 0);
  const followersCount = Array.isArray(followers) ? followers.length : 0;
  const conversationsCount = Array.isArray(conversations) ? conversations.length : 0;

  const stats = [
    { label: 'Saved spots', value: savedCount, icon: Bookmark, href: '/dashboard/saved' },
    { label: 'Collections', value: collectionsCount, icon: Folder, href: '/dashboard/collections' },
    { label: 'Profile viewers', value: viewersCount, icon: Eye, href: '/dashboard/viewers' },
    { label: 'Followers', value: followersCount, icon: Users, href: '/dashboard/followers' },
    { label: 'Conversations', value: conversationsCount, icon: MessageSquareText, href: '/dashboard/messages' },
  ];

  return (
    <>
      <DashboardHeader
        eyebrow={`Welcome back, ${(user.name || '').split(' ')[0] || user.username || ''}`}
        title="Your command center."
        kicker="Everything you've saved, shot, and built — in one place."
      />

      <div className="px-6 lg:px-10 pb-16">
        {/* Stats grid */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {stats.map(({ label, value, icon: Icon, href }) => (
            <Link key={label} href={href} className="group rounded-2xl border border-border bg-surface-1 p-5 transition-all hover:border-strong hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-widest text-ink-dim">{label}</span>
                <Icon size={14} className="text-ink-dim group-hover:text-brand transition-colors" />
              </div>
              <p className="mt-3 font-display text-3xl lg:text-4xl tracking-tightest">{(value ?? 0).toLocaleString()}</p>
            </Link>
          ))}
        </div>

        {/* Quick actions */}
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <QuickCard href="/dashboard/map" title="Plan a shoot" body="Open the map planner. Filter by golden hour, season, and condition." icon={Map} />
          <QuickCard href="/dashboard/collections" title="Build a collection" body="Group spots into a trip, a mood, or a portfolio set." icon={Folder} />
          <QuickCard href="/marketplace" title="Browse marketplace" body="Location packs, presets, and mentorships from the community." icon={TrendingUp} />
        </div>

        {/* Recent saved */}
        {savedCount > 0 && (
          <section className="mt-14">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-brand font-semibold">Recent saves</p>
                <h2 className="mt-1 font-display text-2xl md:text-3xl tracking-tightest">Picked up where you left off</h2>
              </div>
              <Link href="/dashboard/saved" className="text-sm text-ink-muted hover:text-ink flex items-center gap-1">
                View all <ArrowRight size={14} />
              </Link>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {saved.slice(0, 4).map((s: any, i: number) => (
                <SpotCard key={s.spot_id || i} spot={s} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function QuickCard({ href, title, body, icon: Icon }: { href: string; title: string; body: string; icon: any }) {
  return (
    <Link href={href} className="group relative overflow-hidden rounded-2xl border border-border bg-surface-1 p-6 transition-all hover:border-strong hover:-translate-y-0.5">
      <span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-bg text-brand">
        <Icon size={18} />
      </span>
      <h3 className="mt-4 font-display text-xl tracking-tighter">{title}</h3>
      <p className="mt-2 text-sm text-ink-muted">{body}</p>
      <ArrowRight size={14} className="mt-4 text-ink-dim transition-transform group-hover:translate-x-1 group-hover:text-brand" />
    </Link>
  );
}

function SpotCard({ spot }: { spot: any }) {
  const cover = (spot.images || []).find((i: any) => i.is_cover) || (spot.images || [])[0] || {};
  return (
    <Link href={`/spots/${spot.slug || spot.spot_id}`} className="group rounded-2xl border border-border bg-surface-1 p-3 transition-all hover:border-strong hover:-translate-y-0.5">
      <div
        className="aspect-[4/3] rounded-xl bg-[linear-gradient(135deg,#1A1206,#2B1A08)] bg-cover bg-center"
        style={cover.image_url ? { backgroundImage: `url(${cover.image_url})` } : undefined}
      />
      <p className="mt-3 text-sm font-semibold line-clamp-1">{spot.name || spot.title}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{[spot.city, spot.state].filter(Boolean).join(', ')}</p>
    </Link>
  );
}
