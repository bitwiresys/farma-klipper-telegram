'use client';

export function Switch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
      className={
        'relative h-7 w-12 rounded-full border border-border/70 transition ' +
        (disabled ? 'opacity-50' : 'active:scale-[0.98] ') +
        (checked ? 'bg-accentCyan/20' : 'bg-surface2')
      }
    >
      <span
        className={
          'absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition ' +
          (checked ? 'left-6 bg-accentCyan' : 'left-1 bg-textMuted/60')
        }
      />
    </button>
  );
}
