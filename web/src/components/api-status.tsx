'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

type Ready = { status: 'ok' | 'degraded'; checks: { db: string; latencyMs?: number }; error?: string };
type Version = { commit: string; builtAt: string };

type State =
  | { kind: 'loading' }
  | { kind: 'down'; error: string }
  | { kind: 'up'; ready: Ready; version: Version | null; checkedAt: Date };

/** System-status widget: proves the API and DB are live and which commit is deployed. */
export function ApiStatus() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 5000);
        const [readyRes, versionRes] = await Promise.all([
          fetch(`${API}/health/ready`, { signal: controller.signal, cache: 'no-store' }),
          fetch(`${API}/health/version`, { signal: controller.signal, cache: 'no-store' }).catch(() => null),
        ]);
        clearTimeout(t);
        const ready = (await readyRes.json()) as Ready;
        const version = versionRes && versionRes.ok ? ((await versionRes.json()) as Version) : null;
        if (!cancelled) setState({ kind: 'up', ready, version, checkedAt: new Date() });
      } catch (err) {
        if (!cancelled) setState({ kind: 'down', error: (err as Error).message });
      }
    }
    void check();
    const id = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const dot = (ok: boolean | null) =>
    ok === null ? 'bg-zinc-400' : ok ? 'bg-emerald-500' : 'bg-red-500';

  if (state.kind === 'loading') {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        Checking system status…
      </div>
    );
  }

  if (state.kind === 'down') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950">
        <div className="flex items-center gap-2 font-medium text-red-700 dark:text-red-300">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot(false)}`} /> API unreachable
        </div>
        <p className="mt-1 text-red-600 dark:text-red-400/80 dark:text-red-300/80">
          {API} — {state.error}
        </p>
      </div>
    );
  }

  const apiOk = true;
  const dbOk = state.ready.checks.db === 'ok';
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 font-medium text-zinc-900 dark:text-zinc-100">System status</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-zinc-600 dark:text-zinc-400">
        <dt className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot(apiOk)}`} /> API
        </dt>
        <dd>{apiOk ? 'ok' : 'down'}</dd>
        <dt className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot(dbOk)}`} /> Database
        </dt>
        <dd>
          {dbOk ? `ok · ${state.ready.checks.latencyMs ?? '?'} ms` : `degraded${state.ready.error ? ` · ${state.ready.error}` : ''}`}
        </dd>
        <dt>Commit</dt>
        <dd className="font-mono">{state.version?.commit?.slice(0, 7) ?? 'unknown'}</dd>
        <dt>Built</dt>
        <dd>{state.version?.builtAt ?? '—'}</dd>
        <dt>Checked</dt>
        <dd>{state.checkedAt.toLocaleTimeString()}</dd>
      </dl>
    </div>
  );
}
