import type { Metadata } from 'next';
import PricingClient from './_client';

export const metadata: Metadata = {
  title: 'Pricing — Free, Pro, Elite',
  description:
    'Start free. Upgrade to Pro for unlimited saves, advanced filters, and creator analytics. Go Elite for the full marketplace storefront and priority perks.',
  alternates: { canonical: 'https://lumascout.app/pricing' },
  openGraph: {
    title: 'LumaScout Pricing — Free, Pro, Elite',
    description: 'Simple plans. Serious tools.',
    url: 'https://lumascout.app/pricing',
  },
};

export default function PricingPage() {
  return <PricingClient />;
}
