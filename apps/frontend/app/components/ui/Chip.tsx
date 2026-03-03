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
          : 'border border-border/70 bg-surface2 text-textSecondary')
      }
    >
      {children}
    </div>
  );
}
