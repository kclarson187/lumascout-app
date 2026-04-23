import { apiTry } from '@/lib/api';
import { DashboardHeader } from '@/components/dashboard-parts';
import { FileClock } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<{ action?: string; actor?: string }> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: '200' });
  if (sp?.action) qs.set('action', sp.action);
  if (sp?.actor) qs.set('actor', sp.actor);

  const data = await apiTry<any>(`/api/admin/audit-logs?${qs.toString()}`, { items: [] }, { revalidate: 0 });
  const items: any[] = Array.isArray(data) ? data : data?.items || [];

  return (
    <>
      <DashboardHeader
        eyebrow="Admin"
        title="Audit logs"
        kicker="Immutable record of every admin action. Search and filter to investigate incidents."
      />
      <div className="px-6 lg:px-10 pb-16">
        <section className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold flex items-center gap-2"><FileClock size={14} className="text-ink-muted" /> Recent activity <span className="text-ink-dim font-normal">({items.length})</span></h2>
          </div>
          {items.length === 0 ? (
            <div className="p-14 text-center">
              <FileClock size={20} className="mx-auto text-ink-dim" />
              <p className="mt-3 font-display text-xl tracking-tighter">No activity yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 border-b border-border">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-ink-dim">
                    <th className="px-5 py-3 font-semibold">When</th>
                    <th className="px-5 py-3 font-semibold">Actor</th>
                    <th className="px-5 py-3 font-semibold">Action</th>
                    <th className="px-5 py-3 font-semibold">Target</th>
                    <th className="px-5 py-3 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((a: any, i: number) => (
                    <tr key={a.log_id || i} className="hover:bg-surface-2 transition-colors">
                      <td className="px-5 py-3 whitespace-nowrap text-ink-muted text-xs">{a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</td>
                      <td className="px-5 py-3 text-ink">{a.actor_name || '@' + (a.actor_username || 'system')}</td>
                      <td className="px-5 py-3"><span className="text-brand font-semibold">{a.action || a.event || '—'}</span></td>
                      <td className="px-5 py-3 text-ink-muted">{a.target_type ? `${a.target_type}:${a.target_id || '—'}` : '—'}</td>
                      <td className="px-5 py-3 text-ink-muted text-xs max-w-md truncate">{a.reason || a.notes || a.detail || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
