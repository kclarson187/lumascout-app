'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { updateProduct, deleteProduct } from '../_actions';
import { Pencil, EyeOff, Eye, Archive, Trash2, Loader2, AlertTriangle, ExternalLink, Package } from 'lucide-react';

function money(c?: number) {
  if (typeof c !== 'number') return '—';
  return `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
}

function statusPill(s: string) {
  const k = (s || 'draft').toLowerCase();
  if (['active', 'approved', 'published'].includes(k)) return 'border-success/30 bg-success/10 text-success';
  if (['pending', 'review'].includes(k)) return 'border-brand/30 bg-brand/10 text-brand';
  if (['rejected', 'denied'].includes(k)) return 'border-danger/30 bg-danger/10 text-danger';
  if (['archived', 'unpublished'].includes(k)) return 'border-border bg-surface-2 text-ink-dim';
  return 'border-border bg-surface-2 text-ink-muted';
}

export function ProductsClient({ initialProducts }: { initialProducts: any[] }) {
  const [products, setProducts] = useState(initialProducts);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'pending' | 'archived'>('all');
  const [_, startTransition] = useTransition();

  const counts = {
    all: products.length,
    active: products.filter((p) => ['active', 'approved', 'published'].includes((p.status || '').toLowerCase())).length,
    pending: products.filter((p) => ['pending', 'review'].includes((p.status || '').toLowerCase())).length,
    archived: products.filter((p) => ['archived', 'unpublished'].includes((p.status || '').toLowerCase())).length,
  };

  const filtered = filter === 'all' ? products :
    filter === 'active' ? products.filter((p) => ['active', 'approved', 'published'].includes((p.status || '').toLowerCase())) :
    filter === 'pending' ? products.filter((p) => ['pending', 'review'].includes((p.status || '').toLowerCase())) :
    products.filter((p) => ['archived', 'unpublished'].includes((p.status || '').toLowerCase()));

  async function run(id: string, label: string, fn: () => Promise<any>, patch?: Record<string, any>, removeOnSuccess = false) {
    setBusy(`${id}:${label}`); setErr(null);
    try {
      await fn();
      if (removeOnSuccess) setProducts((p) => p.filter((x) => x.product_id !== id));
      else if (patch) setProducts((p) => p.map((x) => (x.product_id === id ? { ...x, ...patch } : x)));
    } catch (e: any) { setErr(e?.message || 'Action failed'); } finally { setBusy(null); }
  }

  return (
    <>
      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {([
          { k: 'all', l: 'All', c: counts.all },
          { k: 'active', l: 'Active', c: counts.active },
          { k: 'pending', l: 'Pending', c: counts.pending },
          { k: 'archived', l: 'Archived', c: counts.archived },
        ] as const).map((t) => (
          <button key={t.k} onClick={() => setFilter(t.k)}
            className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition ${
              filter === t.k ? 'border-success bg-success/10 text-success font-semibold' : 'border-border text-ink-muted hover:text-ink hover:border-strong'
            }`}>
            {t.l} <span className="text-ink-dim">{t.c}</span>
          </button>
        ))}
      </div>

      {err && <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 text-danger text-sm px-4 py-3 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>}

      <section className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-14 text-center">
            <Package size={20} className="mx-auto text-ink-dim" />
            <p className="mt-3 font-display text-xl tracking-tighter">No {filter === 'all' ? '' : filter} products.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-widest text-ink-dim">
                  <th className="px-5 py-3 font-semibold">Product</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Price</th>
                  <th className="px-5 py-3 font-semibold">Views</th>
                  <th className="px-5 py-3 font-semibold">Sales</th>
                  <th className="px-5 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((p) => {
                  const id = p.product_id;
                  const statusKey = (p.status || 'draft').toLowerCase();
                  const archived = ['archived', 'unpublished'].includes(statusKey);
                  return (
                    <tr key={id} className="hover:bg-surface-2 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-12 w-16 shrink-0 rounded-lg bg-[linear-gradient(135deg,#1A1206,#2B1A08)] bg-cover bg-center border border-border"
                            style={p.thumbnail_url ? { backgroundImage: `url(${p.thumbnail_url})` } : undefined} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink">{p.title}</p>
                            <p className="truncate text-xs text-ink-muted">{(p.category || p.type || 'Product').replace('_', ' ')}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-block text-[10px] uppercase tracking-widest rounded-full px-2 py-0.5 border ${statusPill(statusKey)}`}>{statusKey}</span>
                      </td>
                      <td className="px-5 py-3 text-ink font-semibold">{money(p.price_cents)}</td>
                      <td className="px-5 py-3 text-ink-muted">{(p.view_count || 0).toLocaleString()}</td>
                      <td className="px-5 py-3 text-ink-muted">{(p.sales_count || 0).toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Link href={`/seller/products/${id}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-ink-muted hover:text-ink hover:border-strong transition">
                            <Pencil size={11} /> Edit
                          </Link>
                          <Link href={`/marketplace/${p.slug || id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-ink-muted hover:text-ink hover:border-strong transition">
                            <ExternalLink size={11} /> View
                          </Link>
                          {archived ? (
                            <RowBtn onClick={() => startTransition(() => run(id, 'pub', () => updateProduct(id, { status: 'pending' }), { status: 'pending' }))} busy={busy === `${id}:pub`} icon={Eye}>Unarchive</RowBtn>
                          ) : (
                            <RowBtn onClick={() => startTransition(() => run(id, 'arc', () => updateProduct(id, { status: 'archived' }), { status: 'archived' }))} busy={busy === `${id}:arc`} icon={Archive}>Archive</RowBtn>
                          )}
                          <RowBtn tone="danger" onClick={() => { if (!confirm('Delete permanently? This cannot be undone.')) return; startTransition(() => run(id, 'del', () => deleteProduct(id), undefined, true)); }} busy={busy === `${id}:del`} icon={Trash2}>Delete</RowBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function RowBtn({ children, onClick, busy, tone, icon: Icon }: any) {
  const toneClass = tone === 'danger' ? 'border-danger/30 bg-danger/5 text-danger hover:bg-danger/10' :
                   'border-border bg-surface-1 text-ink-muted hover:text-ink hover:border-strong';
  return (
    <button onClick={onClick} disabled={busy} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-60 transition ${toneClass}`}>
      {busy ? <Loader2 size={11} className="animate-spin" /> : <Icon size={11} />} {children}
    </button>
  );
}
