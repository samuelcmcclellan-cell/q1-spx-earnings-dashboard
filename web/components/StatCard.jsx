// Single KPI card. `subline` carries optional context like the 5/10-yr average.
// Renders a "—" for null values rather than 0 so missing data is visible.

export default function StatCard({ label, value, suffix = '', subline = null, hint = null }) {
  const hasValue = value !== null && value !== undefined;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-medium">{label}</div>
      <div className="mt-2 text-3xl font-semibold tnum">
        {hasValue ? (
          <>
            {value}
            <span className="text-xl text-[var(--text-muted)] ml-0.5">{suffix}</span>
          </>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        )}
      </div>
      {subline && <div className="mt-1 text-xs text-[var(--text-muted)] tnum">{subline}</div>}
      {hint && <div className="mt-3 text-xs text-[var(--text-muted)]">{hint}</div>}
    </div>
  );
}
