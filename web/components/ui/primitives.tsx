import { cn } from '@/lib/utils';
import React from 'react';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('rounded-2xl border border-border bg-surface-1 p-6', className)}>
      {children}
    </div>
  );
}

export function Badge({ className, children, tone = 'neutral' }: { className?: string; children: React.ReactNode; tone?: 'neutral' | 'brand' | 'success' }) {
  const toneCls =
    tone === 'brand' ? 'bg-brand-50 text-brand border border-brand/30' :
    tone === 'success' ? 'bg-success/10 text-success border border-success/25' :
    'bg-surface-3 text-ink-muted border border-border';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest', toneCls, className)}>
      {children}
    </span>
  );
}

export function Section({
  id,
  className,
  eyebrow,
  title,
  kicker,
  children,
}: {
  id?: string;
  className?: string;
  eyebrow?: string;
  title?: React.ReactNode;
  kicker?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn('mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32', className)}>
      {(eyebrow || title || kicker) && (
        <div className="mx-auto mb-14 max-w-3xl text-center">
          {eyebrow && (
            <p className="text-[11px] uppercase tracking-widest text-brand font-semibold">
              {eyebrow}
            </p>
          )}
          {title && (
            <h2 className="mt-3 font-display text-4xl md:text-5xl lg:text-6xl tracking-tightest leading-[1.05] text-ink">
              {title}
            </h2>
          )}
          {kicker && (
            <p className="mt-5 text-lg text-ink-muted">{kicker}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
