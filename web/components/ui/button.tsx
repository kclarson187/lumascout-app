import Link from 'next/link';
import type { LinkProps } from 'next/link';
import { cn } from '@/lib/utils';
import React from 'react';

type ButtonProps = {
  variant?: 'primary' | 'ghost' | 'outline' | 'glass';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  children: React.ReactNode;
};

export function buttonClasses(v: ButtonProps['variant'] = 'primary', s: ButtonProps['size'] = 'md') {
  const base = 'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all focus-visible:ring-2 focus-visible:ring-brand-ring';
  const sizeCls =
    s === 'lg' ? 'px-6 py-3.5 text-base' :
    s === 'sm' ? 'px-3.5 py-1.5 text-xs' :
    'px-5 py-2.5 text-sm';
  const variantCls =
    v === 'ghost'   ? 'text-ink-muted hover:text-ink' :
    v === 'outline' ? 'border border-border text-ink hover:bg-surface-2 hover:border-strong' :
    v === 'glass'   ? 'glass text-ink border border-border hover:border-strong' :
    'bg-brand text-black hover:bg-brand-600 shadow-lift';
  return cn(base, sizeCls, variantCls);
}

export function Button({ variant, size, className, children }: ButtonProps) {
  return <button className={cn(buttonClasses(variant, size), className)}>{children}</button>;
}

export function LinkButton({
  variant, size, className, children, href, ...rest
}: ButtonProps & LinkProps & { href: string }) {
  return (
    <Link href={href} className={cn(buttonClasses(variant, size), className)} {...rest}>
      {children}
    </Link>
  );
}
