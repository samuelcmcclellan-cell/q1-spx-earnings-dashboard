export default function SectionHeader({ title, subtitle, source }) {
  return (
    <div className="flex items-baseline justify-between mb-4 pb-2 border-b border-[var(--border)]">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-[var(--text-muted)]">{subtitle}</p>}
      </div>
      {source && (
        <div className="text-xs text-[var(--text-muted)] hidden sm:block">Source: {source}</div>
      )}
    </div>
  );
}
