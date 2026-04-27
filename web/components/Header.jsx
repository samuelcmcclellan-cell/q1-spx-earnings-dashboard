import Link from 'next/link';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/sectors/', label: 'Sectors' },
  { href: '/companies/', label: 'Companies' },
  { href: '/forward/', label: 'Forward' },
  { href: '/valuation/', label: 'Valuation' },
  { href: '/raw/', label: 'Raw Data' },
];

export default function Header({ meta }) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-6">
        <Link href="/" className="flex items-baseline gap-2 shrink-0">
          <span className="text-sm font-semibold tracking-wide">S&amp;P 500 EARNINGS</span>
          <span className="text-xs text-[var(--text-muted)]">{meta.quarter}</span>
        </Link>

        <nav className="flex items-center gap-1 text-sm overflow-x-auto">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 shrink-0">
          <div className="hidden sm:block text-right">
            <div className="text-xs text-[var(--text-muted)]">FactSet as-of</div>
            <div className="text-sm font-medium tnum">{meta.asOfDate ?? '—'}</div>
          </div>
          <a
            href="/Q1_2026_Earnings_Dashboard.xlsx"
            download
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-strong)] hover:bg-[var(--accent)] text-white px-3 py-1.5 text-sm font-medium transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>.xlsx</span>
          </a>
        </div>
      </div>
    </header>
  );
}
