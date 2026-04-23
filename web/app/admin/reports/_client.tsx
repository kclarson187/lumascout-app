'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { resolveReport } from '../_actions';
import { Flag, Check, X, Loader2, AlertTriangle } from 'lucide-react';

export function ReportsClient({ initialItems, currentStatus }: { initialItems: any[]; currentStatus: string }) {
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [_, startTransition] = useTransition();

  async function runResolve(id: string, resolution: string) {
    const action = resolution === 'valid' ? 'removed content' : 'no action';
    setBusy(id); setErr(null);
    try {
      await resolveReport(id, resolution, action);
      setItems((p) => p.filter((r) => r.report_id !== id));
    } catch (e: any) { setErr(e?.message || 'Failed'); } finally { setBusy(null); }
  }

  return (
    <>
      {/* Status tabs */}
      <div className="mb-6 flex gap-1">
        {['open', 'resolved', 'all'].map((s) => (
          <Link key={s} href={`/admin/reports?status=${s}`} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
            currentStatus === s ? 'border-danger bg-danger/10 text-danger' : 'border-border text-ink-muted hover:text-ink hover:border-strong'
          }`}>
            {s[0].toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </div>

      {err && <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 text-danger text-sm px-4 py-3 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>}

      <section className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        {items.length === 0 ? (
          <div className="p-14 text-center">
            <Flag size={20} className="mx-auto text-ink-dim" />
            <p className="mt-3 font-display text-xl tracking-tighter">No {currentStatus} reports.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((r: any) => (
              <li key={r.report_id} className="px-5 py-4 flex items-start gap-4">
                <span className="shrink-0 grid h-9 w-9 place-items-center rounded-xl border border-danger/30 bg-danger/10 text-danger"><Flag size={14} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] uppercase tracking-widest text-ink-muted border border-border rounded-full px-2 py-0.5">{r.target_type}</span>
                    <span className="text-xs text-ink-dim">@{r.reporter_username || 'anon'} · {r.created_at ? new Date(r.created_at).toLocaleString() : ''}</span>
                  </div>
                  <p className="mt-2 text-sm text-ink">{r.reason || r.reason_category || 'No reason provided'}</p>
                  {r.context && <p className="mt-1 text-sm text-ink-muted line-clamp-2">{r.context}</p>}
                </div>
                {currentStatus === 'open' && (
                  <div className="shrink-0 flex items-center gap-2">
                    <button onClick={() => startTransition(() => runResolve(r.report_id, 'valid'))} disabled={busy === r.report_id} className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 text-success hover:bg-success/20 px-3 py-2 text-xs font-semibold disabled:opacity-60 transition">
                      {busy === r.report_id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Valid
                    </button>
                    <button onClick={() => startTransition(() => runResolve(r.report_id, 'invalid'))} disabled={busy === r.report_id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 text-ink hover:border-strong px-3 py-2 text-xs font-semibold disabled:opacity-60 transition">
                      <X size={12} /> Dismiss
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
