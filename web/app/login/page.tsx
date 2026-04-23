import type { Metadata } from 'next';
import LoginClient from './_client';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to LumaScout — the network for photographers.',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return <LoginClient />;
}
