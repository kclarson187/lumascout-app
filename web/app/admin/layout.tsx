import { redirect } from 'next/navigation';
import { apiFetch, apiTry } from '@/lib/api';
import { AdminSidebar } from '@/components/admin-sidebar';

export const dynamic = 'force-dynamic';

async function getMe() {
  try { return await apiFetch<any>('/api/auth/me'); } catch { return null; }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getMe();
  if (!user) redirect('/login?next=/admin');
  const role = (user.role || '').toLowerCase();
  if (!['admin', 'super_admin'].includes(role)) redirect('/dashboard');

  // Fetch pending counters for sidebar badges.
  const pending = await apiTry<any>('/api/admin/pending', {}, { revalidate: 0 });
  const pendingMap: Record<string, number> = {
    '/admin/spots': pending?.pending_spot_uploads ?? pending?.pending_spots ?? 0,
    '/admin/marketplace': pending?.pending_marketplace ?? pending?.pending_products ?? 0,
    '/admin/reports': pending?.open_reports ?? pending?.pending_reports ?? 0,
    '/admin/community': pending?.pending_community ?? 0,
  };

  return (
    <div className="flex min-h-screen bg-bg">
      <AdminSidebar user={user} pending={pendingMap} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
