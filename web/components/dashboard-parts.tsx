import React from 'react';
import { Badge } from '@/components/ui/primitives';

export function DashboardHeader({ eyebrow, title, kicker, right }: { eyebrow?: string; title: string; kicker?: string; right?: React.ReactNode }) {
  return (
    <header className="border-b border-border bg-bg">
      <div className="px-6 lg:px-10 pt-10 pb-8 lg:pt-14 lg:pb-10">
        {eyebrow && <Badge tone="neutral">{eyebrow}</Badge>}
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl md:text-4xl lg:text-5xl tracking-tightest leading-[1.05]">{title}</h1>
            {kicker && <p className="mt-2 text-ink-muted max-w-2xl">{kicker}</p>}
          </div>
          {right}
        </div>
      </div>
    </header>
  );
}

export function EmptyState({ icon: Icon, title, body, cta }: { icon: any; title: string; body?: string; cta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-1 px-6 py-14 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-border bg-bg text-brand">
        <Icon size={20} />
      </span>
      <h3 className="mt-5 font-display text-2xl tracking-tightest">{title}</h3>
      {body && <p className="mt-2 text-sm text-ink-muted max-w-md mx-auto">{body}</p>}
      {cta && <div className="mt-6 flex justify-center">{cta}</div>}
    </div>
  );
}
