import type { Metadata } from 'next';
import { LegalShell } from '@/components/legal-shell';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms and conditions governing your use of LumaScout.',
  alternates: { canonical: 'https://lumascout.app/terms' },
};

export default function TermsPage() {
  return (
    <LegalShell eyebrow="Legal" title="Terms of Service" updated="April 2026">
      <p>These Terms of Service (“Terms”) are a binding agreement between you and LumaScout, Inc. Please read them carefully.</p>
      <h2>1. Accounts</h2>
      <p>You must be at least 13 years old to use LumaScout. You are responsible for maintaining the security of your account and for all activity that occurs under it.</p>
      <h2>2. Content and licenses</h2>
      <p>You retain ownership of the content you upload. By uploading, you grant LumaScout a worldwide, non-exclusive, royalty-free license to host, display, and transmit your content in connection with the Services. You represent that you have the rights to the content you upload.</p>
      <h2>3. Community guidelines</h2>
      <p>Do not post private-property coordinates without permission, harassing or illegal content, copyrighted works you do not own, or spam. We may remove content or suspend accounts that violate our Community Guidelines.</p>
      <h2>4. Subscriptions and billing</h2>
      <p>Paid plans (Pro, Elite) are billed monthly or annually via Stripe. You can upgrade, downgrade, or cancel at any time from Settings. Fees are non-refundable except as required by law or our Refund Policy.</p>
      <h2>5. Marketplace</h2>
      <p>Sellers keep 85% of the sale price net of payment-processor fees. Payouts are handled by Stripe Connect. Buyers may request refunds within 7 days for digital items that are materially different from their description; see our Refund Policy.</p>
      <h2>6. Termination</h2>
      <p>You may delete your account at any time. We may suspend or terminate accounts that violate these Terms or cause harm to the community.</p>
      <h2>7. Disclaimer and limitation of liability</h2>
      <p>LumaScout is provided “as is”. We disclaim all warranties to the maximum extent permitted by law. LumaScout is not liable for indirect, incidental, or consequential damages. Our total liability is limited to the amount you paid to LumaScout in the preceding 12 months.</p>
      <h2>8. Changes</h2>
      <p>We may update these Terms from time to time. We’ll notify you of material changes via email or in-app.</p>
      <h2>9. Contact</h2>
      <p>Questions? Email <a href="mailto:legal@lumascout.app">legal@lumascout.app</a>.</p>
    </LegalShell>
  );
}
