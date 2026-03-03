import type { PrinterState } from '../../lib/dto';

function pillStyle(state: PrinterState | string): string {
  const s = String(state);
  if (s === 'printing') return 'bg-accentCyan/15 text-accentCyan';
  if (s === 'paused') return 'bg-warning/15 text-warning';
  if (s === 'error') return 'bg-danger/15 text-danger';
  if (s === 'standby') return 'bg-offlineGray/15 text-[#94A3B8]';
  return 'bg-offlineGray/10 text-offlineGray';
}

export function StatusPill({ state }: { state: PrinterState | string }) {
  return (
    <div
      className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-medium ${pillStyle(
        state,
      )}`}
    >
      {String(state).toUpperCase()}
    </div>
  );
}
