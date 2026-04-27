'use client';

import { useEffect, useState } from 'react';

const PASSWORD = 'Factset';
const STORAGE_KEY = 'q1-spx-earnings-auth';

// Soft gate only — the password lives in the client bundle and the underlying
// data is in the public GitHub repo. This is a "don't show it to randos"
// barrier, not real authentication.

export default function PasswordGate({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'locked' | 'unlocked'
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      setStatus(stored === 'ok' ? 'unlocked' : 'locked');
    } catch {
      setStatus('locked');
    }
  }, []);

  function onSubmit(e) {
    e.preventDefault();
    if (input === PASSWORD) {
      try {
        sessionStorage.setItem(STORAGE_KEY, 'ok');
      } catch {}
      setStatus('unlocked');
      setError(false);
    } else {
      setError(true);
    }
  }

  if (status === 'loading') {
    return <div className="min-h-screen" />;
  }

  if (status === 'unlocked') {
    return children;
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="text-xs uppercase tracking-wider text-[var(--accent)] font-semibold">
          Restricted
        </div>
        <h1 className="mt-2 text-xl font-semibold">S&amp;P 500 Earnings Dashboard</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Enter the password to continue.
        </p>
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <input
            type="password"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (error) setError(false);
            }}
            autoFocus
            placeholder="Password"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] transition-colors"
          />
          {error && (
            <div className="text-xs text-[var(--accent)]">Incorrect password.</div>
          )}
          <button
            type="submit"
            className="w-full rounded-md bg-[var(--accent-strong)] hover:bg-[var(--accent)] text-white px-3 py-2 text-sm font-medium transition-colors"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
