import Link from 'next/link';
import { apiTry } from '@/lib/api';
import { DashboardHeader } from '@/components/dashboard-parts';
import { ShieldCheck, MapPinned, ShoppingBag, Flag, Users as UsersIcon, FileClock, ArrowRight, MessageSquare } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const [overview, pending, audit, reports] = await Promise.all([
    apiTry<any>('/api/admin/overview', {}, { revalidate: 0 }),
    apiTry<any>('/api/admin/pending', {}, { revalidate: 0 }),
    apiTry<any>('/api/admin/audit-logs?limit=8', { items: [] }, { revalidate: 0 }),
    apiTry<any>('/api/admin/reports?status=open&limit=6', { items: [] }, { revalidate: 0 }),
  ]);

  const stats = [
    { label: 'Pending spots', value: pending?.pending_spot_uploads ?? pending?.pending_spots ?? 0, href: '/admin/spots', icon: MapPinned, tone: 'warn' as const },
    { label: 'Marketplace queue', value: pending?.pending_marketplace ?? pending?.pending_products ?? 0, href: '/admin/marketplace', icon: ShoppingBag, tone: 'warn' as const },
    { label: 'Open reports', value: pending?.open_reports ?? pending?.pending_reports ?? 0, href: '/admin/reports', icon: Flag, tone: 'danger' as const },
    { label: 'Flagged users', value: overview?.flagged_users ?? overview?.flagged_user_count ?? 0, href: '/admin/users?filter=flagged', icon: UsersIcon, tone: 'warn' as const },
    { label: 'Community flags', value: pending?.pending_community ?? overview?.community_flags ?? 0, href: '/admin/community', icon: MessageSquare, tone: 'neutral' as const },
    { label: 'Total users', value: overview?.total_users ?? overview?.users_count ?? 0, href: '/admin/users', icon: UsersIcon, tone: 'neutral' as const },
  ];

  const auditItems: any[] = Array.isArray(audit) ? audit : audit?.items || [];
  const reportItems: any[] = Array.isArray(reports) ? reports : reports?.items || [];

  return (
    <>
      <DashboardHeader
        eyebrow="Admin console"
        title="Control center."
        kicker="Everything that needs your attention. Approve, moderate, and keep LumaScout healthy."
      />
      <div className="px-6 lg:px-10 pb-16">
        {/* Stats */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {stats.map((s) => (
            <Link key={s.label} href={s.href} className="group rounded-2xl border border-border bg-surface-1 p-5 transition-all hover:border-strong hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-ink-dim">{s.label}</span>
                <s.icon size={14} className={
                  s.tone === 'danger' ? 'text-danger' :
                  s.tone === 'warn' ? 'text-brand' :
                  'text-ink-dim'
                } />
              </div>
              <p className="mt-3 font-display text-3xl lg:text-4xl tracking-tightest">{(s.value ?? 0).toLocaleString()}</p>
            </Link>
          ))}
        </div>

        {/* Two panels */}
        <div className="mt-10 grid gap-6 lg:grid-cols-5">
          {/* Reports */}
          <section className="lg:col-span-3 rounded-2xl border border-border bg-surface-1 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <Flag size={14} className="text-danger" />
                <h2 className="text-sm font-semibold">Open reports</h2>
              </div>
              <Link href="/admin/reports" className="text-xs text-ink-muted hover:text-ink flex items-center gap-1">View queue <ArrowRight size={12} /></Link>
            </div>
            {reportItems.length === 0 ? (
              <div className="p-10 text-center text-sm text-ink-muted">No open reports. Nicely done.</div>
            ) : (
              <ul className="divide-y divide-border">
                {reportItems.slice(0, 6).map((r: any) => (
                  <li key={r.report_id} className="px-5 py-3 flex items-center gap-3 hover:bg-surface-2 transition-colors">
                    <span className="text-[10px] uppercase tracking-widest text-danger border border-danger/30 bg-danger/10 rounded-full px-2 py-0.5">{r.target_type || 'report'}</span>
                    <p className="flex-1 min-w-0 truncate text-sm text-ink">{r.reason || r.summary || 'Report'}</p>
                    <span className="text-xs text-ink-dim">{r.reporter_username ? `by @${r.reporter_username}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Audit */}
          <section className="lg:col-span-2 rounded-2xl border border-border bg-surface-1 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <FileClock size={14} className="text-ink-muted" />
                <h2 className="text-sm font-semibold">Recent admin activity</h2>
              </div>
              <Link href="/admin/audit-logs" className="text-xs text-ink-muted hover:text-ink flex items-center gap-1">All logs <ArrowRight size={12} /></Link>
            </div>
            {auditItems.length === 0 ? (
              <div className="p-10 text-center text-sm text-ink-muted">No admin activity yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {auditItems.slice(0, 8).map((a: any, i: number) => (
                  <li key={a.log_id || i} className="px-5 py-3">
                    <p className="text-sm text-ink line-clamp-1"><span className="text-brand font-semibold">{a.action || a.event}</span> {a.target_type ? `on ${a.target_type}` : ''}</p>
                    <p className="text-xs text-ink-dim mt-0.5">{a.actor_username ? `@${a.actor_username}` : ''}{a.created_at ? ` · ${new Date(a.created_at).toLocaleString()}` : ''}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Quick jump */}
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <QuickLink href="/admin/spots" title="Moderate spots" body="Approve new uploads, edit covers, feature the best." icon={MapPinned} />
          <QuickLink href="/admin/marketplace" title="Marketplace queue" body="Review listings, approve payouts, handle refunds." icon={ShoppingBag} />
          <QuickLink href="/admin/users" title="User management" body="Verify creators, comp plans, suspend abusers." icon={ShieldCheck} />
        </div>
      </div>
    </>
  );
}

function QuickLink({ href, title, body, icon: Icon }: { href: string; title: string; body: string; icon: any }) {
  return (
    <Link href={href} className="group relative overflow-hidden rounded-2xl border border-border bg-surface-1 p-6 transition-all hover:border-strong hover:-translate-y-0.5">
      <span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-bg text-danger"><Icon size={18} /></span>
      <h3 className="mt-4 font-display text-xl tracking-tighter">{title}</h3>
      <p className="mt-2 text-sm text-ink-muted">{body}</p>
      <ArrowRight size={14} className="mt-4 text-ink-dim transition-transform group-hover:translate-x-1 group-hover:text-danger" />
    </Link>
  );
}
