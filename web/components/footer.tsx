'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Instagram, Youtube, Twitter, Apple } from 'lucide-react';

export function Footer() {
  const pathname = usePathname();
  const y = new Date().getFullYear();

  // Hide the public marketing footer in logged-in app shell contexts.
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/admin') || pathname.startsWith('/seller')) {
    return null;
  }

  return (
    <footer className="border-t border-border bg-bg">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-6">
          <div className="col-span-2">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-gradient">
                <span className="text-black font-bold text-sm">L</span>
              </span>
              <span className="font-display text-xl tracking-tighter">LumaScout</span>
            </div>
            <p className="mt-4 max-w-xs text-sm text-ink-muted">
              The network for photographers. Find incredible photo locations, grow your
              business, connect with the community.
            </p>
            <div className="mt-6 flex gap-3 text-ink-muted">
              <a href="https://instagram.com/lumascout" aria-label="Instagram" className="hover:text-ink"><Instagram size={18} /></a>
              <a href="https://youtube.com/@lumascout" aria-label="YouTube" className="hover:text-ink"><Youtube size={18} /></a>
              <a href="https://twitter.com/lumascout" aria-label="Twitter" className="hover:text-ink"><Twitter size={18} /></a>
              <a href="https://apps.apple.com/app/lumascout" aria-label="App Store" className="hover:text-ink"><Apple size={18} /></a>
            </div>
          </div>

          <FooterCol title="Product" links={[
            { href: '/map', label: 'Map planner' },
            { href: '/marketplace', label: 'Marketplace' },
            { href: '/community', label: 'Community' },
            { href: '/mentors', label: 'Mentorship' },
            { href: '/pricing', label: 'Pricing' },
          ]} />
          <FooterCol title="Explore" links={[
            { href: '/spots/austin', label: 'Austin' },
            { href: '/spots/los-angeles', label: 'Los Angeles' },
            { href: '/spots/new-york', label: 'New York' },
            { href: '/spots/san-francisco', label: 'San Francisco' },
            { href: '/spots/seattle', label: 'Seattle' },
          ]} />
          <FooterCol title="Company" links={[
            { href: '/about', label: 'About' },
            { href: '/creators', label: 'For creators' },
            { href: '/careers', label: 'Careers' },
            { href: '/press', label: 'Press' },
            { href: 'mailto:support@lumascout.app', label: 'Contact' },
          ]} />
          <FooterCol title="Legal" links={[
            { href: '/privacy', label: 'Privacy' },
            { href: '/terms', label: 'Terms' },
            { href: '/marketplace-terms', label: 'Seller terms' },
            { href: '/community-guidelines', label: 'Community' },
            { href: '/refund-policy', label: 'Refunds' },
          ]} />
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-border pt-6 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-ink-dim">© {y} LumaScout Inc. Crafted for photographers.</p>
          <p className="text-xs text-ink-dim">Available on iOS, Android, and the web.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-ink-dim">{title}</h3>
      <ul className="mt-4 space-y-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href as any} className="text-sm text-ink-muted hover:text-ink transition-colors">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
