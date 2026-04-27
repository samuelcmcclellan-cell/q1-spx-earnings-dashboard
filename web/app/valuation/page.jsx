import { dashboardData } from '../../lib/data.js';
import SectionHeader from '../../components/SectionHeader.jsx';
import StatCard from '../../components/StatCard.jsx';
import Bar from '../../components/Bar.jsx';

const fmt = (v, suffix = '') =>
  v === null || v === undefined ? '—' : `${v}${suffix}`;

export const metadata = {
  title: 'Valuation & Targets — Q1 2026 S&P 500 Earnings',
};

export default function ValuationPage() {
  const { valuation, targets, ratings } = dashboardData;
  const sectorPe = valuation.sectorFwdPe ?? [];
  const sectorUpside = targets.sectorUpside ?? [];
  const sectorBuy = ratings.sectorBuyPct ?? [];

  const maxPe = sectorPe.length ? Math.max(...sectorPe.map((s) => s.fwdPe)) : 0;
  const maxUpside = sectorUpside.length ? Math.max(...sectorUpside.map((s) => Math.abs(s.upsidePct))) : 0;
  const maxBuy = sectorBuy.length ? Math.max(...sectorBuy.map((s) => s.buyPct)) : 0;

  return (
    <div className="space-y-12">
      <section>
        <div className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold">
          Valuation
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Valuation, price targets, and analyst ratings
        </h1>
        <p className="mt-3 text-[var(--text-muted)] max-w-3xl">
          Forward and trailing P/E for the index and itemized sectors, the bottom-up price target with implied upside,
          and the buy/hold/sell rating distribution. Wherever FactSet provides historical averages, they are shown
          alongside the current value.
        </p>
      </section>

      <section>
        <SectionHeader
          title="Index P/E ratios"
          subtitle="Current vs. 5-yr and 10-yr averages, plus end-of-quarter snapshot."
          source="FactSet Earnings Insight, pp. 29–32"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            label="Forward 12M P/E"
            value={valuation.fwdPe?.current}
            subline={`5-yr avg ${fmt(valuation.fwdPe?.avg5yr)} · 10-yr avg ${fmt(valuation.fwdPe?.avg10yr)} · End of Q ${fmt(valuation.fwdPe?.endOfQuarter)}`}
          />
          <StatCard
            label="Trailing 12M P/E"
            value={valuation.trailingPe?.current}
            subline={`5-yr avg ${fmt(valuation.trailingPe?.avg5yr)} · 10-yr avg ${fmt(valuation.trailingPe?.avg10yr)}`}
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Forward 12M P/E by sector"
          subtitle="Itemized sectors only — ones FactSet did not list this week are not shown."
          source="FactSet Earnings Insight, p. 30"
        />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          {sectorPe.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No sector P/E values parsed.</p>
          ) : (
            <div className="space-y-2">
              {sectorPe.map((s) => (
                <div key={s.sector} className="grid grid-cols-[200px_1fr] gap-4 items-center text-sm">
                  <span>{s.sector}</span>
                  <Bar value={s.fwdPe} max={maxPe} suffix="x" width={200} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <SectionHeader
          title="Bottom-up price target"
          subtitle="Aggregated analyst price target vs. current S&P 500 level."
          source="FactSet Earnings Insight, pp. 33–34"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Current S&P 500" value={targets.currentPrice} />
          <StatCard label="Bottom-up target" value={targets.bottomUpTarget} />
          <StatCard
            label="Implied upside"
            value={targets.upsidePct}
            suffix="%"
            hint="Aggregated from individual S&P 500 component targets"
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Implied upside by sector"
          subtitle="Sector-level upside FactSet itemized this week."
        />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          {sectorUpside.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No sector upside values parsed.</p>
          ) : (
            <div className="space-y-2">
              {sectorUpside.map((s) => (
                <div key={s.sector} className="grid grid-cols-[200px_1fr] gap-4 items-center text-sm">
                  <span>{s.sector}</span>
                  <Bar value={s.upsidePct} max={maxUpside} suffix="%" width={200} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <SectionHeader
          title="Analyst rating distribution"
          subtitle="Buy / Hold / Sell breakdown across all S&P 500 component ratings."
          source="FactSet Earnings Insight, p. 35"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Buy"
            value={ratings.buyPct}
            suffix="%"
            subline={`of ${ratings.totalRatings?.toLocaleString() ?? '—'} ratings`}
          />
          <StatCard label="Hold" value={ratings.holdPct} suffix="%" />
          <StatCard label="Sell" value={ratings.sellPct} suffix="%" />
        </div>
      </section>

      <section>
        <SectionHeader
          title="Buy %  by sector"
          subtitle="Share of analyst ratings classified as Buy, by sector."
        />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          {sectorBuy.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No sector buy-rating values parsed.</p>
          ) : (
            <div className="space-y-2">
              {sectorBuy.map((s) => (
                <div key={s.sector} className="grid grid-cols-[200px_1fr] gap-4 items-center text-sm">
                  <span>{s.sector}</span>
                  <Bar value={s.buyPct} max={maxBuy} suffix="%" width={200} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
