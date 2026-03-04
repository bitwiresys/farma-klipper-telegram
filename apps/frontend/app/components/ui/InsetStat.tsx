import type { ReactNode } from 'react';

export function InsetStat({
  label,
  value,
  right,
  className = '',
}: {
  label: string;
  value: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-btn border border-border/45 bg-surface2/55 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-textMuted">
          {label}
        </div>
        {right ? (
          <div className="text-[10px] text-textMuted">{right}</div>
        ) : null}
      </div>
      <div className="mt-1 text-[12px] font-semibold text-textPrimary">
        {value}
      </div>
    </div>
  );
}
