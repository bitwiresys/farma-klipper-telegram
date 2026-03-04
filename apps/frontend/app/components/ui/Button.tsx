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
    'inline-flex items-center justify-center gap-2 rounded-btn px-3 py-2 text-xs font-medium ' +
    'transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100';

  const v =
    variant === 'primary'
      ? 'bg-accentCyan text-[#06211F] shadow-[0_10px_28px_rgba(32,211,194,0.20)]'
      : variant === 'destructive'
        ? 'border border-danger/35 bg-danger/15 text-[#FF6B6B]'
        : variant === 'ghost'
          ? 'bg-transparent text-textSecondary'
          : 'border border-border/50 bg-surface2/70 text-textPrimary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';

  return <button className={`${base} ${v} ${className}`} {...props} />;
}
