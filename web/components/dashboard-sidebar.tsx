'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Bookmark, Folder, Users, Eye, MessageSquareText,
  Map as MapIcon, Menu, X, LogOut, User, Settings, Sparkles,
} from 'lucide-react';

type User = { name?: string; username?: string; avatar_url?: string; plan?: string };

const items = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/feed', label: 'Community feed', icon: Sparkles },
  { href: '/dashboard/saved', label: 'Saved spots', icon: Bookmark },
  { href: '/dashboard/collections', label: 'Collections', icon: Folder },
  { href: '/dashboard/map', label: 'Map planner', icon: MapIcon },
  { href: '/dashboard/messages', label: 'Messages', icon: MessageSquareText },
  { href: '/dashboard/viewers', label: 'Viewers', icon: Eye },
  { href: '/dashboard/followers', label: 'Followers', icon: Users },
];

export function DashboardSidebar({ user }: { user: User | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    try { await fetch('/session/logout', { method: 'POST' }); } catch {}
    router.replace('/login');
    router.refresh();
  }

  const plan = (user?.plan || 'free').toLowerCase();

  return (
    <>
      {/* Mobile topbar */}
      <div className="lg:hidden sticky top-0 z-40 flex items-center justify-between border-b border-border bg-bg/80 backdrop-blur px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-gradient"><span className="text-black font-bold text-xs">L</span></span>
          <span className="font-display text-base tracking-tighter">Dashboard</span>
        </Link>
        <button aria-label="Open menu" onClick={() => setOpen(!open)} className="grid h-9 w-9 place-items-center rounded-md hover:bg-surface-2">
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Drawer on mobile, static rail on desktop */}
      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-30 h-screen w-72 shrink-0 border-r border-border bg-bg/95 backdrop-blur transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex h-full flex-col">
          <div className="hidden lg:flex items-center gap-2 px-6 py-6">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-gradient shadow-lift"><span className="text-black font-bold text-sm">L</span></span>
              <span className="font-display text-xl tracking-tighter">LumaScout</span>
            </Link>
          </div>

          {/* User card */}
          <div className="px-4 mt-2 lg:mt-0">
            <Link href={`/u/${user?.username || ''}`} className="group flex items-center gap-3 rounded-xl border border-border bg-surface-1 p-3 transition-colors hover:border-strong">
              <div
                className="h-10 w-10 shrink-0 rounded-full bg-surface-2 bg-center bg-cover"
                style={user?.avatar_url ? { backgroundImage: `url(${user.avatar_url})` } : undefined}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{user?.name || 'Photographer'}</p>
                <p className="truncate text-xs text-ink-muted">@{user?.username || 'you'} · <span className="uppercase tracking-widest text-brand">{plan}</span></p>
              </div>
            </Link>
          </div>

          {/* Nav */}
          <nav className="mt-6 flex-1 overflow-y-auto px-3" aria-label="Dashboard">
            <ul className="space-y-1">
              {items.map(({ href, label, icon: Icon, exact }) => {
                const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                        active ? 'bg-brand-50 text-brand' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
                      )}
                    >
                      <Icon size={16} />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="border-t border-border p-3 space-y-1">
            <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink">
              <User size={16} /> Public site
            </Link>
            <Link href={`/u/${user?.username || ''}`} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink">
              <Settings size={16} /> My profile
            </Link>
            <button onClick={logout} className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink">
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Backdrop */}
      {open && <div onClick={() => setOpen(false)} className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden" />}
    </>
  );
}
