'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { approveSpotUpload, spotAction, approveSpot, rejectSpot } from '../_actions';
import { Check, X, Eye, EyeOff, Star, StarOff, Loader2, MapPin, AlertTriangle } from 'lucide-react';

export function SpotsModerationClient({ initialPending }: { initialPending: any[] }) {
  const [pending, setPending] = useState(initialPending);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [_, startTransition] = useTransition();

  async function runAction(id: string, label: string, fn: () => Promise<any>) {
    setBusy(`${id}:${label}`); setErr(null);
    try {
      await fn();
      setPending((prev) => prev.filter((p) => (p.upload_id || p.spot_id) !== id));
    } catch (e: any) {
      setErr(e?.message || 'Action failed');
    } finally { setBusy(null); }
  }

  return (
    <>
      {err && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 text-danger text-sm px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={14} /> {err}
        </div>
      )}

      <section className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold flex items-center gap-2"><MapPin size={14} className="text-brand" /> Pending uploads <span className="text-ink-dim font-normal">({pending.length})</span></h2>
        </div>
        {pending.length === 0 ? (
          <div className="p-14 text-center">
            <p className="font-display text-xl tracking-tighter">All clear.</p>
            <p className="mt-2 text-sm text-ink-muted">No spot uploads pending review.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((s) => {
              const id = s.upload_id || s.spot_id;
              const cover = s.cover_image_url || (s.images?.[0]?.image_url) || '';
              const city = [s.city, s.state].filter(Boolean).join(', ');
              return (
                <li key={id} className="px-5 py-4 flex items-start gap-4">
                  <div
                    className="h-20 w-28 shrink-0 rounded-xl bg-[linear-gradient(135deg,#1A1206,#2B1A08)] bg-cover bg-center border border-border"
                    style={cover ? { backgroundImage: `url(${cover})` } : undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-ink">{s.name || s.title || 'Untitled spot'}</p>
                      {s.type_tag && <span className="text-[10px] uppercase tracking-widest text-ink-muted border border-border rounded-full px-2 py-0.5">{s.type_tag}</span>}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">{city}{s.submitter_username ? ` · by @${s.submitter_username}` : ''}</p>
                    {s.description && <p className="mt-2 text-sm text-ink-muted line-clamp-2">{s.description}</p>}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <ActionButton disabled={busy === `${id}:approve`} onClick={() => startTransition(() => runAction(id, 'approve', () => s.upload_id ? approveSpotUpload(id, true) : approveSpot(id)))} tone="success" icon={Check}>
                      {busy === `${id}:approve` ? 'Approving…' : 'Approve'}
                    </ActionButton>
                    <ActionButton disabled={busy === `${id}:deny`} onClick={() => {
                      const reason = prompt('Reason for rejection?');
                      if (!reason) return;
                      startTransition(() => runAction(id, 'deny', () => s.upload_id ? approveSpotUpload(id, false, reason) : rejectSpot(id, reason)));
                    }} tone="danger" icon={X}>Deny</ActionButton>
                    {s.spot_id && (
                      <>
                        <IconButton title="Hide" onClick={() => startTransition(() => runAction(id, 'hide', () => spotAction(id, 'hide')))} icon={EyeOff} />
                        <IconButton title="Feature" onClick={() => startTransition(() => runAction(id, 'feature', () => spotAction(id, 'feature')))} icon={Star} />
                        <Link href={`/spots/${s.slug || s.spot_id}`} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs text-ink-muted hover:text-ink hover:border-strong"><Eye size={12} /> View</Link>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function ActionButton({ children, onClick, disabled, tone, icon: Icon }: any) {
  const toneClass = tone === 'success' ? 'border-success/30 bg-success/10 text-success hover:bg-success/20' :
                   tone === 'danger' ? 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/20' :
                   'border-border bg-surface-2 text-ink hover:border-strong';
  return (
    <button onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold disabled:opacity-60 transition ${toneClass}`}>
      {disabled ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      {children}
    </button>
  );
}

function IconButton({ title, onClick, icon: Icon }: any) {
  return (
    <button title={title} onClick={onClick} className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface-2 text-ink-muted hover:text-ink hover:border-strong transition">
      <Icon size={13} />
    </button>
  );
}
