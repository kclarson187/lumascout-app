import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { DashboardSidebar } from '@/components/dashboard-sidebar';

export const dynamic = 'force-dynamic';

async function getMe() {
  try {
    return await apiFetch<any>('/api/auth/me', { revalidate: 0 });
  } catch {
    return null;
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getMe();
  if (!user) redirect('/login?next=/dashboard');

  return (
    <div className="flex min-h-screen bg-bg">
      <DashboardSidebar user={user} />
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}
