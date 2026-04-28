import { dashboardData } from '../../lib/data.js';
import SectionHeader from '../../components/SectionHeader.jsx';
import Bar from '../../components/Bar.jsx';

const fmt = (v, suffix = '') =>
  v === null || v === undefined ? '—' : `${v}${suffix}`;

export const metadata = {
  title: 'Sector Matrix — Q1 2026 S&P 500 Earnings',
};

const COLUMNS = [
  { key: 'epsBeatPct', label: '% beat EPS', suffix: '%' },
  { key: 'revBeatPct', label: '% beat revenue', suffix: '%' },
  { key: 'epsSurprise', label: 'EPS surprise', suffix: '%' },
  { key: 'revSurprise', label: 'Revenue surprise', suffix: '%' },
  { key: 'earningsGrowth', label: 'Earnings growth (YoY)', suffix: '%' },
  { key: 'revenueGrowth', label: 'Revenue growth (YoY)', suffix: '%' },
  { key: 'netProfitMargin', label: 'Net profit margin', suffix: '%' },
];

export default function SectorsPage() {
  const { sectorMatrix, sectorIndustries, sectorMatrixSource } = dashboardData;

  // For each column, compute max-abs across the column for bar scaling
  const maxAbs = {};
  for (const c of COLUMNS) {
    const vals = sectorMatrix
      .map((s) => s[c.key])
      .filter((v) => v !== null && v !== undefined);
    maxAbs[c.key] = vals.length ? Math.max(...vals.map(Math.abs)) : 0;
  }

  return (
    <div className="space-y-12">
      <section>
        <div className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold">
          Sectors
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">All 11 GICS sectors</h1>
        <p className="mt-3 text-[var(--text-muted)] max-w-3xl">
          Every sector FactSet itemized this week is shown — including ones with sparse data.
          Bars in each column are scaled to the largest absolute value in the column so they're comparable across rows.
        </p>
        <ul className="mt-3 text-sm text-[var(--text-muted)] max-w-3xl space-y-1 list-disc pl-5">
          <li>
            <span className="font-medium text-[var(--text)]">Empty cells (—)</span> mean the value
            wasn't published in this week's FactSet PDF — FactSet's narrative
            spotlights only 5–6 sectors per metric, and a few small bar charts
            don't OCR cleanly enough to extract.
          </li>
          <li>
            <span className="font-medium text-[var(--text)]">Cells marked with <span className="font-mono text-[var(--accent)]">▣</span></span>{' '}
            were extracted from the all-11-sector bar charts on pages 17/20/22
            (OCR). Unmarked cells came from the narrative text on pages 1–11.
          </li>
        </ul>
      </section>

      <section>
        <SectionHeader
          title="Sector matrix"
          subtitle="One row per GICS sector. Sorted alphabetically."
          source="FactSet Earnings Insight, pp. 6–11"
        />
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[var(--border)]">
                <th className="px-4 py-3 font-medium text-[var(--text-muted)] sticky left-0 bg-[var(--surface)]">
                  Sector
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-4 py-3 font-medium text-[var(--text-muted)]">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sectorMatrix.map((row, i) => (
                <tr
                  key={row.sector}
                  className={i % 2 === 0 ? 'bg-transparent' : 'bg-[var(--surface-2)]/40'}
                >
                  <td className="px-4 py-3 font-medium sticky left-0 bg-inherit">{row.sector}</td>
                  {COLUMNS.map((c) => {
                    const src = sectorMatrixSource?.[row.sector]?.[c.key];
                    const isChart = typeof src === 'string' && src.startsWith('chart-');
                    return (
                      <td key={c.key} className="px-4 py-3 tnum">
                        <div className="flex items-center gap-1.5">
                          <Bar value={row[c.key]} max={maxAbs[c.key]} suffix={c.suffix} width={120} />
                          {isChart && (
                            <span
                              className="text-[var(--accent)] font-mono text-xs leading-none"
                              title={`Extracted from ${src.replace('chart-p', 'page ')} chart (OCR)`}
                            >
                              ▣
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionHeader
          title="Industry breakdown by sector"
          subtitle="Industries within each sector that FactSet itemized for earnings or revenue growth."
          source="FactSet Earnings Insight, pp. 6–11"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sectorMatrix.map((sec) => {
            const ind = sectorIndustries[sec.sector];
            const hasAny = ind && (ind.earnings?.length || ind.revenue?.length);
            return (
              <div
                key={sec.sector}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
              >
                <div className="font-semibold">{sec.sector}</div>
                {!hasAny ? (
                  <div className="mt-3 text-sm text-[var(--text-muted)]">
                    No itemized industry breakdown in this week's report.
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <IndustryList title="Earnings growth" items={ind.earnings} />
                    <IndustryList title="Revenue growth" items={ind.revenue} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function IndustryList({ title, items }) {
  if (!items || items.length === 0) {
    return (
      <div>
        <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-medium">{title}</div>
        <div className="mt-2 text-sm text-[var(--text-muted)]">—</div>
      </div>
    );
  }
  const maxAbs = Math.max(...items.map((i) => Math.abs(i.growth)));
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-medium">{title}</div>
      <div className="mt-2 space-y-1.5">
        {items.map((i) => (
          <div key={i.industry} className="grid grid-cols-[1fr_auto] gap-3 items-center text-sm">
            <span className="truncate" title={i.industry}>{i.industry}</span>
            <Bar value={i.growth} max={maxAbs} suffix="%" width={80} />
          </div>
        ))}
      </div>
    </div>
  );
}
