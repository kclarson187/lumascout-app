import { redirect } from 'next/navigation';

// The backend's Stripe Connect AccountLink uses `/me/seller?connect_return=1`
// (or `connect_refresh=1`) as redirect URLs — that path was designed for the
// mobile app. On the web, forward those returns into the Seller Payouts page
// so the creator sees a clear status update.
export default async function MeSellerBridge({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const query = new URLSearchParams();
  if (sp?.connect_return) query.set('connect', 'return');
  if (sp?.connect_refresh) query.set('connect', 'refresh');
  const qs = query.toString();
  redirect(qs ? `/seller/payouts?${qs}` : '/seller/payouts');
}
