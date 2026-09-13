'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { API_URL } from '@/lib/api';

/**
 * A public status page.
 *
 * Deliberately outside the app shell and behind no login: the people who need it most are the
 * ones who cannot get in. Every check is run from the visitor's own browser against the live
 * endpoints, so what it reports is what they can actually reach — a status page that asks a
 * server whether it is up, and is answered by that same server, tells you nothing on the day it
 * matters. Nothing here is cached and nothing is stored.
 */

type State = 'checking' | 'up' | 'slow' | 'down';

interface Check {
  key: string;
  name: string;
  detail: string;
  url: string;
  /** Above this many milliseconds the service is reachable but not healthy. */
  slowMs: number;
  state: State;
  ms: number | null;
  note: string | null;
}

const INITIAL: Check[] = [
  { key: 'web', name: 'Web app', detail: 'The site itself, served from Render', url: '/health.txt', slowMs: 2000, state: 'checking', ms: null, note: null },
  { key: 'api', name: 'API', detail: 'Liveness — answers without touching the database', url: `${API_URL}/health`, slowMs: 3000, state: 'checking', ms: null, note: null },
  { key: 'db', name: 'Database', detail: 'Readiness — a real query against PostgreSQL', url: `${API_URL}/health/ready`, slowMs: 4000, state: 'checking', ms: null, note: null },
];

const TONE: Record<State, { dot: string; label: string; text: string }> = {
  checking: { dot: 'bg-slate-400', label: 'Checking…', text: 'text-slate-500' },
  up: { dot: 'bg-emerald-500', label: 'Operational', text: 'text-emerald-700 dark:text-emerald-400' },
  slow: { dot: 'bg-amber-500', label: 'Slow', text: 'text-amber-700 dark:text-amber-400' },
  down: { dot: 'bg-red-500', label: 'Unreachable', text: 'text-red-700 dark:text-red-400' },
};

export default function StatusPage() {
  const [checks, setChecks] = useState<Check[]>(INITIAL);
  const [version, setVersion] = useState<{ commit: string; builtAt: string } | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [running, setRunning] = useState(false);

  const runChecks = useCallback(async () => {
    setRunning(true);
    const results = await Promise.all(
      INITIAL.map(async (c) => {
        const t0 = performance.now();
        try {
          const res = await fetch(c.url, { cache: 'no-store' });
          const ms = Math.round(performance.now() - t0);
          // 503 from readiness is a real answer: the API is up and telling us the database is not.
          if (!res.ok) return { ...c, state: 'down' as State, ms, note: `HTTP ${res.status}` };
          return { ...c, state: (ms > c.slowMs ? 'slow' : 'up') as State, ms, note: null };
        } catch {
          return { ...c, state: 'down' as State, ms: Math.round(performance.now() - t0), note: 'No response' };
        }
      }),
    );
    setChecks(results);
    setLastRun(new Date());
    setRunning(false);

    try {
      const res = await fetch(`${API_URL}/health/version`, { cache: 'no-store' });
      if (res.ok) setVersion(await res.json());
    } catch {
      setVersion(null);
    }
  }, []);

  useEffect(() => {
    // Kicked off on a timer rather than inline: a check writes state, and state written while an
    // effect is still running is a render loop waiting to happen.
    const first = setTimeout(() => void runChecks(), 0);
    const timer = setInterval(() => void runChecks(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [runChecks]);

  const worst: State = checks.some((c) => c.state === 'down')
    ? 'down'
    : checks.some((c) => c.state === 'slow')
      ? 'slow'
      : checks.every((c) => c.state === 'up')
        ? 'up'
        : 'checking';

  const headline =
    worst === 'up'
      ? 'All systems operational'
      : worst === 'slow'
        ? 'Running, but slower than usual'
        : worst === 'down'
          ? 'Something is not reachable'
          : 'Checking…';

  return (
    <div className="min-h-dvh bg-background">
      <header className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-4">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <Image src="/brand/kramiq.png" alt="KramIQ" width={823} height={787} priority className="h-9 w-auto shrink-0" />
            <span className="h-7 w-px shrink-0 bg-sidebar-border" />
            <Image src="/brand/islington-logo-white.svg" alt="Islington College" width={170} height={40} priority className="h-9 w-auto shrink-0" />
          </Link>
          <Link href="/login" className="shrink-0 text-sm underline">Sign in</Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`h-3 w-3 shrink-0 rounded-full ${TONE[worst].dot} ${worst === 'checking' ? 'animate-pulse' : ''}`} />
          <h1 className="text-2xl font-semibold tracking-tight">{headline}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Checked from your browser against the live endpoints, so this reflects what you can reach rather than what a server says about itself. Re-runs every 30 seconds.
        </p>

        <div className="divide-y border">
          {checks.map((c) => (
            <div key={c.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TONE[c.state].dot}`} />
                  {c.name}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{c.detail}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-sm font-medium ${TONE[c.state].text}`}>{c.note ?? TONE[c.state].label}</p>
                <p className="text-xs tabular-nums text-muted-foreground">{c.ms === null ? '—' : `${c.ms} ms`}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="border p-4 text-sm">
          <p className="font-medium">About these numbers</p>
          <p className="mt-1 text-muted-foreground">
            The API and database run on Render&apos;s free tier, which stops an idle instance and starts it again on the next request.
            A first check after a quiet spell can take the better part of a minute and read as slow; that is the plan, not a fault.
          </p>
        </div>

        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">API</dt><dd className="truncate font-mono text-xs">{API_URL}</dd></div>
          <div><dt className="text-muted-foreground">Build</dt><dd className="font-mono text-xs">{version ? `${version.commit.slice(0, 7)} · ${version.builtAt.slice(0, 10)}` : '—'}</dd></div>
          <div><dt className="text-muted-foreground">Last checked</dt><dd className="tabular-nums">{lastRun ? lastRun.toLocaleTimeString() : '—'}</dd></div>
          <div>
            <dt className="text-muted-foreground">&nbsp;</dt>
            <dd>
              <button onClick={() => void runChecks()} disabled={running} className="underline disabled:opacity-50">
                {running ? 'Checking…' : 'Check again'}
              </button>
            </dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">
          KramIQ · RTE Integrated Management System · built by The Biggys for Islington Hackathon 2026.
        </p>
      </main>
    </div>
  );
}
