import Link from 'next/link';
import { apiTry, apiFetch } from '@/lib/api';
import { DashboardHeader } from '@/components/dashboard-parts';
import { LinkButton } from '@/components/ui/button';
import { CreditCard, Package, ShoppingCart, TrendingUp, Eye, DollarSign, ArrowRight, Sparkles, AlertTriangle, BarChart3 } from 'lucide-react';

export const dynamic = 'force-dynamic';

function money(cents: number | undefined | null, currency = 'USD'): string {
  const c = typeof cents === 'number' ? cents : 0;
  const s = (c / 100).toFixed(c % 100 === 0 ? 0 : 2);
  return currency === 'USD' ? `$${s}` : `${s} ${currency}`;
}

export default async function SellerOverview() {
  const user = await apiFetch<any>('/api/auth/me');
  const [productsRaw, salesRaw, payoutsRaw, connect] = await Promise.all([
    apiTry<any>(`/api/marketplace/products?seller_user_id=${encodeURIComponent(user.user_id)}&include_unpublished=true&limit=200`, { items: [] }, { revalidate: 0 }),
    apiTry<any>('/api/me/marketplace/sales?limit=200', { items: [] }, { revalidate: 0 }),
    apiTry<any>('/api/me/seller/payouts?limit=100', { items: [], pending_cents: 0, available_cents: 0 }, { revalidate: 0 }),
    apiTry<any>('/api/me/seller/connect-status', { status: 'disconnected' }, { revalidate: 0 }),
  ]);

  const products: any[] = Array.isArray(productsRaw) ? productsRaw : productsRaw?.items || productsRaw?.products || [];
  const sales: any[] = Array.isArray(salesRaw) ? salesRaw : salesRaw?.items || salesRaw?.sales || [];
  const payouts: any[] = Array.isArray(payoutsRaw?.items) ? payoutsRaw.items : [];
  const availableCents = payoutsRaw?.available_cents ?? 0;
  const pendingCents = payoutsRaw?.pending_cents ?? 0;

  const activeProducts = products.filter((p: any) => ['active', 'approved', 'published'].includes((p.status || '').toLowerCase())).length;
  const salesCount = sales.filter((s: any) => ['completed', 'paid'].includes((s.status || '').toLowerCase())).length || sales.length;
  const grossCents = sales.reduce((acc: number, s: any) => acc + (s.amount_cents || s.gross_cents || 0), 0);
  const netCents = sales.reduce((acc: number, s: any) => acc + (s.net_cents || Math.floor((s.amount_cents || 0) * 0.85)), 0);
  const payoutsTotalCents = payouts.filter((p: any) => p.status === 'paid').reduce((acc: number, p: any) => acc + (p.amount || 0), 0);
  const totalViews = products.reduce((a: number, p: any) => a + (p.view_count || p.views || 0), 0);
  const conversion = totalViews > 0 ? (salesCount / totalViews) * 100 : 0;

  const connectStatus = (connect?.status || 'disconnected').toLowerCase();
  const stripeReady = connect?.stripe_ready !== false;

  const recentSales = sales.slice(0, 5);
  const topProducts = [...products]
    .sort((a: any, b: any) => (b.sales_count || 0) - (a.sales_count || 0) || (b.view_count || 0) - (a.view_count || 0))
    .slice(0, 4);

  return (
    <>
      <DashboardHeader
        eyebrow="Seller studio"
        title={`Welcome back${user.name ? ', ' + user.name.split(' ')[0] : ''}.`}
        kicker="Your creator business in one view. Earnings, payouts, and what’s working."
        right={<LinkButton href="/seller/products/new">New product</LinkButton>}
      />

      <div className="px-6 lg:px-10 pb-16">
        {/* Onboarding callout */}
        {connectStatus !== 'active' && (
          <div className="mb-8 flex flex-wrap items-center gap-4 rounded-2xl border border-brand/30 bg-brand/5 p-5">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-brand/30 bg-brand/10 text-brand shrink-0"><CreditCard size={18} /></span>
            <div className="flex-1 min-w-[260px]">
              <p className="font-semibold text-ink">{connectStatus === 'onboarding' || connectStatus === 'pending' ? 'Finish your Stripe onboarding to enable payouts' : 'Connect Stripe to start getting paid'}</p>
              <p className="mt-1 text-sm text-ink-muted">Creators keep <span className="text-ink">85%</span> of every sale. Stripe Express handles taxes, 1099s, and bank payouts.</p>
            </div>
            <LinkButton href="/seller/payouts">Open payouts</LinkButton>
          </div>
        )}
        {!stripeReady && (
          <div className="mb-8 flex items-center gap-3 rounded-2xl border border-border bg-surface-1 p-4 text-ink-muted text-sm">
            <AlertTriangle size={14} className="text-brand" /> Stripe billing is not configured on this instance — sales/payouts will show read-only data.
          </div>
        )}

        {/* KPI cards */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <KPI label="Gross earnings" value={money(grossCents)} icon={DollarSign} tone="success" />
          <KPI label="Net (85%)" value={money(netCents)} icon={DollarSign} />
          <KPI label="Available payout" value={money(availableCents)} icon={CreditCard} tone="success" />
          <KPI label="Pending balance" value={money(pendingCents)} icon={CreditCard} />
          <KPI label="Sales" value={salesCount.toLocaleString()} icon={ShoppingCart} />
          <KPI label="Active products" value={`${activeProducts}/${products.length}`} icon={Package} />
        </div>

        {/* Conversion + lifetime */}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface-1 p-5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-widest text-ink-dim">Conversion</p>
              <TrendingUp size={14} className="text-ink-dim" />
            </div>
            <div className="mt-3 flex items-end gap-3">
              <p className="font-display text-4xl tracking-tightest">{conversion.toFixed(2)}%</p>
              <p className="text-xs text-ink-muted pb-2">{salesCount} sales from {totalViews.toLocaleString()} views</p>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface-1 p-5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-widest text-ink-dim">Payouts completed</p>
              <CreditCard size={14} className="text-ink-dim" />
            </div>
            <p className="mt-3 font-display text-4xl tracking-tightest">{money(payoutsTotalCents)}</p>
            <p className="text-xs text-ink-muted mt-1">{payouts.length} payout{payouts.length === 1 ? '' : 's'} to date</p>
          </div>
        </div>

        {/* Panels */}
        <div className="mt-10 grid gap-6 lg:grid-cols-5">
          {/* Recent orders */}
          <section className="lg:col-span-3 rounded-2xl border border-border bg-surface-1 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2"><ShoppingCart size={14} className="text-ink-muted" /><h2 className="text-sm font-semibold">Recent orders</h2></div>
              <Link href="/seller/orders" className="text-xs text-ink-muted hover:text-ink flex items-center gap-1">View all <ArrowRight size={12} /></Link>
            </div>
            {recentSales.length === 0 ? (
              <div className="p-10 text-center text-sm text-ink-muted">No sales yet. List your first product to start earning.</div>
            ) : (
              <ul className="divide-y divide-border">
                {recentSales.map((s: any, i: number) => (
                  <li key={s.purchase_id || i} className="px-5 py-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{s.product_title || s.title || 'Order'}</p>
                      <p className="text-xs text-ink-muted">@{s.buyer_username || 'buyer'} · {s.created_at ? new Date(s.created_at).toLocaleDateString() : ''}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-success">{money(s.amount_cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Top products */}
          <section className="lg:col-span-2 rounded-2xl border border-border bg-surface-1 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2"><Sparkles size={14} className="text-ink-muted" /><h2 className="text-sm font-semibold">Top products</h2></div>
              <Link href="/seller/products" className="text-xs text-ink-muted hover:text-ink flex items-center gap-1">Manage <ArrowRight size={12} /></Link>
            </div>
            {topProducts.length === 0 ? (
              <div className="p-10 text-center text-sm text-ink-muted">
                <p>No products yet.</p>
                <LinkButton href="/seller/products/new" className="mt-3">Create your first product</LinkButton>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {topProducts.map((p: any) => (
                  <li key={p.product_id} className="px-5 py-3 flex items-center gap-3">
                    <div className="h-10 w-14 shrink-0 rounded-lg bg-[linear-gradient(135deg,#1A1206,#2B1A08)] bg-cover bg-center border border-border"
                      style={p.thumbnail_url ? { backgroundImage: `url(${p.thumbnail_url})` } : undefined} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{p.title}</p>
                      <p className="text-xs text-ink-muted">{(p.view_count || 0)} views · {(p.sales_count || 0)} sales</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-brand">{money(p.price_cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Quick actions */}
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Quick href="/seller/products/new" title="Ship a new product" body="Location packs, presets, guides, mentorships." icon={Package} />
          <Quick href="/seller/payouts" title="Manage payouts" body="Connect Stripe, see balance, open Express dashboard." icon={CreditCard} />
          <Quick href="/seller/analytics" title="Read analytics" body="Views, conversions, top-performing content." icon={BarChart3} />
        </div>
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
      <p className="mt-3 font-display text-2xl md:text-3xl tracking-tightest">{value}</p>
    </div>
  );
}

function Quick({ href, title, body, icon: Icon }: any) {
  return (
    <Link href={href} className="group relative overflow-hidden rounded-2xl border border-border bg-surface-1 p-6 transition-all hover:border-strong hover:-translate-y-0.5">
      <span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-bg text-success"><Icon size={18} /></span>
      <h3 className="mt-4 font-display text-xl tracking-tighter">{title}</h3>
      <p className="mt-2 text-sm text-ink-muted">{body}</p>
      <ArrowRight size={14} className="mt-4 text-ink-dim transition-transform group-hover:translate-x-1 group-hover:text-success" />
    </Link>
  );
}
