'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Badge } from '@/components/ui/primitives';
import { ArrowRight, Loader2, Mail, Lock, User } from 'lucide-react';

export default function RegisterClient() {
  const router = useRouter();
  const params = useSearchParams();
  const plan = params.get('plan');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not create account');
      router.replace(plan ? `/pricing?upgrade=${plan}` : '/dashboard');
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-[90vh] grid place-items-center px-6 py-24 bg-bg grain">
      <div className="pointer-events-none absolute inset-0 bg-radial-spot" aria-hidden />
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-surface-1 p-8 shadow-glass">
        <div className="text-center">
          <Badge tone="brand">{plan ? `Start ${plan.toUpperCase()}` : 'Join free'}</Badge>
          <h1 className="mt-5 font-display text-4xl tracking-tightest">Create your account</h1>
          <p className="mt-2 text-sm text-ink-muted">Free forever. No credit card required.</p>
        </div>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block">
            <span className="sr-only">Name</span>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-bg px-4 py-3 focus-within:border-strong">
              <User size={16} className="text-ink-dim" />
              <input
                type="text" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="flex-1 bg-transparent text-ink placeholder:text-ink-dim outline-none"
              />
            </div>
          </label>
          <label className="block">
            <span className="sr-only">Email</span>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-bg px-4 py-3 focus-within:border-strong">
              <Mail size={16} className="text-ink-dim" />
              <input
                type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="flex-1 bg-transparent text-ink placeholder:text-ink-dim outline-none"
              />
            </div>
          </label>
          <label className="block">
            <span className="sr-only">Password</span>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-bg px-4 py-3 focus-within:border-strong">
              <Lock size={16} className="text-ink-dim" />
              <input
                type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password (min 8 chars)"
                className="flex-1 bg-transparent text-ink placeholder:text-ink-dim outline-none"
              />
            </div>
          </label>

          {err && <p className="text-sm text-danger">{err}</p>}

          <button
            type="submit"
            disabled={loading}
            className="group flex w-full items-center justify-center gap-2 rounded-full bg-brand text-black font-semibold px-5 py-3.5 transition hover:bg-brand-600 disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <>Create account <ArrowRight size={16} /></>}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-ink-muted">
          Already have an account? <Link href="/login" className="text-ink hover:text-brand">Sign in</Link>
        </p>
        <p className="mt-2 text-center text-xs text-ink-dim">
          By continuing you agree to our <Link href="/terms" className="hover:text-ink">Terms</Link> and <Link href="/privacy" className="hover:text-ink">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}
