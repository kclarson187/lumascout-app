import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiFetch, apiTry } from '@/lib/api';
import { Badge } from '@/components/ui/primitives';
import { LinkButton } from '@/components/ui/button';
import { MapPin, Users, Camera, Star, ShieldCheck, ExternalLink } from 'lucide-react';

export const revalidate = 120;

type User = {
  user_id: string;
  name?: string;
  username?: string;
  avatar_url?: string;
  avatar_image_url?: string;
  banner_image_url?: string;
  bio?: string;
  city?: string;
  state?: string;
  verification_status?: string;
  plan?: string;
  website?: string;
  instagram?: string;
  specialties?: string[];
  stats?: { spots?: number; followers?: number; following?: number; posts_count?: number; reviews_received?: number };
};

async function fetchUser(username: string): Promise<User | null> {
  try {
    return await apiFetch<User>(`/api/users/by-username/${encodeURIComponent(username)}`, { auth: false, revalidate: 120 });
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const u = await fetchUser(username);
  if (!u) return { title: `@${username}`, robots: { index: false, follow: false } };
  const displayName = u.name || u.username || username;
  const loc = [u.city, u.state].filter(Boolean).join(', ');
  const desc = u.bio?.slice(0, 160) || `${displayName}${loc ? ` — photographer in ${loc}.` : ''} Follow their photo spots and work on LumaScout.`;
  return {
    title: `${displayName} (@${u.username || username})`,
    description: desc,
    alternates: { canonical: `https://lumascout.app/u/${u.username || username}` },
    openGraph: { title: displayName, description: desc, url: `https://lumascout.app/u/${u.username || username}`, images: u.banner_image_url || u.avatar_image_url ? [{ url: (u.banner_image_url || u.avatar_image_url) as string }] : undefined },
  };
}

export default async function PhotographerPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const user = await fetchUser(username);
  if (!user) return notFound();

  const displayName = user.name || user.username || username;
  const handle = user.username || username;
  const loc = [user.city, user.state].filter(Boolean).join(', ');
  const verified = (user.verification_status || '').toLowerCase() === 'verified';
  const plan = (user.plan || 'free').toLowerCase();
  const banner = user.banner_image_url;
  const avatar = user.avatar_image_url || user.avatar_url;
  const stats = user.stats || {};

  // Stub: try to load this user's public spots/products without blocking the render.
  const products = await apiTry<any[]>(`/api/marketplace/products?seller_user_id=${encodeURIComponent(user.user_id)}&limit=12`, [], { auth: false, revalidate: 300 });
  const productList = Array.isArray(products) ? products : (products as any)?.products || [];

  return (
    <>
      {/* Banner */}
      <section className="relative overflow-hidden border-b border-border">
        <div
          className="h-56 md:h-72 w-full bg-[linear-gradient(135deg,#0B0B0E,#1A1206_60%,#2B1A08)]"
          style={banner ? { backgroundImage: `url(${banner})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" aria-hidden />
      </section>

      {/* Header */}
      <section className="mx-auto -mt-20 max-w-6xl px-6 relative z-10">
        <div className="flex flex-col md:flex-row md:items-end md:gap-6">
          <div className="h-28 w-28 md:h-36 md:w-36 rounded-2xl border-2 border-bg bg-surface-2 overflow-hidden shrink-0"
            style={avatar ? { backgroundImage: `url(${avatar})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
          >
            {!avatar && <div className="grid h-full w-full place-items-center text-ink-dim"><Camera size={28} /></div>}
          </div>
          <div className="mt-4 md:mt-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-4xl md:text-5xl tracking-tightest">{displayName}</h1>
              {verified && <Badge tone="brand"><ShieldCheck size={12} /> Verified</Badge>}
              {plan !== 'free' && <Badge tone="brand">{plan.toUpperCase()}</Badge>}
            </div>
            <p className="mt-1 text-ink-muted">@{handle}{loc && <span className="text-ink-dim"> · <MapPin size={12} className="inline -mt-0.5" /> {loc}</span>}</p>
            {user.bio && <p className="mt-3 max-w-2xl text-ink">{user.bio}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {user.specialties?.slice(0, 8).map((s) => (
                <span key={s} className="text-[11px] uppercase tracking-widest text-ink-muted border border-border rounded-full px-3 py-1">{s}</span>
              ))}
            </div>
          </div>
          <div className="mt-5 md:mt-0 flex gap-2">
            <LinkButton href="/register">Follow on app</LinkButton>
            {user.website && (
              <a href={user.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm text-ink hover:border-strong">
                Website <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Spots', value: stats.spots ?? 0, icon: MapPin },
            { label: 'Followers', value: stats.followers ?? 0, icon: Users },
            { label: 'Posts', value: stats.posts_count ?? 0, icon: Camera },
            { label: 'Reviews', value: stats.reviews_received ?? 0, icon: Star },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-2xl border border-border bg-surface-1 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-widest text-ink-dim">{label}</p>
                <Icon size={14} className="text-ink-dim" />
              </div>
              <p className="mt-2 font-display text-3xl tracking-tightest">{value.toLocaleString()}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Products */}
      <section className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-brand font-semibold">Store</p>
            <h2 className="mt-1 font-display text-3xl md:text-4xl tracking-tightest">Location packs & guides</h2>
          </div>
          <Link href="/marketplace" className="text-sm text-ink-muted hover:text-ink">Browse marketplace →</Link>
        </div>
        {productList.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-border bg-surface-1 p-10 text-center text-ink-muted">
            No products yet from {displayName}. Follow along on the app to see their latest spots.
          </div>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {productList.slice(0, 6).map((p: any, i: number) => (
              <div key={p.product_id || i} className="rounded-2xl border border-border bg-surface-1 p-4">
                <div className="aspect-[4/3] rounded-xl bg-[linear-gradient(135deg,#1A1206,#2B1A08)] grid place-items-center"><Camera size={24} className="text-ink-dim" /></div>
                <p className="mt-3 text-sm font-semibold">{p.title || p.name}</p>
                <p className="text-xs text-ink-muted">${((p.price_cents ?? 0) / 100).toFixed(2)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* App CTA */}
      <section className="border-t border-border bg-surface-1">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <h3 className="font-display text-3xl md:text-4xl tracking-tightest">See their work. Shoot their spots.</h3>
          <p className="mt-3 text-ink-muted">The mobile app unlocks the full experience — DMs, follows, saves, and more.</p>
          <div className="mt-6 flex justify-center gap-3">
            <LinkButton href="/register">Join free</LinkButton>
            <LinkButton href="/pricing" variant="outline">See pricing</LinkButton>
          </div>
        </div>
      </section>
    </>
  );
}
