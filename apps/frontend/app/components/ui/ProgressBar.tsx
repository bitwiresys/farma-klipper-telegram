export function ProgressBar({ value01 }: { value01: number | null }) {
  const v = value01 === null ? 0 : Math.max(0, Math.min(1, value01));
  return (
    <div className="h-[6px] w-full rounded-full bg-white/8">
      <div
        className="h-[6px] rounded-full bg-accentCyan shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset] transition-all"
        style={{ width: `${Math.round(v * 1000) / 10}%` }}
      />
    </div>
  );
}
