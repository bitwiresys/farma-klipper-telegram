import type { PrinterState } from '../../lib/dto';

function pillStyle(state: PrinterState | string): string {
  const s = String(state);
  if (s === 'printing')
    return 'border-accentCyan/25 bg-accentCyan/12 text-accentCyan';
  if (s === 'paused') return 'border-warning/25 bg-warning/12 text-warning';
  if (s === 'error') return 'border-danger/25 bg-danger/12 text-danger';
  if (s === 'standby')
    return 'border-offlineGray/25 bg-offlineGray/12 text-[#94A3B8]';
  return 'border-offlineGray/25 bg-offlineGray/10 text-offlineGray';
}

export function StatusPill({ state }: { state: PrinterState | string }) {
  return (
    <div
      className={
        `inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] ` +
        `${pillStyle(state)}`
      }
    >
      {String(state).toUpperCase()}
    </div>
  );
}
