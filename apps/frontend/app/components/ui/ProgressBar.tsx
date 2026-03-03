export function ProgressBar({ value01 }: { value01: number | null }) {
  const v = value01 === null ? 0 : Math.max(0, Math.min(1, value01));
  return (
    <div className="h-2 w-full rounded-full bg-white/10">
      <div
        className="h-2 rounded-full bg-gradient-to-r from-accentCyan to-infoBlue transition-all"
        style={{ width: `${Math.round(v * 1000) / 10}%` }}
      />
    </div>
  );
}
