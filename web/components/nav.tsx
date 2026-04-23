'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Menu, X } from 'lucide-react';

const nav = [
  { href: '/map', label: 'Map' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/community', label: 'Community' },
  { href: '/pricing', label: 'Pricing' },
];

export function Nav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Hide the public marketing nav in logged-in app shell contexts.
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/admin') || pathname.startsWith('/seller')) {
    return null;
  }

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-colors duration-300',
        scrolled || open ? 'glass border-b border-border' : 'bg-transparent',
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-8">
        <Link href="/" className="group flex items-center gap-2" aria-label="LumaScout home">
          <span className="relative grid h-8 w-8 place-items-center rounded-lg bg-brand-gradient shadow-lift">
            <span className="text-black font-bold text-sm">L</span>
          </span>
          <span className="font-display text-xl tracking-tighter">LumaScout</span>
        </Link>

        <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'px-3 py-2 text-sm text-ink-muted hover:text-ink transition-colors rounded-md',
                  active && 'text-ink'
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          <Link
            href="/login"
            className="px-3 py-2 text-sm text-ink-muted hover:text-ink transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="px-4 py-2 text-sm font-semibold bg-brand text-black rounded-full hover:bg-brand-600 transition-colors"
          >
            Join free
          </Link>
        </div>

        <button
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="md:hidden grid h-10 w-10 place-items-center rounded-md text-ink hover:bg-surface-2"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-border px-6 pb-5 pt-2 space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block py-2.5 text-base text-ink-muted hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
          <div className="pt-3 flex items-center gap-2">
            <Link href="/login" onClick={() => setOpen(false)} className="flex-1 text-center py-2.5 text-sm border border-border rounded-full text-ink">
              Sign in
            </Link>
            <Link href="/register" onClick={() => setOpen(false)} className="flex-1 text-center py-2.5 text-sm bg-brand text-black rounded-full font-semibold">
              Join free
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
