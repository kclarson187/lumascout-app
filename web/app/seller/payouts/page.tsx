import { apiTry } from '@/lib/api';
import { DashboardHeader } from '@/components/dashboard-parts';
import { PayoutsClient } from './_client';

export const dynamic = 'force-dynamic';

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ connect?: string }> }) {
  const sp = await searchParams;
  const returnedFromStripe = sp?.connect === 'return' || sp?.connect === 'refresh';

  const [connect, payouts] = await Promise.all([
    apiTry<any>('/api/me/seller/connect-status', { status: 'disconnected', stripe_ready: false }, { revalidate: 0 }),
    apiTry<any>('/api/me/seller/payouts?limit=50', { items: [], pending_cents: 0, available_cents: 0, connected: false }, { revalidate: 0 }),
  ]);

  return (
    <>
      <DashboardHeader
        eyebrow="Payouts"
        title="Payouts & banking"
        kicker="Stripe Connect handles onboarding, taxes, 1099s, and weekly bank payouts. You keep 85% of every sale."
      />
      <div className="px-6 lg:px-10 pb-16">
        <PayoutsClient connect={connect} payouts={payouts} returnedFromStripe={returnedFromStripe} />
      </div>
    </>
  );
}
