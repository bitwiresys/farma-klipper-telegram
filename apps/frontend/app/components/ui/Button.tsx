'use client';

import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: Props) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-btn px-3 py-2 text-xs ' +
    'transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100';

  const v =
    variant === 'primary'
      ? 'bg-accentCyan text-[#06211F]'
      : variant === 'destructive'
        ? 'border border-danger/35 bg-danger/20 text-[#FF6B6B]'
        : variant === 'ghost'
          ? 'bg-transparent text-textSecondary'
          : 'border border-border/70 bg-surface2 text-textPrimary';

  return <button className={`${base} ${v} ${className}`} {...props} />;
}
