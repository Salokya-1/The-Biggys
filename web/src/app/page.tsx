import Link from 'next/link';
import { ApiStatus } from '@/components/api-status';

const pillars = [
  {
    title: 'Validated result pipeline',
    body: 'Marks entry and spreadsheet import with row-level validation, automated grading, module-leader approval and controlled publication — every change audited.',
  },
  {
    title: 'Conflict-free exam seating',
    body: 'Venue grids, automated allocation that keeps same-module students apart, special-needs placement, printable seating sheets and door lists.',
  },
  {
    title: 'Live operations dashboard',
    body: 'Result-processing funnel, publication status, exam readiness, pass rates, at-risk students and data-quality indicators for leadership.',
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Islington Hackathon 2026 · Team The Biggys
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl">
          RTE Integrated Management System
        </h1>
        <p className="max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
          One source of truth for student records, result processing and examination seating — replacing
          the RTE Department&apos;s isolated spreadsheets with a validated, approval-gated, auditable
          workflow.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Staff sign in
          </Link>
          <a
            href="https://github.com/Salokya-1/The-Biggys"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Source on GitHub
          </a>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {pillars.map((p) => (
          <article
            key={p.title}
            className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 className="mb-2 font-semibold text-zinc-900 dark:text-zinc-100">{p.title}</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{p.body}</p>
          </article>
        ))}
      </section>

      <section className="max-w-md">
        <ApiStatus />
      </section>
    </main>
  );
}
