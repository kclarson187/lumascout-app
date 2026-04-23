import type { Metadata } from 'next';
import Link from 'next/link';
import { apiTry } from '@/lib/api';
import { Section, Badge, Card } from '@/components/ui/primitives';
import { LinkButton } from '@/components/ui/button';
import { Star, ShoppingBag, ShieldCheck, Sparkles, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Marketplace — Location packs, presets, mentorships',
  description:
    'Browse location packs, Lightroom presets, route guides, and mentorship sessions by top photographers. Creators keep 85%.',
  alternates: { canonical: 'https://lumascout.app/marketplace' },
  openGraph: {
    title: 'LumaScout Marketplace — Location packs, presets, mentorships',
    description: 'Shop from creators. Keep 85%.',
    url: 'https://lumascout.app/marketplace',
  },
};

export const revalidate = 300;

type Product = {
  product_id?: string;
  id?: string;
  title?: string;
  name?: string;
  description?: string;
  price_cents?: number;
  price?: number;
  currency?: string;
  cover_image_url?: string;
  image_url?: string;
  seller_name?: string;
  seller_username?: string;
  category?: string;
  rating?: number;
};

function money(cents?: number, fallback?: number) {
  const c = typeof cents === 'number' ? cents : typeof fallback === 'number' ? fallback * 100 : undefined;
  if (typeof c !== 'number') return '—';
  return `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
}

export default async function MarketplacePage() {
  const raw = await apiTry<any>('/api/marketplace/products?limit=24', { products: [] }, { auth: false, revalidate: 300 });
  const products: Product[] = Array.isArray(raw) ? raw : raw?.products || raw?.items || [];

  const demo: Product[] = [
    { title: 'Patagonia Winter Pack', price_cents: 4900, seller_name: 'Alex R.', category: 'Location pack', rating: 4.9 },
    { title: 'Milky Way Masterclass', price_cents: 8900, seller_name: 'Kai M.', category: 'Mentorship', rating: 5.0 },
    { title: 'NYC Rooftop Guide', price_cents: 2900, seller_name: 'Juno L.', category: 'Guide', rating: 4.8 },
    { title: 'Iceland 7-day Route', price_cents: 7900, seller_name: 'Sasha P.', category: 'Route', rating: 4.9 },
    { title: 'Cinematic LUT Pack', price_cents: 1900, seller_name: 'Maya K.', category: 'Preset', rating: 4.7 },
    { title: 'Storm Chase Field Guide', price_cents: 3900, seller_name: 'Drew N.', category: 'Guide', rating: 4.9 },
    { title: 'Golden Hour Presets', price_cents: 1200, seller_name: 'Ari P.', category: 'Preset', rating: 4.6 },
    { title: 'Utah Slot Canyons', price_cents: 5900, seller_name: 'Theo W.', category: 'Location pack', rating: 4.9 },
  ];
  const list = products.length ? products : demo;

  const categories = Array.from(new Set(list.map((p) => p.category).filter(Boolean))) as string[];

  return (
    <>
      {/* Head */}
      <div className="relative overflow-hidden border-b border-border bg-bg grain">
        <div className="pointer-events-none absolute inset-0 bg-radial-spot" aria-hidden />
        <div className="mx-auto max-w-6xl px-6 pt-36 pb-16 text-center lg:pt-44">
          <Badge tone="brand">Marketplace</Badge>
          <h1 className="mt-6 font-display text-5xl md:text-6xl lg:text-7xl tracking-tightest leading-[1.05]">
            Shop from the best photographers <span className="text-brand">in the world.</span>
          </h1>
          <p className="mt-5 text-lg text-ink-muted max-w-2xl mx-auto">
            Location packs, route guides, Lightroom presets, and live mentorship sessions from verified creators.
            Creators keep <span className="text-ink">85%</span>.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <LinkButton href="/register">Start selling</LinkButton>
            <LinkButton href="/pricing" variant="outline">Creator pricing</LinkButton>
          </div>
        </div>
      </div>

      {/* Categories */}
      {categories.length > 0 && (
        <section className="border-b border-border bg-surface-1">
          <div className="mx-auto max-w-7xl px-6 py-5 lg:px-8 flex flex-wrap gap-2">
            {['All', ...categories].map((c) => (
              <span key={c} className="inline-flex items-center rounded-full border border-border bg-bg px-3.5 py-1.5 text-xs text-ink-muted hover:border-strong hover:text-ink transition-colors cursor-pointer">{c}</span>
            ))}
          </div>
        </section>
      )}

      {/* Grid */}
      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-20">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((p, i) => {
            const slug = p.product_id || p.id || i.toString();
            const price = money(p.price_cents, p.price);
            return (
              <Link key={slug} href={`/marketplace/${slug}`} className="group rounded-2xl border border-border bg-surface-1 p-4 transition-all hover:border-strong hover:-translate-y-0.5">
                <div className="aspect-[4/3] rounded-xl bg-[linear-gradient(135deg,#1A1206,#2B1A08)] grid place-items-center overflow-hidden">
                  <ShoppingBag size={28} className="text-ink-dim" />
                </div>
                <div className="mt-4">
                  {p.category && <p className="text-[10px] uppercase tracking-widest text-brand font-semibold">{p.category}</p>}
                  <p className="mt-1 text-sm font-semibold text-ink line-clamp-2">{p.title || p.name}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-xs text-ink-muted">by {p.seller_name || p.seller_username || 'Creator'}</p>
                    <div className="flex items-center gap-2">
                      {typeof p.rating === 'number' && (
                        <span className="flex items-center gap-1 text-[11px] text-ink-muted"><Star size={10} className="fill-brand text-brand" />{p.rating.toFixed(1)}</span>
                      )}
                      <span className="text-sm font-semibold text-brand">{price}</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Trust */}
      <section className="border-y border-border bg-surface-1">
        <div className="mx-auto max-w-7xl px-6 py-14 lg:px-8 grid gap-6 md:grid-cols-3">
          {[
            { icon: ShieldCheck, t: 'Secure payments', d: 'Stripe-powered checkout with refund protection and dispute handling.' },
            { icon: Sparkles, t: 'Verified creators', d: 'Every listing is reviewed. Fakes, copycats, and stolen content get removed.' },
            { icon: Star, t: 'Loved by 12,000+', d: '4.9 average rating across iOS, Android, and web. Built by photographers for photographers.' },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="flex items-start gap-4">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-bg text-brand shrink-0"><Icon size={18} /></span>
              <div>
                <p className="text-sm font-semibold text-ink">{t}</p>
                <p className="mt-1 text-sm text-ink-muted">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <Section title="Have packs to sell?" kicker="Open a store in minutes. Stripe Express handles payouts. You keep 85%.">
        <div className="flex justify-center gap-3">
          <LinkButton href="/register?plan=elite" size="lg">Become a creator <ArrowRight size={16} /></LinkButton>
          <LinkButton href="/pricing" variant="outline" size="lg">See Elite plan</LinkButton>
        </div>
      </Section>
    </>
  );
}
