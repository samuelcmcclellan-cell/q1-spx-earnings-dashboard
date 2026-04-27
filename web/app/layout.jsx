import './globals.css';
import { dashboardData } from '../lib/data.js';
import Header from '../components/Header.jsx';
import PasswordGate from '../components/PasswordGate.jsx';

export const metadata = {
  title: 'Q1 2026 S&P 500 Earnings — FactSet Dashboard',
  description:
    'Weekly snapshot of S&P 500 Q1 2026 earnings results, sourced directly from FactSet Earnings Insight. Sector matrix, contributors, forward estimates, and valuation — without editorial framing.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <PasswordGate>
          <Header meta={dashboardData.meta} />
          <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">{children}</main>
          <footer className="border-t border-[var(--border)] mt-16">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 text-xs text-[var(--text-muted)]">
              Data parsed verbatim from FactSet Earnings Insight ({dashboardData.meta.sourcePdf}).
              Missing values shown as "—" rather than zero. No editorial framing applied.
            </div>
          </footer>
        </PasswordGate>
      </body>
    </html>
  );
}
