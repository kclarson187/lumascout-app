import { LinkButton } from '@/components/ui/button';
import { Section, Badge, Card } from '@/components/ui/primitives';
import { Camera, Compass, Map, Zap, Store, MessageSquareText, Users, Shield, Star, ArrowRight, Sparkles, Crown, Check } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Find incredible photo locations. Grow your photography business.',
  description:
    'LumaScout is the network for photographers. Map-first discovery, creator marketplace, referrals, and community for serious image-makers.',
};

// ---------------------------------------------------------------------------
// Home page — 7 cinematic sections matching the brief
// ---------------------------------------------------------------------------
export default function HomePage() {
  return (
    <>
      {/* 1. HERO */}
      <section className="relative overflow-hidden bg-bg grain">
        <div className="pointer-events-none absolute inset-0 bg-radial-spot" aria-hidden />
        <div className="mx-auto flex max-w-7xl flex-col items-center px-6 pt-36 pb-24 lg:px-8 lg:pt-48 lg:pb-32">
          <Badge tone="brand">New · Mentorship V1 — Find a mentor in 30 seconds</Badge>
          <h1 className="mt-8 text-center font-display text-5xl leading-[1.04] tracking-tightest text-ink md:text-7xl lg:text-[88px] max-w-4xl animate-slide-up">
            Find incredible photo locations.<br />
            <span className="text-brand">Grow</span> your photography business.
          </h1>
          <p className="mt-6 max-w-2xl text-center text-lg text-ink-muted md:text-xl animate-fade-in">
            Discover sunrise spots, blooming fields, hidden gems, and storm-chase routes.
            Sell packs, apply to gigs, and collaborate with the best image-makers — all in one place.
          </p>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row animate-fade-in">
            <LinkButton href="/register" size="lg">
              Join free <ArrowRight size={16} />
            </LinkButton>
            <LinkButton href="/map" variant="outline" size="lg">
              Open the map planner
            </LinkButton>
          </div>
          <p className="mt-5 text-xs text-ink-dim">Free forever. No credit card. Available on iOS, Android, and the web.</p>
        </div>

        {/* Device mockups band */}
        <div className="relative mx-auto max-w-6xl px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl border border-border bg-surface-1 shadow-glass">
            <div className="aspect-[16/9] w-full bg-[linear-gradient(135deg,#0B0B0E,#1A1206_60%,#2B1A08)] grid place-items-center">
              <div className="flex items-center gap-4 text-ink-muted">
                <Map size={56} strokeWidth={1} />
                <div className="text-left">
                  <p className="font-display text-2xl text-ink">Map planner · Preview</p>
                  <p className="mt-1 text-sm">Real location data, astronomy overlays, condition tags.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. TRUSTED BY */}
      <section className="py-20 lg:py-24 border-y border-border bg-surface-1">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <p className="text-center text-[11px] uppercase tracking-widest text-ink-dim">
            Trusted by 12,000+ photographers across 80+ countries
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-12 gap-y-6 opacity-70">
            {['Canon', 'Sony', 'Nikon', 'Fujifilm', 'DJI', 'Peak Design', 'Adobe'].map((b) => (
              <span key={b} className="font-display text-xl tracking-tighter text-ink-muted">{b}</span>
            ))}
          </div>
        </div>
      </section>

      {/* 3. EXPLORE LIVE MAP */}
      <Section
        eyebrow="Explore"
        title={<>The world’s best photo locations,<br/> all on one map.</>}
        kicker="Filter by season, golden hour, weather, crowd density, and condition tags. Save and plan shoots from your desktop or phone."
      >
        <div className="grid gap-6 md:grid-cols-3">
          {[{
            icon: Compass,
            title: 'Smart discovery',
            body: 'Quality-ranked spots with live freshness, crowd intel, and condition signals from the community.',
          },{
            icon: Sparkles,
            title: 'Astronomy overlays',
            body: 'Golden hour, blue hour, moonrise, Milky Way core visibility — calculated per location, per date.',
          },{
            icon: Camera,
            title: 'Premium photo gallery',
            body: 'Every spot is backed by community uploads, verified covers, and season-tagged imagery.',
          }].map(({ icon: Icon, title, body }) => (
            <Card key={title} className="group relative overflow-hidden hover:border-strong transition-colors">
              <Icon size={22} className="text-brand" />
              <h3 className="mt-5 font-display text-2xl tracking-tighter text-ink">{title}</h3>
              <p className="mt-3 text-sm text-ink-muted leading-relaxed">{body}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* 4. MARKETPLACE */}
      <section className="relative overflow-hidden border-t border-border bg-gradient-to-b from-bg via-[#0D0907] to-bg">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32 grid gap-14 lg:grid-cols-12 items-center">
          <div className="lg:col-span-5">
            <p className="text-[11px] uppercase tracking-widest text-brand font-semibold">Creator economy</p>
            <h2 className="mt-3 font-display text-4xl md:text-5xl lg:text-6xl tracking-tightest leading-[1.05]">
              Sell location packs. Keep <span className="text-brand">85%</span>.
            </h2>
            <p className="mt-5 text-lg text-ink-muted">
              Launch your own marketplace store. Package your best spots, mentorship sessions, presets, or guides. We handle Stripe, payouts, and taxes — you keep 85%.
            </p>
            <ul className="mt-8 space-y-3">
              {[
                'Instant Stripe Express onboarding',
                'Split payments + daily payouts',
                'Refund protection + dispute handling',
                'Featured placement for top creators',
              ].map((x) => (
                <li key={x} className="flex items-start gap-3 text-sm text-ink">
                  <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-brand-50 text-brand"><Check size={12} /></span>
                  {x}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex gap-3">
              <LinkButton href="/marketplace">Browse marketplace</LinkButton>
              <LinkButton href="/creators" variant="outline">Become a creator</LinkButton>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="grid grid-cols-2 gap-4">
              {[
                { t: 'Patagonia Winter · Pack', p: '$49', rating: '4.9', by: 'Alex R.' },
                { t: 'Milky Way Masterclass', p: '$89', rating: '5.0', by: 'Kai M.' },
                { t: 'NYC Rooftop Guide', p: '$29', rating: '4.8', by: 'Juno L.' },
                { t: 'Iceland 7-day route', p: '$79', rating: '4.9', by: 'Sasha P.' },
              ].map((x, i) => (
                <div key={i} className="group rounded-2xl border border-border bg-surface-1 p-5 transition-all hover:border-strong hover:-translate-y-0.5">
                  <div className="aspect-[4/3] rounded-xl bg-[linear-gradient(135deg,#2D1B08,#3B2412)] grid place-items-center">
                    <Camera size={28} className="text-ink-dim" />
                  </div>
                  <div className="mt-4 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-ink">{x.t}</p>
                      <p className="mt-1 text-xs text-ink-muted">by {x.by}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-brand">{x.p}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted"><Star size={10} className="fill-brand text-brand" />{x.rating}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 5. COMMUNITY + MESSAGING + REFERRALS */}
      <Section
        eyebrow="Community"
        title={<>A network that actually helps you book work.</>}
        kicker="Follow photographers you love. DM collaborators. Apply to paid gigs in your city. Build trust through verified uploads and reviews."
      >
        <div className="grid gap-6 md:grid-cols-3">
          {[{
            icon: Users, title: 'Network & follows',
            body: 'Who-viewed-your-profile, follower growth, trust scoring, and discovery feeds tuned for your specialties.',
          },{
            icon: MessageSquareText, title: 'DMs + message requests',
            body: 'High-signal messaging with request filtering, quiet hours, and spam protection.',
          },{
            icon: Zap, title: 'Referral marketplace',
            body: 'Post gigs, apply to shoots, accept collaborators. Payouts handled by Stripe Connect.',
          }].map(({ icon: Icon, title, body }) => (
            <Card key={title} className="hover:border-strong transition-colors">
              <Icon size={22} className="text-brand" />
              <h3 className="mt-5 font-display text-2xl tracking-tighter text-ink">{title}</h3>
              <p className="mt-3 text-sm text-ink-muted leading-relaxed">{body}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* 6. PRICING PREVIEW */}
      <section className="border-y border-border bg-surface-1">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <p className="text-[11px] uppercase tracking-widest text-brand font-semibold">Pricing</p>
            <h2 className="mt-3 font-display text-4xl md:text-5xl lg:text-6xl tracking-tightest leading-[1.05]">Simple plans. Serious tools.</h2>
            <p className="mt-5 text-lg text-ink-muted">Start free. Upgrade when you want map filters, unlimited saves, analytics, or the marketplace.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {[
              { name: 'Free', price: '$0', desc: 'Get started in 30 seconds.', highlights: ['Up to 25 saves', 'Basic map', 'Community feed', 'Browse marketplace'], cta: 'Create account', variant: 'outline' as const, featured: false },
              { name: 'Pro', price: '$9', desc: 'Built for working photographers.', highlights: ['Unlimited saves', 'Advanced filters + astronomy', 'Who viewed your profile', 'DM priority + referrals', 'Creator analytics'], cta: 'Start Pro trial', variant: 'primary' as const, featured: true, badge: 'Most popular' },
              { name: 'Elite', price: '$29', desc: 'Full creator economy + perks.', highlights: ['Everything in Pro', 'Marketplace seller store', 'Featured creator badge', 'Priority moderation + support', 'Early access to new tools'], cta: 'Go Elite', variant: 'outline' as const, featured: false },
            ].map((p) => (
              <div
                key={p.name}
                className={`relative rounded-2xl border p-7 transition-all ${p.featured ? 'border-brand bg-bg shadow-lift' : 'border-border bg-bg hover:border-strong'}`}
              >
                {p.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand text-black text-[10px] font-semibold uppercase tracking-widest px-3 py-1">
                    {p.badge}
                  </span>
                )}
                <h3 className="font-display text-3xl text-ink">{p.name}</h3>
                <p className="mt-1 text-sm text-ink-muted">{p.desc}</p>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="font-display text-5xl tracking-tightest text-ink">{p.price}</span>
                  <span className="text-sm text-ink-muted">/ month</span>
                </div>
                <ul className="mt-6 space-y-2">
                  {p.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2 text-sm text-ink">
                      <Check size={14} className="mt-0.5 text-brand shrink-0" />
                      {h}
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <LinkButton href="/pricing" variant={p.variant} className="w-full justify-center">{p.cta}</LinkButton>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-xs text-ink-dim">Billed monthly or annually · Cancel anytime · Powered by Stripe</p>
        </div>
      </section>

      {/* 7. FINAL CTA */}
      <section className="relative overflow-hidden bg-bg grain">
        <div className="pointer-events-none absolute inset-0 bg-radial-spot" aria-hidden />
        <div className="mx-auto max-w-4xl px-6 py-28 lg:py-36 text-center">
          <Crown size={36} className="mx-auto text-brand" />
          <h2 className="mt-6 font-display text-4xl md:text-6xl lg:text-7xl tracking-tightest leading-[1.05]">
            Your next incredible shot<br /><span className="text-brand">is out there.</span>
          </h2>
          <p className="mt-6 text-lg text-ink-muted">Join the photographers shooting better, getting booked, and building real creator income on LumaScout.</p>
          <div className="mt-10 flex justify-center gap-3">
            <LinkButton href="/register" size="lg">Join free <ArrowRight size={16} /></LinkButton>
            <LinkButton href="/pricing" variant="outline" size="lg">See pricing</LinkButton>
          </div>
          <p className="mt-5 text-xs text-ink-dim">
            Already on the app? <Link href="/login" className="text-ink hover:text-brand">Sign in</Link>
          </p>
        </div>
      </section>
    </>
  );
}
