'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LinkButton } from '@/components/ui/button';
import { Section, Badge } from '@/components/ui/primitives';
import { Check, Crown, Star, Sparkles, ShieldCheck } from 'lucide-react';

type Plan = {
  name: string;
  monthly: number;
  yearly: number;
  tagline: string;
  featured?: boolean;
  badge?: string;
  features: string[];
  cta: string;
  href: string;
};

const plans: Plan[] = [
  {
    name: 'Free',
    monthly: 0, yearly: 0,
    tagline: 'Everything you need to start scouting.',
    features: [
      'Up to 25 saved spots',
      'Basic map + discovery feed',
      'Community access',
      'Browse marketplace',
      'iOS, Android, and web',
    ],
    cta: 'Create account', href: '/register',
  },
  {
    name: 'Pro',
    monthly: 9, yearly: 84,
    tagline: 'Built for working photographers.',
    featured: true, badge: 'Most popular',
    features: [
      'Unlimited saved spots + collections',
      'Advanced filters + astronomy overlays',
      'Who-viewed-your-profile',
      'DM priority + referral marketplace',
      'Creator analytics + weekly insights',
      'Verified profile badge',
    ],
    cta: 'Start Pro', href: '/register?plan=pro',
  },
  {
    name: 'Elite',
    monthly: 29, yearly: 276,
    tagline: 'Full creator economy + priority perks.',
    features: [
      'Everything in Pro',
      'Marketplace seller storefront (keep 85%)',
      'Featured creator badge',
      'Priority moderation + support',
      'Early access to new tools',
      'Mentorship platform access',
      'Custom profile theming',
    ],
    cta: 'Go Elite', href: '/register?plan=elite',
  },
];

const compareRows = [
  { label: 'Saved spots', values: ['25', 'Unlimited', 'Unlimited'] },
  { label: 'Map filters + astronomy', values: ['Basic', 'Full', 'Full'] },
  { label: 'Who viewed your profile', values: ['—', 'Yes', 'Yes'] },
  { label: 'DM priority + requests', values: ['—', 'Yes', 'Yes'] },
  { label: 'Referral marketplace (apply to gigs)', values: ['—', 'Yes', 'Yes'] },
  { label: 'Marketplace storefront', values: ['—', '—', 'Yes'] },
  { label: 'Creator analytics', values: ['—', 'Yes', 'Yes + cohort'] },
  { label: 'Featured creator badge', values: ['—', '—', 'Yes'] },
  { label: 'Platform support', values: ['Email', 'Email', 'Priority'] },
];

const faqs = [
  { q: 'Do I need a credit card to start?', a: 'No. Free is free forever. Add payment only when you upgrade.' },
  { q: 'Can I switch or cancel anytime?', a: 'Yes. Upgrade or cancel instantly from Settings → Membership. No lock-ins.' },
  { q: 'How do marketplace payouts work?', a: 'Stripe Express. You keep 85% of every sale, daily auto-payouts once onboarded.' },
  { q: 'Do you do student or pro discounts?', a: 'Reach out to support@lumascout.app with your student ID or press credentials.' },
  { q: 'Is there a yearly plan?', a: 'Yes — annual plans save 22%. Toggle above.' },
  { q: 'Does LumaScout work offline?', a: 'The mobile app caches saved spots + collections for offline access in the field.' },
];

