import Link from 'next/link';
import { dashboardData } from '../lib/data.js';
import StatCard from '../components/StatCard.jsx';
import Bar from '../components/Bar.jsx';
import SectionHeader from '../components/SectionHeader.jsx';

const fmt = (v, suffix = '') =>
  v === null || v === undefined ? '—' : `${v}${suffix}`;

export default function OverviewPage() {
  const { meta, keyMetrics: km, scorecard: sc, netProfitMargin: npm, sectorMatrix } = dashboardData;

  // For the sector ranking chart, use earnings growth where reported.
  const sectorRanked = [...sectorMatrix]
    .filter((s) => s.earningsGrowth !== null)
    .sort((a, b) => b.earningsGrowth - a.earningsGrowth);
  const maxAbsGrowth = sectorRanked.length
    ? Math.max(...sectorRanked.map((s) => Math.abs(s.earningsGrowth)))
    : 0;

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section>
        <div className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold">
          {meta.quarter} · S&amp;P 500 Earnings · As of {meta.asOfDate}
        </div>
        <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">
          {km.pctReported}% of S&amp;P 500 companies reported.{' '}
          <span className="text-[var(--accent)]">Blended earnings growth: {fmt(km.blendedEarningsGrowth, '%')}</span>.
        </h1>
        <p className="mt-3 text-[var(--text-muted)] max-w-3xl">
          Every figure on this page is parsed verbatim from{' '}
          <span className="text-[var(--text)] font-medium">{meta.sourcePdf}</span>. No editorial
          framing, no curated outliers — all 11 GICS sectors shown wherever FactSet reports them.
        </p>
      </section>

      {/* KPI grid */}
      <section>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Companies reporting"
            value={km.pctReported}
            suffix="%"
            hint="Of the S&P 500 index"
          />
          <StatCard
            label="EPS surprise %"
            value={sc.epsSurprise.current}
            suffix="%"
            subline={`5-yr avg ${fmt(sc.epsSurprise.avg5yr, '%')} · 10-yr avg ${fmt(sc.epsSurprise.avg10yr, '%')}`}
          />
          <StatCard
            label="% beat EPS"
            value={sc.epsBeat.current}
            suffix="%"
            subline={`5-yr avg ${fmt(sc.epsBeat.avg5yr, '%')} · 10-yr avg ${fmt(sc.epsBeat.avg10yr, '%')}`}
          />
          <StatCard
            label="% beat revenue"
            value={sc.revenueBeat.current}
            suffix="%"
            subline={`5-yr avg ${fmt(sc.revenueBeat.avg5yr, '%')} · 10-yr avg ${fmt(sc.revenueBeat.avg10yr, '%')}`}
          />
          <StatCard
            label="Blended earnings growth"
            value={km.blendedEarningsGrowth}
            suffix="%"
            hint="Year-over-year"
          />
          <StatCard
            label="Blended revenue growth"
            value={km.blendedRevenueGrowth}
            suffix="%"
            hint="Year-over-year"
          />
          <StatCard
            label="Net profit margin"
            value={npm.current}
            suffix="%"
            subline={`Year-ago ${fmt(npm.yearAgo, '%')} · 5-yr avg ${fmt(npm.avg5yr, '%')}`}
          />
          <StatCard
            label="Forward 12M P/E"
            value={km.fwdPe}
            subline={`5-yr avg ${fmt(km.fwdPe5yr)} · 10-yr avg ${fmt(km.fwdPe10yr)}`}
          />
        </div>
      </section>

      {/* Guidance summary */}
      <section>
        <SectionHeader
          title="Forward EPS guidance — current quarter"
          subtitle="Companies' own published expectations for the next quarter."
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Negative guidance" value={km.negativeGuidanceCount} />
          <StatCard label="Positive guidance" value={km.positiveGuidanceCount} />
          <StatCard
            label="% negative"
            value={dashboardData.guidance.nextQuarter?.negPct ?? null}
            suffix="%"
            subline={
              dashboardData.guidance.nextQuarter
                ? `5-yr avg ${fmt(dashboardData.guidance.nextQuarter.negPct5yr, '%')} · 10-yr avg ${fmt(dashboardData.guidance.nextQuarter.negPct10yr, '%')}`
                : null
            }
          />
        </div>
      </section>

      {/* Sector ranking chart */}
      <section>
        <SectionHeader
          title="Earnings growth by sector"
          subtitle="All sectors FactSet itemized this week. Bars are scaled to the largest absolute value in the column."
        />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="space-y-2">
            {sectorRanked.map((s) => (
              <div key={s.sector} className="grid grid-cols-[180px_1fr] gap-4 items-center text-sm">
                <Link
                  href="/sectors/"
                  className="text-[var(--text)] hover:text-[var(--accent)] transition-colors"
                >
                  {s.sector}
                </Link>
                <Bar value={s.earningsGrowth} max={maxAbsGrowth} width={Math.min(400, 280)} />
              </div>
            ))}
            {sectorRanked.length === 0 && (
              <div className="text-sm text-[var(--text-muted)]">No sector growth rates parsed yet.</div>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          Sectors not shown here had no itemized growth rate in this week's FactSet report. See{' '}
          <Link href="/sectors/" className="text-[var(--accent)] hover:underline">Sectors</Link>{' '}
          for the full matrix.
        </p>
      </section>

      {/* Quick links */}
      <section>
        <SectionHeader
          title="Drill in"
          subtitle="Each page mirrors a section of the FactSet PDF without re-framing."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <QuickLink href="/sectors/" title="Sector matrix" desc="11 GICS sectors × 7 metrics + industry breakdown" />
          <QuickLink href="/companies/" title="Company contributors" desc="Companies FactSet credits with driving the growth rate" />
          <QuickLink href="/forward/" title="Forward & guidance" desc="Q2/Q3/Q4 + CY 2026/27 estimates · EPS guidance counts" />
          <QuickLink href="/valuation/" title="Valuation & targets" desc="Forward / trailing P/E · sector P/E · price targets · ratings" />
          <QuickLink href="/raw/" title="Raw data" desc="Every parsed value with its JSON path. Use it to audit any number." />
          <QuickLink
            href="/Q1_2026_Earnings_Dashboard.xlsx"
            external
            title="Download .xlsx"
            desc="Same data as a 9-sheet Excel workbook with conditional formatting"
          />
        </div>
      </section>
    </div>
  );
}

function QuickLink({ href, title, desc, external = false }) {
  const Cmp = external ? 'a' : Link;
  const props = external ? { href, download: true } : { href };
  return (
    <Cmp
      {...props}
      className="block rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] hover:border-[var(--accent)]/50 transition-colors p-5"
    >
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-sm text-[var(--text-muted)]">{desc}</div>
    </Cmp>
  );
}
