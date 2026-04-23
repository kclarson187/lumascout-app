'use client';

import { useState, useTransition } from 'react';
import { moderateProduct, refundPurchase } from '../_actions';
import { Check, X, Star, Loader2, AlertTriangle, ShoppingBag, RotateCcw, EyeOff } from 'lucide-react';

export function MarketplaceModerationClient({ initialPending, purchases }: { initialPending: any[]; purchases: any[] }) {
  const [pending, setPending] = useState(initialPending);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [_, startTransition] = useTransition();

  async function runAction(id: string, label: string, fn: () => Promise<any>, removeOnSuccess = false) {
    setBusy(`${id}:${label}`); setErr(null);
    try { await fn(); if (removeOnSuccess) setPending((prev) => prev.filter((p) => (p.product_id || p.id) !== id)); }
    catch (e: any) { setErr(e?.message || 'Action failed'); } finally { setBusy(null); }
  }

  return (
    <>
      {err && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 text-danger text-sm px-4 py-3 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>
      )}

      <section className="rounded-2xl border border-border bg-surface-1 overflow-hidden mb-8">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold flex items-center gap-2"><ShoppingBag size={14} className="text-brand" /> Pending listings <span className="text-ink-dim font-normal">({pending.length})</span></h2>
        </div>
        {pending.length === 0 ? (
          <div className="p-14 text-center">
            <p className="font-display text-xl tracking-tighter">Inbox zero.</p>
            <p className="mt-2 text-sm text-ink-muted">No listings waiting for review.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((p: any) => {
              const id = p.product_id || p.id;
              const cover = p.cover_image_url || p.image_url || '';
              const price = typeof p.price_cents === 'number' ? `$${(p.price_cents / 100).toFixed(2)}` : p.price ? `$${p.price}` : '—';
              return (
                <li key={id} className="px-5 py-4 flex items-start gap-4">
                  <div className="h-20 w-28 shrink-0 rounded-xl bg-[linear-gradient(135deg,#1A1206,#2B1A08)] bg-cover bg-center border border-border"
                    style={cover ? { backgroundImage: `url(${cover})` } : undefined} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{p.title || p.name}</p>
                    <p className="mt-1 text-xs text-ink-muted">{p.category || 'Listing'} · by @{p.seller_username || p.seller_name || 'seller'} · <span className="text-brand font-semibold">{price}</span></p>
                    {p.description && <p className="mt-2 text-sm text-ink-muted line-clamp-2">{p.description}</p>}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <ActionBtn onClick={() => startTransition(() => runAction(id, 'approve', () => moderateProduct(id, 'approve'), true))} busy={busy === `${id}:approve`} tone="success" icon={Check}>Approve</ActionBtn>
                    <ActionBtn onClick={() => { const reason = prompt('Deny reason?') || ''; if (!reason) return; startTransition(() => runAction(id, 'deny', () => moderateProduct(id, 'deny', reason), true)); }} busy={busy === `${id}:deny`} tone="danger" icon={X}>Deny</ActionBtn>
                    <ActionBtn onClick={() => startTransition(() => runAction(id, 'feature', () => moderateProduct(id, 'feature')))} busy={busy === `${id}:feature`} icon={Star}>Feature</ActionBtn>
                    <ActionBtn onClick={() => startTransition(() => runAction(id, 'unpub', () => moderateProduct(id, 'unpublish')))} busy={busy === `${id}:unpub`} icon={EyeOff}>Unpublish</ActionBtn>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold flex items-center gap-2"><RotateCcw size={14} className="text-ink-muted" /> Recent purchases <span className="text-ink-dim font-normal">({purchases.length})</span></h2>
        </div>
        {purchases.length === 0 ? (
          <div className="p-10 text-sm text-ink-muted text-center">No recent purchases.</div>
        ) : (
          <ul className="divide-y divide-border">
            {purchases.map((p: any) => {
              const id = p.purchase_id || p.id;
              const amt = typeof p.amount_cents === 'number' ? `$${(p.amount_cents / 100).toFixed(2)}` : '—';
              const refunded = !!p.refunded_at || p.status === 'refunded';
              return (
                <li key={id} className="px-5 py-3 flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{p.product_title || p.title || 'Purchase'}</p>
                    <p className="text-xs text-ink-muted">by @{p.buyer_username || 'buyer'} · {amt}{refunded ? ' · REFUNDED' : ''}</p>
                  </div>
                  <ActionBtn onClick={() => { const reason = prompt('Refund reason?') || ''; startTransition(() => runAction(id, 'refund', () => refundPurchase(id, reason))); }} busy={busy === `${id}:refund`} tone="danger" icon={RotateCcw} disabled={refunded}>{refunded ? 'Refunded' : 'Refund'}</ActionBtn>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function ActionBtn({ children, onClick, busy, tone, icon: Icon, disabled }: any) {
  const toneClass = tone === 'success' ? 'border-success/30 bg-success/10 text-success hover:bg-success/20' :
                   tone === 'danger' ? 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/20' :
                   'border-border bg-surface-2 text-ink hover:border-strong';
  return (
    <button onClick={onClick} disabled={busy || disabled} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold disabled:opacity-50 transition ${toneClass}`}>
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      {children}
    </button>
  );
}