export default function PricingClient() {
  const [annual, setAnnual] = useState(true);
  const savings = annual ? '· Save 22%' : '';

  return (
    <>
      {/* Head */}
      <div className="relative overflow-hidden border-b border-border bg-bg grain">
        <div className="pointer-events-none absolute inset-0 bg-radial-spot" aria-hidden />
        <div className="mx-auto max-w-5xl px-6 pt-36 pb-16 text-center lg:pt-44">
          <Badge tone="brand">Pricing</Badge>
          <h1 className="mt-6 font-display text-5xl md:text-6xl lg:text-7xl tracking-tightest leading-[1.05]">
            Simple plans. Serious tools.
          </h1>
          <p className="mt-5 text-lg text-ink-muted">Start free. Upgrade when you want map filters, unlimited saves, analytics, or the marketplace.</p>

          <div className="mt-10 inline-flex items-center gap-1 rounded-full border border-border bg-surface-1 p-1">
            <button
              onClick={() => setAnnual(false)}
              className={`px-4 py-2 text-sm rounded-full transition ${!annual ? 'bg-brand text-black font-semibold' : 'text-ink-muted hover:text-ink'}`}
            >Monthly</button>
            <button
              onClick={() => setAnnual(true)}
              className={`px-4 py-2 text-sm rounded-full transition ${annual ? 'bg-brand text-black font-semibold' : 'text-ink-muted hover:text-ink'}`}
            >Annual {savings}</button>
          </div>
        </div>
      </div>

      {/* Plans */}
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((p) => {
            const display = annual ? p.yearly : p.monthly;
            return (
              <div
                key={p.name}
                className={`relative rounded-2xl border p-7 transition-all ${p.featured ? 'border-brand bg-surface-1 shadow-lift' : 'border-border bg-surface-1 hover:border-strong'}`}
              >
                {p.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand text-black text-[10px] font-semibold uppercase tracking-widest px-3 py-1">
                    {p.badge}
                  </span>
                )}
                <h3 className="font-display text-3xl text-ink">{p.name}</h3>
                <p className="mt-1 text-sm text-ink-muted">{p.tagline}</p>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="font-display text-5xl tracking-tightest text-ink">${display}</span>
                  <span className="text-sm text-ink-muted">/ {annual ? 'year' : 'month'}</span>
                </div>
                <ul className="mt-6 space-y-2">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-ink">
                      <Check size={14} className="mt-0.5 text-brand shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <LinkButton
                    href={p.href}
                    variant={p.featured ? 'primary' : 'outline'}
                    className="w-full justify-center"
                  >
                    {p.cta}
                  </LinkButton>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-center text-xs text-ink-dim">All prices USD · Cancel anytime · Powered by Stripe</p>
      </div>

      {/* Compare */}
      <Section eyebrow="Compare" title="Every plan, side by side." kicker="Pick the tier that fits how you shoot.">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface-1">
          <div className="grid grid-cols-4 border-b border-border bg-surface-2">
            <div className="col-span-1 px-5 py-4 text-xs uppercase tracking-widest text-ink-dim">Feature</div>
            {plans.map((p) => (
              <div key={p.name} className="px-5 py-4 text-center text-sm font-semibold text-ink">
                {p.name}
              </div>
            ))}
          </div>
          {compareRows.map((row, i) => (
            <div
              key={row.label}
              className={`grid grid-cols-4 text-sm ${i % 2 === 0 ? 'bg-transparent' : 'bg-surface-2/40'}`}
            >
              <div className="col-span-1 px-5 py-4 text-ink-muted">{row.label}</div>
              {row.values.map((v, j) => (
                <div key={j} className="px-5 py-4 text-center text-ink">
                  {v === 'Yes' ? <Check size={16} className="mx-auto text-brand" /> : v === '—' ? <span className="text-ink-dim">—</span> : v}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Section>

      {/* Trust band */}
      <section className="border-y border-border bg-surface-1">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8 grid gap-6 md:grid-cols-3">
          {[
            { icon: ShieldCheck, t: 'Secure by default', d: 'Stripe billing, httpOnly auth, bank-grade encryption in transit and at rest.' },
            { icon: Star, t: '4.9 star average', d: 'Loved by 12,000+ photographers across iOS, Android, and web.' },
            { icon: Sparkles, t: 'Fast-shipping team', d: 'Every month we ship new growth tools, creator features, and polish.' },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="flex items-start gap-4">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-bg text-brand shrink-0">
                <Icon size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">{t}</p>
                <p className="mt-1 text-sm text-ink-muted">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <Section eyebrow="FAQ" title="Questions, answered.">
        <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
          {faqs.map((f) => (
            <div key={f.q} className="rounded-2xl border border-border bg-surface-1 p-6">
              <p className="text-sm font-semibold text-ink">{f.q}</p>
              <p className="mt-2 text-sm text-ink-muted leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Final CTA */}
      <section className="bg-bg">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <Crown size={28} className="mx-auto text-brand" />
          <h2 className="mt-5 font-display text-4xl md:text-5xl tracking-tightest">
            Ready to shoot better?
          </h2>
          <p className="mt-4 text-ink-muted">Join free. Upgrade when you’re ready. Cancel anytime.</p>
          <div className="mt-8 flex justify-center gap-3">
            <LinkButton href="/register" size="lg">Join free</LinkButton>
            <LinkButton href="/marketplace" variant="outline" size="lg">Browse marketplace</LinkButton>
          </div>
          <p className="mt-5 text-xs text-ink-dim">Already have an account? <Link href="/login" className="text-ink hover:text-brand">Sign in</Link></p>
        </div>
      </section>
    </>
  );
}
