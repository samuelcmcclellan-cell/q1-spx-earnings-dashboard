import { dashboardData } from '../../lib/data.js';
import SectionHeader from '../../components/SectionHeader.jsx';
import StatCard from '../../components/StatCard.jsx';
import Bar from '../../components/Bar.jsx';

const fmt = (v, suffix = '') =>
  v === null || v === undefined ? '—' : `${v}${suffix}`;

export const metadata = {
  title: 'Forward Estimates & Guidance — Q1 2026 S&P 500 Earnings',
};

export default function ForwardPage() {
  const { forwardEstimates: fe, guidance, revisions, keyMetrics: km } = dashboardData;

  const quarters = [
    { key: 'Q2_2026', label: 'Q2 2026' },
    { key: 'Q3_2026', label: 'Q3 2026' },
    { key: 'Q4_2026', label: 'Q4 2026' },
    { key: 'CY_2026', label: 'CY 2026' },
  ];

  const sectorRev = revisions.sectorSinceQuarterEnd ?? [];
  const maxAbsRev = sectorRev.length
    ? Math.max(
        ...sectorRev.flatMap((r) => [Math.abs(r.current), Math.abs(r.endOfQuarter)]).filter((v) => Number.isFinite(v))
      )
    : 0;

  return (
    <div className="space-y-12">
      <section>
        <div className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold">
          Forward
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Forward earnings estimates &amp; published company guidance
        </h1>
        <p className="mt-3 text-[var(--text-muted)] max-w-3xl">
          Bottom-up analyst estimates for the next three quarters and full year, alongside the count of S&amp;P 500
          companies that have issued positive vs. negative EPS guidance for next quarter. All figures from FactSet's own
          tables, including 5/10-yr historical context for guidance.
        </p>
      </section>

      <section>
        <SectionHeader
          title="Projected earnings &amp; revenue growth"
          subtitle="Bottom-up consensus for next three quarters and CY 2026."
          source="FactSet Earnings Insight, pp. 24–28"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quarters.map((q) => {
            const data = fe[q.key];
            return (
              <div
                key={q.key}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
              >
                <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-medium">
                  {q.label}
                </div>
                <div className="mt-3 space-y-2">
                  <Row label="Earnings growth" value={data?.earningsGrowth} suffix="%" />
                  <Row label="Revenue growth" value={data?.revenueGrowth} suffix="%" />
                  {data?.netProfitMargin !== undefined && (
                    <Row label="Net profit margin" value={data?.netProfitMargin} suffix="%" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <SectionHeader
          title={`EPS guidance — ${guidance.nextQuarter?.label ?? 'Next quarter'}`}
          subtitle="Companies' own published forward EPS expectations."
          source="FactSet Earnings Insight, p. 22"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Negative guidance"
            value={guidance.nextQuarter?.negative ?? km.negativeGuidanceCount}
          />
          <StatCard
            label="Positive guidance"
            value={guidance.nextQuarter?.positive ?? km.positiveGuidanceCount}
          />
          <StatCard
            label="% issuing negative guidance"
            value={guidance.nextQuarter?.negPct}
            suffix="%"
            subline={
              guidance.nextQuarter
                ? `5-yr avg ${fmt(guidance.nextQuarter.negPct5yr, '%')} · 10-yr avg ${fmt(guidance.nextQuarter.negPct10yr, '%')}`
                : null
            }
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Estimate revisions since end of quarter"
          subtitle="How blended growth rates have moved vs. one week ago and vs. the end of Q1."
          source="FactSet Earnings Insight, pp. 13–14"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <RevisionsCard
            title="Earnings growth (overall)"
            current={revisions.earningsGrowth?.current}
            lastWeek={revisions.earningsGrowth?.lastWeek}
            endOfQuarter={revisions.earningsGrowth?.endOfQuarter}
          />
          <RevisionsCard
            title="Revenue growth (overall)"
            current={revisions.revenueGrowth?.current}
            lastWeek={revisions.revenueGrowth?.lastWeek}
            endOfQuarter={revisions.revenueGrowth?.endOfQuarter}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Sector growth — current vs. end-of-quarter"
          subtitle="How each sector's blended earnings growth rate has shifted since March 31."
          source="FactSet Earnings Insight, pp. 13–14"
        />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[var(--border)]">
                <th className="py-2 pr-4 font-medium text-[var(--text-muted)]">Sector</th>
                <th className="py-2 pr-4 font-medium text-[var(--text-muted)]">Current</th>
                <th className="py-2 pr-4 font-medium text-[var(--text-muted)]">End of quarter</th>
              </tr>
            </thead>
            <tbody>
              {sectorRev.map((r) => (
                <tr key={r.sector} className="border-b border-[var(--border)]/40 last:border-b-0">
                  <td className="py-2 pr-4 font-medium">{r.sector}</td>
                  <td className="py-2 pr-4">
                    <Bar value={r.current} max={maxAbsRev} suffix="%" width={120} />
                  </td>
                  <td className="py-2 pr-4">
                    <Bar value={r.endOfQuarter} max={maxAbsRev} suffix="%" width={120} />
                  </td>
                </tr>
              ))}
              {sectorRev.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-3 text-[var(--text-muted)]">
                    No sector revisions parsed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Row({ label, value, suffix }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-sm text-[var(--text-muted)]">{label}</span>
      <span className="tnum text-base font-medium">
        {value === null || value === undefined ? '—' : `${value}${suffix}`}
      </span>
    </div>
  );
}

function RevisionsCard({ title, current, lastWeek, endOfQuarter }) {
  const fmtV = (v) => (v === null || v === undefined ? '—' : `${v}%`);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="font-medium">{title}</div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Current</div>
          <div className="mt-1 text-2xl font-semibold tnum">{fmtV(current)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Last week</div>
          <div className="mt-1 text-2xl font-semibold tnum">{fmtV(lastWeek)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Mar 31</div>
          <div className="mt-1 text-2xl font-semibold tnum">{fmtV(endOfQuarter)}</div>
        </div>
      </div>
    </div>
  );
}
