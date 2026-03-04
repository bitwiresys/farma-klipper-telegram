import type { ReactNode } from 'react';

export function Chip({
  children,
  active,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <div
      className={
        'inline-flex items-center rounded-full px-3 py-1 text-[11px] ' +
        (active
          ? 'border border-accentCyan/35 bg-accentCyan/10 text-accentCyan'
          : 'border border-border/45 bg-surface2/55 text-textSecondary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]')
      }
    >
      {children}
    </div>
  );
}
