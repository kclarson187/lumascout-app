import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiTry } from '@/lib/api';
import { LinkButton } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { MapPin, Sunrise, Moon, Camera, Sparkles, ShieldCheck, Star, Users } from 'lucide-react';

export const revalidate = 300;

// Canonical slug → display info for metadata only. The actual spot list
// comes from the live DB via /api/spots?city=<display>.
const CITIES: Record<string, { display: string; state?: string; country: string; blurb: string; tags: string[] }> = {
  austin: { display: 'Austin', state: 'TX', country: 'USA', blurb: 'Big skies, ATX murals, Barton Springs light, and Hill Country bluebonnets every spring.', tags: ['Urban', 'Wildflowers', 'Golden Hour'] },
  denver: { display: 'Denver', state: 'CO', country: 'USA', blurb: 'Front Range sunsets, alpine lakes, and Rocky Mountain storms in less than an hour from the city.', tags: ['Mountains', 'Astro', 'Storm'] },
  'san-antonio': { display: 'San Antonio', state: 'TX', country: 'USA', blurb: 'Mission architecture, Riverwalk reflections, and Hill Country backroads with world-class golden hour.', tags: ['Architecture', 'Water', 'History'] },
  'los-angeles': { display: 'Los Angeles', state: 'CA', country: 'USA', blurb: 'Coastal cliffs, hills, neon boulevards, and infinite sunsets over the Pacific.', tags: ['Coast', 'Urban', 'Golden Hour'] },
  'new-york': { display: 'New York', state: 'NY', country: 'USA', blurb: 'From DUMBO reflections to skyline rooftops and sunrise over the Brooklyn Bridge.', tags: ['Urban', 'Architecture', 'Rooftop'] },
  'san-francisco': { display: 'San Francisco', state: 'CA', country: 'USA', blurb: 'Golden Gate fog, Alamo Square light, and rolling coastal hills minutes from downtown.', tags: ['Fog', 'Coast', 'Urban'] },
  seattle: { display: 'Seattle', state: 'WA', country: 'USA', blurb: 'Moody marine layer, Puget Sound boats, and Olympic + Rainier views on every clear day.', tags: ['Mood', 'Mountain', 'Water'] },
  portland: { display: 'Portland', state: 'OR', country: 'USA', blurb: 'Waterfalls, Columbia Gorge light, Mt. Hood, and moody Pacific Northwest drama.', tags: ['Waterfall', 'Forest', 'Mood'] },
  chicago: { display: 'Chicago', state: 'IL', country: 'USA', blurb: 'Skyline reflections, Riverwalk blue-hour, and the best mid-western sunsets.', tags: ['Urban', 'Architecture', 'Water'] },
  miami: { display: 'Miami', state: 'FL', country: 'USA', blurb: 'Art Deco pastels, glass towers, and golden hour over the Atlantic.', tags: ['Color', 'Coast', 'Urban'] },
};

export async function generateStaticParams() {
  return Object.keys(CITIES).map((city) => ({ city }));
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city } = await params;
  const d = CITIES[city.toLowerCase()];
  const display = d?.display || city.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const title = `Best photo spots in ${display}`;
  const desc = (d?.blurb || `Discover ${display}'s best photo spots on LumaScout.`) + ` Sunrise, golden hour, astro, and blue hour locations curated by photographers.`;
  return {
    title,
    description: desc,
    alternates: { canonical: `https://lumascout.app/spots/${city.toLowerCase()}` },
    openGraph: { title, description: desc, url: `https://lumascout.app/spots/${city.toLowerCase()}` },
  };
}

function coverUrl(spot: any): string | undefined {
  if (spot.admin_cover_override?.image_url) return spot.admin_cover_override.image_url;
  if (spot.cover_image_url) return spot.cover_image_url;
  const imgs = spot.images || spot.uploads || [];
  return imgs.find((i: any) => i.is_cover)?.image_url || imgs[0]?.image_url;
}

function freshness(spot: any): { label: string; tone: 'success' | 'neutral' | 'warn' } | null {
  const ts = spot.last_verified_at || spot.updated_at || spot.created_at;
  if (!ts) return null;
  const days = (Date.now() - new Date(ts).getTime()) / 86_400_000;
  if (days < 30) return { label: 'Fresh', tone: 'success' };
  if (days < 90) return { label: 'Recent', tone: 'neutral' };
  return { label: 'Check conditions', tone: 'warn' };
}

