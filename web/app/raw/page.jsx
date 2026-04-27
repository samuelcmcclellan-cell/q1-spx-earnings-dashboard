import { dashboardData } from '../../lib/data.js';
import SectionHeader from '../../components/SectionHeader.jsx';

export const metadata = {
  title: 'Raw Data — Q1 2026 S&P 500 Earnings',
};

function flatten(obj, prefix = '', out = []) {
  if (obj === null || obj === undefined) {
    out.push({ path: prefix, value: obj, type: 'null' });
    return out;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      out.push({ path: prefix, value: '[]', type: 'array' });
      return out;
    }
    obj.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      out.push({ path: prefix, value: '{}', type: 'object' });
      return out;
    }
    keys.forEach((k) => {
      const next = prefix ? `${prefix}.${k}` : k;
      flatten(obj[k], next, out);
    });
    return out;
  }
  out.push({ path: prefix, value: obj, type: typeof obj });
  return out;
}

export default function RawPage() {
  const rows = flatten(dashboardData);

  return (
    <div className="space-y-8">
      <section>
        <div className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold">
          Raw Data
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Every parsed value, with its JSON path</h1>
        <p className="mt-3 text-[var(--text-muted)] max-w-3xl">
          The complete output of <code className="text-[var(--text)]">parse-factset.mjs</code> — flattened to one row
          per leaf. Use this to audit any number on any other page back to the FactSet source. Same data is in the
          downloadable <a href="/Q1_2026_Earnings_Dashboard.xlsx" download className="text-[var(--accent)] hover:underline">.xlsx workbook</a>{' '}
          on the <em>Raw Data</em> sheet.
        </p>
      </section>

      <SectionHeader
        title="Parsed values"
        subtitle={`${rows.length} leaves from ${dashboardData.meta.sourcePdf}`}
        source={`Parsed ${dashboardData.meta.parsedAt}`}
      />

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full text-sm font-mono">
          <thead>
            <tr className="text-left border-b border-[var(--border)] sticky top-0 bg-[var(--surface)]">
              <th className="px-4 py-3 font-medium text-[var(--text-muted)]">Path</th>
              <th className="px-4 py-3 font-medium text-[var(--text-muted)] text-right">Value</th>
              <th className="px-4 py-3 font-medium text-[var(--text-muted)] hidden sm:table-cell">Type</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.path + i}
                className={i % 2 === 0 ? 'bg-transparent' : 'bg-[var(--surface-2)]/40'}
              >
                <td className="px-4 py-2 text-[var(--text)] break-all">{r.path}</td>
                <td className="px-4 py-2 text-right tnum">
                  {r.value === null || r.value === undefined ? (
                    <span className="text-[var(--text-muted)]">null</span>
                  ) : typeof r.value === 'string' ? (
                    <span className="text-[var(--accent)]">"{r.value}"</span>
                  ) : (
                    String(r.value)
                  )}
                </td>
                <td className="px-4 py-2 text-[var(--text-muted)] hidden sm:table-cell">{r.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
