import React from 'react';
import { Badge } from '@/components/ui/primitives';

export function LegalShell({ eyebrow, title, updated, children }: { eyebrow: string; title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <div className="relative overflow-hidden border-b border-border bg-bg grain">
        <div className="pointer-events-none absolute inset-0 bg-radial-spot" aria-hidden />
        <div className="mx-auto max-w-4xl px-6 pt-36 pb-12 lg:pt-40">
          <Badge tone="neutral">{eyebrow}</Badge>
          <h1 className="mt-5 font-display text-4xl md:text-5xl lg:text-6xl tracking-tightest leading-[1.05]">{title}</h1>
          <p className="mt-3 text-sm text-ink-dim">Last updated: {updated}</p>
        </div>
      </div>
      <article className="mx-auto max-w-3xl px-6 py-14 text-ink-muted leading-relaxed text-[15px] space-y-5 legal-body">
        {children}
        <style>{`
          .legal-body h2 { color: #F5F5F7; font-family: var(--font-display); font-size: 1.5rem; letter-spacing: -0.02em; margin-top: 2.25rem; margin-bottom: 0.75rem; }
          .legal-body h3 { color: #F5F5F7; font-weight: 600; font-size: 1rem; margin-top: 1.5rem; margin-bottom: 0.5rem; }
          .legal-body p { margin-bottom: 0.75rem; }
          .legal-body ul { list-style: disc; padding-left: 1.25rem; margin-bottom: 0.75rem; }
          .legal-body li { margin-bottom: 0.35rem; }
          .legal-body a { color: #F5A623; }
          .legal-body a:hover { color: #E49520; }
        `}</style>
      </article>
    </>
  );
}
