'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { gotoStripeOnboarding, gotoStripeDashboard } from '../_actions';
import { CreditCard, ShieldCheck, ExternalLink, RefreshCw, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';

function dollars(cents: number | undefined, currency = 'USD'): string {
  const c = cents ?? 0;
  const s = (c / 100).toFixed(c % 100 === 0 ? 0 : 2);
  return currency === 'USD' ? `$${s}` : `${s} ${currency}`;
}

const STATUS_COPY: Record<string, { title: string; body: string; tone: 'success' | 'warn' | 'neutral' }> = {
  active: {
    title: 'Payouts active',
    body: 'Your Stripe-connected account is fully onboarded. Weekly payouts go to your bank automatically.',
    tone: 'success',
  },
  onboarding: {
    title: 'Finish onboarding',
    body: 'Complete a few more details with Stripe to start receiving payouts.',
    tone: 'warn',
  },
  pending: {
    title: 'Under review',
    body: 'Stripe is reviewing your submitted information. This usually takes a few minutes.',
    tone: 'warn',
  },
  restricted: {
    title: 'Account needs attention',
    body: 'Stripe requires additional information to continue processing payouts. Open your Express dashboard.',
    tone: 'warn',
  },
  disconnected: {
    title: 'Connect Stripe',
    body: 'One-time 3-minute onboarding. Get verified. Start selling. LumaScout never touches your bank info.',
    tone: 'neutral',
  },
};

export function PayoutsClient({ connect, payouts, returnedFromStripe }: { connect: any; payouts: any; returnedFromStripe?: boolean }) {
  const router = useRouter();
  const status = (connect?.status || 'disconnected').toLowerCase();
  const info = STATUS_COPY[status] || STATUS_COPY.disconnected;
  const [onboardingPending, startOnboarding] = useTransition();
  const [dashPending, startDash] = useTransition();

  const items: any[] = Array.isArray(payouts?.items) ? payouts.items : [];

  return (
    <>
      {returnedFromStripe && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-success/30 bg-success/5 text-success px-5 py-4">
          <CheckCircle size={16} />
          <p className="text-sm"><span className="font-semibold">Welcome back from Stripe.</span> Your status is being refreshed below.</p>
        </div>
      )}

      {/* Status card */}
      <section className={`rounded-2xl border p-6 ${
        info.tone === 'success' ? 'border-success/30 bg-success/5' :
        info.tone === 'warn' ? 'border-brand/30 bg-brand/5' :
        'border-border bg-surface-1'
      }`}>
        <div className="flex flex-wrap items-start gap-5">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl border ${
            info.tone === 'success' ? 'border-success/30 bg-success/10 text-success' :
            info.tone === 'warn' ? 'border-brand/30 bg-brand/10 text-brand' :
            'border-border bg-bg text-ink-muted'
          }`}>
            {info.tone === 'success' ? <ShieldCheck size={20} /> : <CreditCard size={20} />}
          </span>
          <div className="flex-1 min-w-[280px]">
            <p className="text-[10px] uppercase tracking-widest text-ink-dim font-semibold">Stripe Connect · {status}</p>
            <h2 className="mt-1 font-display text-3xl tracking-tightest">{info.title}</h2>
            <p className="mt-2 text-sm text-ink-muted max-w-xl">{info.body}</p>

            <div className="mt-5 flex flex-wrap gap-2">
              {status === 'disconnected' || status === 'onboarding' || status === 'pending' || status === 'restricted' ? (
                <form action={async () => { await gotoStripeOnboarding(); }}>
                  <button type="submit" disabled={onboardingPending} onClick={() => startOnboarding(() => {})} className="inline-flex items-center gap-2 rounded-full bg-brand text-black font-semibold px-5 py-3 hover:bg-brand-600 disabled:opacity-60">
                    {onboardingPending ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                    {status === 'disconnected' ? 'Start onboarding' : 'Resume onboarding'}
                  </button>
                </form>
              ) : null}
              {status !== 'disconnected' && (
                <form action={async () => { await gotoStripeDashboard(); }}>
                  <button type="submit" disabled={dashPending} onClick={() => startDash(() => {})} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 text-ink px-5 py-3 hover:border-strong disabled:opacity-60">
                    {dashPending ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />} Open Stripe dashboard
                  </button>
                </form>
              )}
              <button onClick={() => router.refresh()} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 text-ink-muted hover:text-ink px-5 py-3">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Balances */}
      {(payouts?.connected || status === 'active') && (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface-1 p-5">
            <p className="text-[10px] uppercase tracking-widest text-ink-dim">Available balance</p>
            <p className="mt-2 font-display text-4xl tracking-tightest text-success">{dollars(payouts.available_cents)}</p>
            <p className="mt-1 text-xs text-ink-muted">Ready to pay out on your next schedule.</p>
          </div>
          <div className="rounded-2xl border border-border bg-surface-1 p-5">
            <p className="text-[10px] uppercase tracking-widest text-ink-dim">Pending balance</p>
            <p className="mt-2 font-display text-4xl tracking-tightest">{dollars(payouts.pending_cents)}</p>
            <p className="mt-1 text-xs text-ink-muted">In transit from Stripe, typically 2-3 business days.</p>
          </div>
        </div>
      )}

      {/* Payout history */}
      <section className="mt-10 rounded-2xl border border-border bg-surface-1 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold flex items-center gap-2"><CreditCard size={14} className="text-ink-muted" /> Payout history</h2>
          <span className="text-xs text-ink-dim">{items.length} payouts</span>
        </div>
        {items.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-display text-xl tracking-tighter">No payouts yet.</p>
            <p className="mt-2 text-sm text-ink-muted">Once you earn your first sale, payouts will arrive here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 border-b border-border">
                <tr className="text-left text-[10px] uppercase tracking-widest text-ink-dim">
                  <th className="px-5 py-3 font-semibold">Date</th>
                  <th className="px-5 py-3 font-semibold">Arrival</th>
                  <th className="px-5 py-3 font-semibold">Method</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((p, i) => {
                  const created = p.created ? new Date(p.created * 1000) : null;
                  const arrival = p.arrival_date ? new Date(p.arrival_date * 1000) : null;
                  const paid = (p.status || '').toLowerCase() === 'paid';
                  return (
                    <tr key={p.id || i} className="hover:bg-surface-2 transition-colors">
                      <td className="px-5 py-3 text-ink-muted">{created ? created.toLocaleDateString() : '—'}</td>
                      <td className="px-5 py-3 text-ink-muted">{arrival ? arrival.toLocaleDateString() : '—'}</td>
                      <td className="px-5 py-3 text-ink-muted">{p.method || '—'}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-block text-[10px] uppercase tracking-widest rounded-full px-2 py-0.5 border ${paid ? 'border-success/30 text-success bg-success/5' : 'border-brand/30 text-brand bg-brand/5'}`}>{p.status || 'pending'}</span>
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-ink">{dollars(p.amount, p.currency || 'USD')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Troubleshooting */}
      <section className="mt-8 rounded-2xl border border-border bg-surface-1 p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-bg text-brand"><AlertTriangle size={16} /></span>
          <div>
            <h3 className="font-semibold text-ink">Having trouble?</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
              <li>• If onboarding shows errors, try opening the Stripe dashboard and completing the requested information.</li>
              <li>• Payouts are US-only for now. For international support, email <a href="mailto:support@lumascout.app" className="text-brand">support@lumascout.app</a>.</li>
              <li>• Tax documents (1099-K) are auto-generated by Stripe and delivered via your Express dashboard in late January.</li>
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
