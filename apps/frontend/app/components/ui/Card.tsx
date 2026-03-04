import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        `rounded-card border border-border/50 bg-gradient-to-b from-surface2/70 to-surface1 p-4 ` +
        `shadow-[0_12px_30px_rgba(0,0,0,0.35)] ${className}`
      }
    >
      {children}
    </div>
  );
}
