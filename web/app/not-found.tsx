import Link from 'next/link';
import { LinkButton } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-[70vh] grid place-items-center px-6">
      <div className="text-center max-w-md">
        <p className="font-display text-8xl md:text-9xl text-brand tracking-tightest">404</p>
        <h1 className="mt-4 font-display text-3xl md:text-4xl">This spot doesn’t exist</h1>
        <p className="mt-3 text-ink-muted">The location you tried to reach has moved, been unpublished, or never existed.</p>
        <div className="mt-8 flex justify-center gap-3">
          <LinkButton href="/">Go home</LinkButton>
          <LinkButton href="/marketplace" variant="outline">Browse marketplace</LinkButton>
        </div>
      </div>
    </div>
  );
}
