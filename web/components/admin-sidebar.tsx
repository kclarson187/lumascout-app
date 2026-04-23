'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ShieldCheck, LayoutDashboard, MapPinned, Users, ShoppingBag,
  Flag, FileClock, MessageSquare, Menu, X, LogOut, User,
} from 'lucide-react';

type User = { name?: string; username?: string; avatar_url?: string; role?: string };

const items = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/spots', label: 'Spot moderation', icon: MapPinned },
  { href: '/admin/community', label: 'Community', icon: MessageSquare },
  { href: '/admin/marketplace', label: 'Marketplace', icon: ShoppingBag },
  { href: '/admin/reports', label: 'Reports', icon: Flag },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/audit-logs', label: 'Audit logs', icon: FileClock },
];

export function AdminSidebar({ user, pending = {} }: { user: User | null; pending?: Record<string, number> }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    try { await fetch('/session/logout', { method: 'POST' }); } catch {}
    router.replace('/login');
    router.refresh();
  }

  const role = (user?.role || '').toLowerCase();

  return (
    <>
      {/* Mobile topbar */}
      <div className="lg:hidden sticky top-0 z-40 flex items-center justify-between border-b border-border bg-bg/80 backdrop-blur px-4 py-3">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-danger/10 border border-danger/30"><ShieldCheck size={14} className="text-danger" /></span>
          <span className="font-display text-base tracking-tighter">Admin</span>
        </Link>
        <button aria-label="Open menu" onClick={() => setOpen(!open)} className="grid h-9 w-9 place-items-center rounded-md hover:bg-surface-2">
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-30 h-screen w-72 shrink-0 border-r border-border bg-bg/95 backdrop-blur transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex h-full flex-col">
          <div className="hidden lg:flex items-center gap-2 px-6 py-6">
            <Link href="/admin" className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-danger/10 border border-danger/30 shadow-lift">
                <ShieldCheck size={16} className="text-danger" />
              </span>
              <div className="leading-none">
                <p className="font-display text-lg tracking-tighter">LumaScout</p>
                <p className="text-[10px] uppercase tracking-widest text-danger font-semibold mt-1">Admin console</p>
              </div>
            </Link>
          </div>

          <div className="px-4 mt-2 lg:mt-0">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 p-3">
              <div
                className="h-10 w-10 shrink-0 rounded-full bg-surface-2 bg-center bg-cover"
                style={user?.avatar_url ? { backgroundImage: `url(${user.avatar_url})` } : undefined}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{user?.name || 'Admin'}</p>
                <p className="truncate text-xs text-ink-muted">@{user?.username || 'you'} · <span className="uppercase tracking-widest text-danger font-semibold">{role.replace('_', ' ')}</span></p>
              </div>
            </div>
          </div>

          <nav className="mt-6 flex-1 overflow-y-auto px-3" aria-label="Admin">
            <ul className="space-y-1">
              {items.map(({ href, label, icon: Icon, exact }) => {
                const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');
                const badge = pending[href];
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                        active ? 'bg-danger/10 text-danger' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
                      )}
                    >
                      <span className="flex items-center gap-3"><Icon size={16} />{label}</span>
                      {typeof badge === 'number' && badge > 0 && (
                        <span className={cn('shrink-0 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full text-[10px] font-semibold px-1.5',
                          active ? 'bg-danger text-black' : 'bg-surface-2 text-ink')}
                        >{badge}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="border-t border-border p-3 space-y-1">
            <Link href="/dashboard" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink">
              <User size={16} /> My dashboard
            </Link>
            <button onClick={logout} className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink">
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      </aside>

      {open && <div onClick={() => setOpen(false)} className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden" />}
    </>
  );
}