export default async function CitySpotsPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const slug = city.toLowerCase();
  const meta = CITIES[slug];
  const display = meta?.display || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // LIVE from DB. Fetch spots by city (case-insensitive regex on backend).
  const spotsRaw = await apiTry<any>(`/api/spots?city=${encodeURIComponent(display)}&limit=48&sort=score`, [], { auth: false, revalidate: 300 });
  const spots: any[] = Array.isArray(spotsRaw) ? spotsRaw : spotsRaw?.items || [];

  // If the slug has no canonical entry AND no spots found, treat as 404.
  if (!meta && spots.length === 0) return notFound();

  // Aggregate derived facts: unique contributors, freshness counts, tag frequency.
  const contributors = new Set<string>();
  let freshCount = 0;
  const tagCounts: Record<string, number> = {};
  for (const s of spots) {
    if (s.created_by_user_id || s.owner_user_id) contributors.add(s.created_by_user_id || s.owner_user_id);
    const f = freshness(s);
    if (f?.tone === 'success') freshCount += 1;
    for (const t of (s.style_tags || s.shoot_types || [])) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);

  return (
    <>
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-border bg-bg grain">
        <div className="pointer-events-none absolute inset-0 bg-radial-spot" aria-hidden />
        <div className="mx-auto max-w-6xl px-6 pt-36 pb-14 lg:pt-44">
          <Badge tone="brand"><MapPin size={12} /> {meta?.state ? `${meta.state} · ` : ''}{meta?.country || 'USA'}</Badge>
          <h1 className="mt-6 font-display text-5xl md:text-6xl lg:text-7xl tracking-tightest leading-[1.05]">
            Best photo spots in <span className="text-brand">{display}.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">{meta?.blurb || `Real spots. Real contributors. Real conditions — updated by photographers on the ground.`}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {(topTags.length ? topTags : meta?.tags || []).map((t) => (
              <span key={t} className="text-[11px] uppercase tracking-widest text-ink-muted border border-border rounded-full px-3 py-1">{t}</span>
            ))}
          </div>
          {/* Live stats row */}
          <div className="mt-8 flex flex-wrap items-center gap-6 text-sm text-ink-muted">
            <span className="flex items-center gap-1.5"><Camera size={14} className="text-brand" /> <span className="text-ink font-semibold">{spots.length}</span> spots</span>
            <span className="flex items-center gap-1.5"><Users size={14} className="text-brand" /> <span className="text-ink font-semibold">{contributors.size}</span> contributors</span>
            <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-success" /> <span className="text-ink font-semibold">{freshCount}</span> fresh</span>
          </div>
          <div className="mt-8 flex gap-3">
            <LinkButton href="/register">Save these free</LinkButton>
            <LinkButton href="/marketplace" variant="outline">Shop location packs</LinkButton>
          </div>
        </div>
      </div>

      {/* Grid — LIVE from DB */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        {spots.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface-1 p-14 text-center">
            <Camera size={20} className="mx-auto text-ink-dim" />
            <h2 className="mt-4 font-display text-2xl tracking-tightest">No public spots in {display} yet.</h2>
            <p className="mt-2 text-sm text-ink-muted">Be the first to contribute from the iOS or Android app.</p>
            <div className="mt-5 flex justify-center"><LinkButton href="/register">Download the app</LinkButton></div>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {spots.map((s: any) => {
              const cover = coverUrl(s);
              const f = freshness(s);
              const hours = s.best_time_of_day || '';
              const TimeIcon = hours.toLowerCase().includes('sunrise') ? Sunrise : hours.toLowerCase().includes('astro') ? Moon : Sparkles;
              const savesCount = s.save_count ?? s.saved_count ?? 0;
              const rating = s.shoot_score ?? s.rating_avg;
              return (
                <Link key={s.spot_id} href={`/spots/${s.slug || s.spot_id}`} className="group overflow-hidden rounded-2xl border border-border bg-surface-1 transition-all hover:border-strong hover:-translate-y-0.5">
                  <div className="relative aspect-[4/3] bg-[linear-gradient(135deg,#1A1206,#2B1A08)] bg-cover bg-center" style={cover ? { backgroundImage: `url(${cover})` } : undefined}>
                    {!cover && <div className="absolute inset-0 grid place-items-center text-ink-dim"><Camera size={28} /></div>}
                    {f && (
                      <span className={`absolute top-3 left-3 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest rounded-full px-2 py-0.5 border backdrop-blur ${
                        f.tone === 'success' ? 'border-success/40 bg-success/10 text-success' :
                        f.tone === 'warn' ? 'border-danger/40 bg-danger/10 text-danger' :
                        'border-border bg-black/40 text-ink-muted'
                      }`}><ShieldCheck size={9} /> {f.label}</span>
                    )}
                    {typeof rating === 'number' && rating > 0 && (
                      <span className="absolute top-3 right-3 inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 bg-black/60 text-brand backdrop-blur">
                        <Star size={9} className="fill-brand" /> {Number(rating).toFixed(1)}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold text-ink line-clamp-1">{s.name || s.title || 'Spot'}</p>
                      {savesCount > 0 && <span className="shrink-0 text-[10px] uppercase tracking-widest text-ink-muted">{savesCount} saves</span>}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted line-clamp-1">{[s.neighborhood, s.city || display].filter(Boolean).join(' · ')}</p>
                    <div className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-muted">
                      <TimeIcon size={11} className="text-brand" />
                      <span>{hours ? `Best at ${hours}` : (s.shoot_types || [])[0] || 'Open shoot'}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-surface-1">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <h2 className="font-display text-3xl md:text-4xl tracking-tightest">Plan your {display} shoot.</h2>
          <p className="mt-3 text-ink-muted">Astronomy overlays, permit flags, crowd levels, and community field notes — live across iOS, Android, and the web.</p>
          <div className="mt-6 flex justify-center gap-3">
            <LinkButton href="/register">Join free</LinkButton>
            <LinkButton href="/pricing" variant="outline">See pricing</LinkButton>
          </div>
          <p className="mt-5 text-xs text-ink-dim"><Link href="/photographers" className="hover:text-ink">Browse photographers →</Link></p>
        </div>
      </section>
    </>
  );
}
