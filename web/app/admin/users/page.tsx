import { apiTry } from '@/lib/api';
import { DashboardHeader } from '@/components/dashboard-parts';
import { UsersClient } from './_client';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const sp = await searchParams;
  const q = sp?.q || '';
  const filter = sp?.filter || 'all';
  const qs = new URLSearchParams({ limit: '100' });
  if (q) qs.set('q', q);
  if (filter && filter !== 'all') qs.set('filter', filter);

  const data = await apiTry<any>(`/api/admin/users?${qs.toString()}`, { items: [] }, { revalidate: 0 });
  const users: any[] = Array.isArray(data) ? data : data?.items || [];

  return (
    <>
      <DashboardHeader
        eyebrow="Admin"
        title="User management"
        kicker="Search users, change roles, verify creators, comp plans, and suspend abusers."
      />
      <div className="px-6 lg:px-10 pb-16">
        <UsersClient initialUsers={users} initialQ={q} initialFilter={filter} />
      </div>
    </>
  );
}
