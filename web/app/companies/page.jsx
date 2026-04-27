import { dashboardData } from '../../lib/data.js';
import SectionHeader from '../../components/SectionHeader.jsx';

const fmt = (v, suffix = '', digits = 2) =>
  v === null || v === undefined
    ? '—'
    : `${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;

const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v}%`);

export const metadata = {
  title: 'Company Contributors — Q1 2026 S&P 500 Earnings',
};

export default function CompaniesPage() {
  const { companyContributors } = dashboardData;
  const sectors = Object.keys(companyContributors);

  return (
    <div className="space-y-12">
      <section>
        <div className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold">
          Companies
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Companies FactSet credits with driving the sector growth rate
        </h1>
        <p className="mt-3 text-[var(--text-muted)] max-w-3xl">
          For each sector where FactSet identified specific contributors, both the actual reported figure and the
          analyst estimate are shown. The "ex-contributor" sensitivity row is FactSet's own published "what would the
          sector look like without these companies" calculation — verbatim, not re-derived.
        </p>
      </section>

      {sectors.length === 0 && (
        <p className="text-[var(--text-muted)]">No company contributors parsed yet.</p>
      )}

      {sectors.map((sector) => {
        const block = companyContributors[sector];
        return (
          <section key={sector}>
            <SectionHeader
              title={sector}
              subtitle="Top reported actuals vs prior estimates and the ex-contributor sector growth."
            />
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-[var(--border)]">
                    <th className="px-4 py-3 font-medium text-[var(--text-muted)]">Company</th>
                    <th className="px-4 py-3 font-medium text-[var(--text-muted)] text-right">Actual EPS</th>
                    <th className="px-4 py-3 font-medium text-[var(--text-muted)] text-right">Estimated EPS</th>
                    <th className="px-4 py-3 font-medium text-[var(--text-muted)] text-right">Surprise</th>
                  </tr>
                </thead>
                <tbody>
                  {block.companies.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-[var(--text-muted)]">
                        FactSet did not name a single contributor — only the ex-cohort sensitivity below.
                      </td>
                    </tr>
                  ) : (
                    block.companies.map((c) => {
                      const surprise =
                        c.actual !== null && c.estimate !== null && c.estimate !== 0
                          ? ((c.actual - c.estimate) / Math.abs(c.estimate)) * 100
                          : null;
                      return (
                        <tr key={c.company} className="border-b border-[var(--border)]/40 last:border-b-0">
                          <td className="px-4 py-3 font-medium">{c.company}</td>
                          <td className="px-4 py-3 tnum text-right">${fmt(c.actual)}</td>
                          <td className="px-4 py-3 tnum text-right">${fmt(c.estimate)}</td>
                          <td className="px-4 py-3 tnum text-right text-[var(--text-muted)]">
                            {surprise === null
                              ? '—'
                              : `${surprise > 0 ? '+' : ''}${surprise.toFixed(0)}%`}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              {block.exContributor && (
                <div className="border-t border-[var(--border)] bg-[var(--surface-2)]/40 px-4 py-3 text-sm">
                  <span className="text-[var(--text-muted)]">FactSet sensitivity: </span>
                  <span>
                    Excluding{' '}
                    <span className="font-medium">
                      {block.exContributor.excluding.length
                        ? block.exContributor.excluding.join(' & ')
                        : '(none specified)'}
                    </span>
                    , the {sector} sector earnings growth would be{' '}
                    <span className="font-semibold tnum">{fmtPct(block.exContributor.adjustedGrowth)}</span> rather than{' '}
                    <span className="font-semibold tnum">{fmtPct(block.exContributor.fullGrowth)}</span>.
                  </span>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
