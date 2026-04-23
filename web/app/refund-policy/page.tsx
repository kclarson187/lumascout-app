import type { Metadata } from 'next';
import { LegalShell } from '@/components/legal-shell';

export const metadata: Metadata = {
  title: 'Refund Policy',
  description: 'Subscription and marketplace refund policy for LumaScout.',
  alternates: { canonical: 'https://lumascout.app/refund-policy' },
};

export default function RefundPolicyPage() {
  return (
    <LegalShell eyebrow="Legal" title="Refund Policy" updated="April 2026">
      <h2>Subscriptions (Pro, Elite)</h2>
      <p>Subscription fees are non-refundable. You can cancel at any time from Settings → Membership and continue to enjoy paid features until the end of the current billing cycle. If you believe you were charged in error, contact <a href="mailto:support@lumascout.app">support@lumascout.app</a> within 14 days — we’ll make it right on a case-by-case basis.</p>
      <h2>Annual plans</h2>
      <p>If you cancel an annual plan within 7 days of purchase and have not materially used paid features, we’ll issue a prorated refund upon request.</p>
      <h2>Marketplace (digital goods)</h2>
      <ul>
        <li>You may request a refund within <strong>7 days</strong> of purchase if the item is materially different from its description or non-functional.</li>
        <li>Items delivered as described are generally non-refundable once downloaded.</li>
        <li>If a creator’s listing is removed for policy violations after you purchased it, we’ll refund you in full.</li>
      </ul>
      <h2>Disputes</h2>
      <p>Chargebacks are handled by Stripe. We cooperate with legitimate dispute requests and reserve the right to suspend accounts that abuse chargebacks.</p>
      <h2>Contact</h2>
      <p>Need help? Email <a href="mailto:support@lumascout.app">support@lumascout.app</a>.</p>
    </LegalShell>
  );
}
