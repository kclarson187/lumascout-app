import Link from 'next/link';
import { apiTry } from '@/lib/api';
import { DashboardHeader, EmptyState } from '@/components/dashboard-parts';
import { LinkButton } from '@/components/ui/button';
import { ShoppingCart, Download, ShieldCheck, CheckCircle, AlertCircle } from 'lucide-react';

export const dynamic = 'force-dynamic';

function money(c?: number) { const v = c ?? 0; return `$${(v / 100).toFixed(v % 100 === 0 ? 0 : 2)}`; }

export default async function SellerOrdersPage() {
  const data = await apiTry<any>('/api/me/marketplace/sales?limit=200', { items: [] }, { revalidate: 0 });
  const sales: any[] = Array.isArray(data) ? data : data?.items || data?.sales || [];

  const completed = sales.filter((s) => ['completed', 'paid'].includes((s.status || '').toLowerCase()));
  const refunded = sales.filter((s) => (s.status || '').toLowerCase() === 'refunded');
  const pending = sales.filter((s) => !['completed', 'paid', 'refunded'].includes((s.status || '').toLowerCase()));

  return (
    <>
      <DashboardHeader
        eyebrow="Revenue"
        title="Orders"
        kicker="Every purchase, refund, and fulfillment status — live."
        right={<LinkButton href="/seller/payouts" variant="outline">View payouts</LinkButton>}
      />
      <div className="px-6 lg:px-10 pb-16">
        {/* Summary */}
        <div className="mb-8 grid gap-3 grid-cols-3">
          <Tile label="Completed" value={completed.length.toLocaleString()} />
          <Tile label="Pending" value={pending.length.toLocaleString()} />
          <Tile label="Refunded" value={refunded.length.toLocaleString()} />
        </div>

        {sales.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No orders yet"
            body="Once a buyer purchases one of your products, it’ll appear here with delivery status."
            cta={<LinkButton href="/seller/products/new">Ship a product</LinkButton>}
          />
        ) : (
          <section className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 border-b border-border">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-ink-dim">
                    <th className="px-5 py-3 font-semibold">When</th>
                    <th className="px-5 py-3 font-semibold">Buyer</th>
                    <th className="px-5 py-3 font-semibold">Product</th>
                    <th className="px-5 py-3 font-semibold">Delivery</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold text-right">Gross</th>
                    <th className="px-5 py-3 font-semibold text-right">You earn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sales.map((s: any, i: number) => {
                    const k = (s.status || 'pending').toLowerCase();
                    const StatusIcon = k === 'refunded' ? AlertCircle : ['completed', 'paid'].includes(k) ? CheckCircle : ShieldCheck;
                    const gross = s.amount_cents || s.gross_cents || 0;
                    const net = s.net_cents ?? Math.floor(gross * 0.85);
                    const delivered = s.delivered_at || s.download_granted;
                    return (
                      <tr key={s.purchase_id || i} className="hover:bg-surface-2 transition-colors">
                        <td className="px-5 py-3 whitespace-nowrap text-ink-muted text-xs">{s.created_at ? new Date(s.created_at).toLocaleString() : '—'}</td>
                        <td className="px-5 py-3 text-ink">
                          {s.buyer_username ? <Link href={`/u/${s.buyer_username}`} className="hover:text-brand">@{s.buyer_username}</Link> : (s.buyer_email || '—')}
                        </td>
                        <td className="px-5 py-3">
                          <Link href={s.product_id ? `/seller/products/${s.product_id}` : '#'} className="text-ink hover:text-brand font-semibold">{s.product_title || s.title || 'Product'}</Link>
                        </td>
                        <td className="px-5 py-3">
                          {delivered ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-success"><Download size={11} /> Delivered</span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">Awaiting</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest rounded-full px-2 py-0.5 border ${
                            k === 'refunded' ? 'border-danger/30 text-danger bg-danger/5' :
                            ['completed', 'paid'].includes(k) ? 'border-success/30 text-success bg-success/5' :
                            'border-brand/30 text-brand bg-brand/5'
                          }`}>
                            <StatusIcon size={10} /> {k}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right text-ink-muted">{money(gross)}</td>
                        <td className="px-5 py-3 text-right font-semibold text-success">{money(net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-5">
      <p className="text-[10px] uppercase tracking-widest text-ink-dim">{label}</p>
      <p className="mt-2 font-display text-3xl tracking-tightest">{value}</p>
    </div>
  );
}
