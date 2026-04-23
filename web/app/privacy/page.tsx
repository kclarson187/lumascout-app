import type { Metadata } from 'next';
import { LegalShell } from '@/components/legal-shell';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How LumaScout collects, uses, shares, and protects your data.',
  alternates: { canonical: 'https://lumascout.app/privacy' },
};

export default function PrivacyPage() {
  return (
    <LegalShell eyebrow="Legal" title="Privacy Policy" updated="April 2026">
      <p>This Privacy Policy describes how LumaScout, Inc. (“LumaScout”, “we”, “us”) collects, uses, and shares information when you use our iOS app, Android app, website, and related services (collectively, the “Services”).</p>
      <h2>1. Information we collect</h2>
      <p>We collect information you provide directly — such as your name, email address, profile photo, location (city/state), biography, specialties, and the spots you save, post, or share. We also collect technical information automatically, including device identifiers, approximate IP-based location, crash logs, and anonymized usage analytics.</p>
      <h2>2. How we use your information</h2>
      <ul>
        <li>To operate and improve the Services, including personalization and recommendations;</li>
        <li>To enable core features such as community feed, messaging, referrals, and marketplace transactions;</li>
        <li>To secure accounts, detect fraud, and enforce our Terms of Service;</li>
        <li>To communicate with you about product updates, security notices, and (only with your consent) marketing.</li>
      </ul>
      <h2>3. Sharing</h2>
      <p>We do not sell your personal information. We share data with trusted subprocessors that help us run the Services (e.g., cloud hosting, Stripe for payments, push-notification delivery). We may disclose data if required by law or to protect users’ safety.</p>
      <h2>4. Your choices</h2>
      <p>You can edit or delete your profile data at any time from Settings. You can request a copy of your data or delete your account by emailing <a href="mailto:privacy@lumascout.app">privacy@lumascout.app</a>.</p>
      <h2>5. Children</h2>
      <p>LumaScout is not intended for children under 13. We do not knowingly collect personal information from children under 13.</p>
      <h2>6. Security</h2>
      <p>We use bank-grade encryption in transit (TLS) and at rest, httpOnly session cookies on the web, and industry best practices for secret management. No service is 100% secure — please use a strong password and keep it private.</p>
      <h2>7. Contact</h2>
      <p>Questions? Email <a href="mailto:privacy@lumascout.app">privacy@lumascout.app</a>.</p>
    </LegalShell>
  );
}
