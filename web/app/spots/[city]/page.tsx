import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { LinkButton } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { MapPin, Sunrise, Moon, Camera, Sparkles } from 'lucide-react';

export const revalidate = 3600;

const cities: Record<string, { name: string; state?: string; country: string; blurb: string; tags: string[]; spots: { name: string; type: string; time: string }[] }> = {
  austin: { name: 'Austin', state: 'TX', country: 'USA', blurb: 'Big skies, ATX murals, Barton Springs light, and the Hill Country bluebonnets every spring.', tags: ['Urban', 'Wildflowers', 'Golden Hour'], spots: [
    { name: 'Mount Bonnell', type: 'Viewpoint', time: 'Sunset' },
    { name: 'Zilker Park', type: 'Park', time: 'Golden Hour' },
    { name: 'Congress Ave Bridge — Bats', type: 'Wildlife', time: 'Dusk' },
    { name: 'Pennybacker Bridge', type: 'Architecture', time: 'Sunrise' },
  ]},
  denver: { name: 'Denver', state: 'CO', country: 'USA', blurb: 'Front Range sunsets, alpine lakes, and Rocky Mountain storms in less than an hour from the city.', tags: ['Mountains', 'Astro', 'Storm'], spots: [
    { name: 'Red Rocks', type: 'Amphitheater', time: 'Sunrise' },
    { name: 'Bear Lake (RMNP)', type: 'Alpine lake', time: 'Sunrise' },
    { name: 'Brainard Lake', type: 'Wilderness', time: 'Astro' },
    { name: 'Mount Evans Road', type: 'Alpine road', time: 'Sunset' },
  ]},
  'san-antonio': { name: 'San Antonio', state: 'TX', country: 'USA', blurb: 'Mission architecture, Riverwalk reflections, and Hill Country backroads with world-class golden hour.', tags: ['Architecture', 'Water', 'History'], spots: [
    { name: 'San Antonio Missions', type: 'Historic', time: 'Golden Hour' },
    { name: 'Riverwalk', type: 'Urban', time: 'Blue Hour' },
    { name: 'The Pearl District', type: 'Urban', time: 'Dusk' },
    { name: 'Hamilton Pool (nearby)', type: 'Swimming hole', time: 'Midday' },
  ]},
  'los-angeles': { name: 'Los Angeles', state: 'CA', country: 'USA', blurb: 'Coastal cliffs, hills, neon boulevards, and infinite sunsets over the Pacific.', tags: ['Coast', 'Urban', 'Golden Hour'], spots: [
    { name: 'Griffith Observatory', type: 'Viewpoint', time: 'Sunset' },
    { name: 'El Matador State Beach', type: 'Coastal', time: 'Golden Hour' },
    { name: 'Vasquez Rocks', type: 'Geology', time: 'Astro' },
    { name: 'Downtown Rooftops', type: 'Urban', time: 'Blue Hour' },
  ]},
  'new-york': { name: 'New York', state: 'NY', country: 'USA', blurb: 'From DUMBO reflections to skyline rooftops and sunrise over the Brooklyn Bridge.', tags: ['Urban', 'Architecture', 'Rooftop'], spots: [
    { name: 'Brooklyn Bridge (DUMBO side)', type: 'Architecture', time: 'Sunrise' },
    { name: 'The High Line', type: 'Urban', time: 'Golden Hour' },
    { name: 'Top of the Rock', type: 'Viewpoint', time: 'Blue Hour' },
    { name: 'Central Park — Bow Bridge', type: 'Park', time: 'Morning' },
  ]},
  'san-francisco': { name: 'San Francisco', state: 'CA', country: 'USA', blurb: 'Golden Gate fog, Alamo Square light, and rolling coastal hills minutes from downtown.', tags: ['Fog', 'Coast', 'Urban'], spots: [
    { name: 'Battery Spencer', type: 'Viewpoint', time: 'Sunrise' },
    { name: 'Alamo Square', type: 'Architecture', time: 'Golden Hour' },
    { name: 'Baker Beach', type: 'Coastal', time: 'Sunset' },
    { name: 'Twin Peaks', type: 'Viewpoint', time: 'Blue Hour' },
  ]},
  seattle: { name: 'Seattle', state: 'WA', country: 'USA', blurb: 'Moody marine layer, Puget Sound boats, and Olympic + Rainier views on every clear day.', tags: ['Mood', 'Mountain', 'Water'], spots: [
    { name: 'Kerry Park', type: 'Viewpoint', time: 'Blue Hour' },
    { name: 'Discovery Park Lighthouse', type: 'Coastal', time: 'Sunset' },
    { name: 'Pike Place Market', type: 'Urban', time: 'Morning' },
    { name: 'Snoqualmie Falls', type: 'Waterfall', time: 'Mid Morning' },
  ]},
};

export async function generateStaticParams() {
  return Object.keys(cities).map((slug) => ({ city: slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city } = await params;
  const d = cities[city.toLowerCase()];
  if (!d) return { title: 'City not found', robots: { index: false, follow: false } };
  const title = `Best photo spots in ${d.name}`;
  const desc = `${d.blurb} Discover ${d.name}’s best sunrise, golden hour, astro, and blue hour locations on LumaScout.`;
  return {
    title,
    description: desc,
    alternates: { canonical: `https://lumascout.app/spots/${city.toLowerCase()}` },
    openGraph: { title, description: desc, url: `https://lumascout.app/spots/${city.toLowerCase()}` },
  };
}

export default async function CitySpotsPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const d = cities[city.toLowerCase()];
  if (!d) return notFound();

  return (
    <>
      <div className="relative overflow-hidden border-b border-border bg-bg grain">
        <div className="pointer-events-none absolute inset-0 bg-radial-spot" aria-hidden />
        <div className="mx-auto max-w-5xl px-6 pt-36 pb-16 lg:pt-44">
          <Badge tone="brand"><MapPin size={12} /> {d.state ? `${d.state} · ` : ''}{d.country}</Badge>
          <h1 className="mt-6 font-display text-5xl md:text-6xl lg:text-7xl tracking-tightest leading-[1.05]">
            Best photo spots in <span className="text-brand">{d.name}.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">{d.blurb}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {d.tags.map((t) => (
              <span key={t} className="text-[11px] uppercase tracking-widest text-ink-muted border border-border rounded-full px-3 py-1">{t}</span>
            ))}
          </div>
          <div className="mt-8 flex gap-3">
            <LinkButton href="/register">Save spots free</LinkButton>
            <LinkButton href="/marketplace" variant="outline">Shop location packs</LinkButton>
          </div>
        </div>
      </div>

      <section className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
          {d.spots.map((s) => {
            const Icon = s.time.toLowerCase().includes('astro') ? Moon :
                         s.time.toLowerCase().includes('sunrise') ? Sunrise : Sparkles;
            return (
              <Card key={s.name} className="hover:border-strong transition-colors">
                <div className="flex items-start gap-4">
                  <span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-bg text-brand shrink-0"><Icon size={18} /></span>
                  <div className="flex-1">
                    <p className="font-semibold text-ink">{s.name}</p>
                    <p className="mt-1 text-sm text-ink-muted">{s.type} · Best at <span className="text-ink">{s.time}</span></p>
                  </div>
                  <Camera size={16} className="text-ink-dim" />
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="border-t border-border bg-surface-1">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <h2 className="font-display text-3xl md:text-4xl tracking-tightest">Plan your {d.name} shoot.</h2>
          <p className="mt-3 text-ink-muted">Map planner, astronomy overlays, condition tags, and community updates — on iOS, Android, and the web.</p>
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
