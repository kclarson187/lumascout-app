import type { Metadata } from 'next';
import Link from 'next/link';
import { LinkButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { Camera, Users, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Photographers — Creators on LumaScout',
  description:
    'Discover photographers from around the world on LumaScout. Follow, message, and shop location packs from verified creators.',
  alternates: { canonical: 'https://lumascout.app/photographers' },
};

const featured = [
  { handle: 'alexr', name: 'Alex Rivera', city: 'Patagonia', specialties: ['Landscape', 'Cold'], verified: true },
  { handle: 'kaim', name: 'Kai Mirai', city: 'Tokyo', specialties: ['Astro', 'City'], verified: true },
  { handle: 'junol', name: 'Juno Lee', city: 'New York', specialties: ['Rooftop', 'Street'], verified: true },
  { handle: 'sashap', name: 'Sasha Park', city: 'Reykjavik', specialties: ['Route', 'Aurora'], verified: true },
  { handle: 'mayak', name: 'Maya Kaur', city: 'Mumbai', specialties: ['Portrait', 'Color'], verified: false },
  { handle: 'drewn', name: 'Drew Nakagawa', city: 'Denver', specialties: ['Storm', 'Weather'], verified: true },
];

export default function PhotographersPage() {
  return (
    <>
      <div className="relative overflow-hidden border-b border-border bg-bg grain">
        <div className="pointer-events-none absolute inset-0 bg-radial-spot" aria-hidden />
        <div className="mx-auto max-w-5xl px-6 pt-36 pb-16 text-center lg:pt-44">
          <Badge tone="brand">Creators</Badge>
          <h1 className="mt-6 font-display text-5xl md:text-6xl lg:text-7xl tracking-tightest leading-[1.05]">
            The world’s best photographers, <span className="text-brand">in one place.</span>
          </h1>
          <p className="mt-5 text-lg text-ink-muted">Follow, DM, and collaborate with verified creators across 80+ countries.</p>
          <div className="mt-8 flex justify-center gap-3">
            <LinkButton href="/register">Create your profile</LinkButton>
            <LinkButton href="/marketplace" variant="outline">Shop marketplace</LinkButton>
          </div>
        </div>
      </div>

      <section className="mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-20">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((c) => (
            <Link key={c.handle} href={`/u/${c.handle}`} className="group rounded-2xl border border-border bg-surface-1 p-6 transition-all hover:border-strong hover:-translate-y-0.5">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-xl bg-[linear-gradient(135deg,#1A1206,#2B1A08)] grid place-items-center">
                  <Camera size={20} className="text-ink-dim" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-ink">{c.name}</p>
                    {c.verified && <ShieldCheck size={14} className="text-brand" />}
                  </div>
                  <p className="text-xs text-ink-muted">@{c.handle} · {c.city}</p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {c.specialties.map((s) => (
                  <span key={s} className="text-[10px] uppercase tracking-widest text-ink-muted border border-border rounded-full px-2.5 py-1">{s}</span>
                ))}
              </div>
              <p className="mt-4 flex items-center gap-2 text-xs text-ink-dim"><Users size={12} /> View profile</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
