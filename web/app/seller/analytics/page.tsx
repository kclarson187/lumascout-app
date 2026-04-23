import { apiFetch, apiTry } from '@/lib/api';
import { DashboardHeader } from '@/components/dashboard-parts';
import { EmptyState } from '@/components/dashboard-parts';
import Link from 'next/link';
import { BarChart3, Eye, ShoppingCart, DollarSign, TrendingUp, Sparkles } from 'lucide-react';

export const dynamic = 'force-dynamic';

function money(c?: number) { const v = c ?? 0; return `$${(v / 100).toFixed(v % 100 === 0 ? 0 : 2)}`; }

export default async function SellerAnalyticsPage() {
  const user = await apiFetch<any>('/api/auth/me');
  const [productsRaw, salesRaw] = await Promise.all([
    apiTry<any>(`/api/marketplace/products?seller_user_id=${encodeURIComponent(user.user_id)}&include_unpublished=true&limit=200`, { items: [] }, { revalidate: 0 }),
    apiTry<any>('/api/me/marketplace/sales?limit=500', { items: [] }, { revalidate: 0 }),
  ]);
  const products: any[] = Array.isArray(productsRaw) ? productsRaw : productsRaw?.items || productsRaw?.products || [];
  const sales: any[] = Array.isArray(salesRaw) ? salesRaw : salesRaw?.items || salesRaw?.sales || [];

  const totalViews = products.reduce((a, p) => a + (p.view_count || 0), 0);
  const totalSales = sales.filter((s) => ['completed', 'paid'].includes((s.status || '').toLowerCase())).length || sales.length;
  const totalRevenue = sales.reduce((a, s) => a + (s.amount_cents || 0), 0);
  const conv = totalViews > 0 ? (totalSales / totalViews) * 100 : 0;

  // Revenue by day (last 30 days)
  const now = Date.now();
  const days: { label: string; cents: number }[] = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now - (29 - i) * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    return { label: key, cents: 0 };
  });
  const byDay = new Map(days.map((d) => [d.label, d]));
  for (const s of sales) {
    if (!s.created_at) continue;
    const key = new Date(s.created_at).toISOString().slice(0, 10);
    const d = byDay.get(key);
    if (d) d.cents += s.amount_cents || 0;
  }
  const maxDay = Math.max(1, ...days.map((d) => d.cents));

  // Top products
  const top = [...products]
    .map((p) => ({
      ...p,
      _conv: (p.view_count || 0) > 0 ? ((p.sales_count || 0) / p.view_count) * 100 : 0,
      _revenue: (p.sales_count || 0) * (p.price_cents || 0),
    }))
    .sort((a, b) => b._revenue - a._revenue || b.sales_count - a.sales_count)
    .slice(0, 6);

  return (
    <>
      <DashboardHeader
        eyebrow="Analytics"
        title="Store performance"
        kicker="Views, conversions, and revenue — at a glance and per product."
      />
      <div className="px-6 lg:px-10 pb-16">
        {/* KPI strip */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KPI label="Views" value={totalViews.toLocaleString()} icon={Eye} />
          <KPI label="Purchases" value={totalSales.toLocaleString()} icon={ShoppingCart} />
          <KPI label="Conversion" value={`${conv.toFixed(2)}%`} icon={TrendingUp} />
          <KPI label="Revenue (gross)" value={money(totalRevenue)} icon={DollarSign} tone="success" />
        </div>

        {/* 30-day bar chart */}
        <section className="mt-8 rounded-2xl border border-border bg-surface-1 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-ink-dim font-semibold">Revenue</p>
              <h2 className="mt-1 font-display text-2xl tracking-tightest">Last 30 days</h2>
            </div>
            <BarChart3 size={14} className="text-ink-dim" />
          </div>
          <div className="mt-6 flex items-end gap-1 h-40">
            {days.map((d, i) => {
              const h = (d.cents / maxDay) * 100;
              return (
                <div key={i} className="flex-1 min-w-[6px] relative group">
                  <div
                    className={`w-full rounded-t ${d.cents > 0 ? 'bg-gradient-to-t from-success/20 to-success' : 'bg-surface-2'}`}
                    style={{ height: `${Math.max(2, h)}%` }}
                    title={`${d.label}: ${money(d.cents)}`}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-between text-[10px] text-ink-dim">
            <span>{days[0].label}</span>
            <span>{days[days.length - 1].label}</span>
          </div>
        </section>

        {/* Top products */}
        <section className="mt-8 rounded-2xl border border-border bg-surface-1 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold flex items-center gap-2"><Sparkles size={14} className="text-ink-muted" /> Top products</h2>
            <Link href="/seller/products" className="text-xs text-ink-muted hover:text-ink">Manage products →</Link>
          </div>
          {top.length === 0 ? (
            <div className="p-10"><EmptyState icon={BarChart3} title="No data yet" body="Product views and sales will appear here once you’re live." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 border-b border-border">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-ink-dim">
                    <th className="px-5 py-3 font-semibold">Product</th>
                    <th className="px-5 py-3 font-semibold">Price</th>
                    <th className="px-5 py-3 font-semibold">Views</th>
                    <th className="px-5 py-3 font-semibold">Sales</th>
                    <th className="px-5 py-3 font-semibold">Conv %</th>
                    <th className="px-5 py-3 font-semibold text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {top.map((p: any) => (
                    <tr key={p.product_id} className="hover:bg-surface-2 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-10 w-14 shrink-0 rounded-lg bg-[linear-gradient(135deg,#1A1206,#2B1A08)] bg-cover bg-center border border-border"
                            style={p.thumbnail_url ? { backgroundImage: `url(${p.thumbnail_url})` } : undefined} />
                          <Link href={`/seller/products/${p.product_id}`} className="truncate font-semibold text-ink hover:text-brand">{p.title}</Link>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-ink">{money(p.price_cents)}</td>
                      <td className="px-5 py-3 text-ink-muted">{(p.view_count || 0).toLocaleString()}</td>
                      <td className="px-5 py-3 text-ink-muted">{(p.sales_count || 0).toLocaleString()}</td>
                      <td className="px-5 py-3 text-ink-muted">{p._conv.toFixed(2)}%</td>
                      <td className="px-5 py-3 text-right font-semibold text-success">{money(p._revenue)}</td>
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

function KPI({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone?: 'success' | 'neutral' }) {
  const iconClass = tone === 'success' ? 'text-success' : 'text-ink-dim';
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-ink-dim">{label}</p>
        <Icon size={14} className={iconClass} />
      </div>
      <p className="mt-3 font-display text-3xl lg:text-4xl tracking-tightest">{value}</p>
    </div>
  );
}
