// Inline horizontal bar that grows from a center axis at 0. Accepts a value and
// the symmetric domain `max` (the largest absolute value across the column) so
// bars across rows are comparable. Single neutral palette (blue) — no
// red/green good/bad coloring per the project's objectivity rules.

export default function Bar({ value, max, suffix = '%', width = 100 }) {
  if (value === null || value === undefined || max === 0) {
    return <span className="text-[var(--text-muted)] tnum">—</span>;
  }
  const pct = Math.min(100, Math.abs(value) / max * 100);
  const isNeg = value < 0;
  return (
    <div className="flex items-center gap-2">
      <div className="relative" style={{ width: `${width}px`, height: '8px' }}>
        <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--border)]" />
        <div
          className={`absolute inset-y-0 ${isNeg ? 'right-1/2' : 'left-1/2'} bg-[var(--accent)]/80 rounded-sm`}
          style={{ width: `${pct / 2}%` }}
        />
      </div>
      <span className="tnum text-sm w-14 text-right">
        {value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}{suffix}
      </span>
    </div>
  );
}
