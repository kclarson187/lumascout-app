import type { Metadata } from 'next';
import RegisterClient from './_client';

export const metadata: Metadata = {
  title: 'Create your account',
  description: 'Join LumaScout free. Discover incredible photo locations and grow your photography business.',
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return <RegisterClient />;
}
