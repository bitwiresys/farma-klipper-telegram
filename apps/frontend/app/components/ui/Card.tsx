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
      className={`rounded-card border border-border/70 bg-surface1 p-4 ${className}`}
    >
      {children}
    </div>
  );
}
