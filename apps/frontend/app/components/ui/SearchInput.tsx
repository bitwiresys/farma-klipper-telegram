'use client';

import { Search } from 'lucide-react';
import type { InputHTMLAttributes } from 'react';

export function SearchInput({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div
      className={`flex items-center gap-2 rounded-btn border border-border/45 bg-surface2/55 px-3 py-2 text-textPrimary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${className}`}
    >
      <Search size={14} className="text-textMuted" />
      <input
        className="w-full bg-transparent text-xs text-textPrimary placeholder:text-textMuted focus:outline-none"
        {...props}
      />
    </div>
  );
}
