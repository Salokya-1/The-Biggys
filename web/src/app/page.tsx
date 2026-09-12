import Image from 'next/image';
import Link from 'next/link';
import { ApiStatus } from '@/components/api-status';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

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
    <div className="min-h-screen bg-background">
      <header className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="flex min-w-0 items-center gap-3">
            <Image src="/brand/islington-logo-white.svg" alt="Islington College" width={170} height={40} priority className="h-10 w-auto shrink-0" />
            <span className="h-8 w-px shrink-0 bg-sidebar-border" />
            <Image src="/brand/kramiq-square.png" alt="KramIQ by The Biggys" width={80} height={80} priority className="h-10 w-10 shrink-0" />
          </span>
          <div className="flex items-center gap-2">
            <ThemeToggle inverse />
            <Button size="sm" className="bg-brand-orange text-white hover:bg-brand-orange/90" render={<Link href="/login" />}>
              Staff sign in
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-14">
        <section className="flex flex-col items-center gap-3 text-center sm:items-start sm:text-left">
          {/* The mark is the first thing on the page: it is the name people will remember. */}
          <Image
            src="/brand/kramiq.png"
            alt="KramIQ by The Biggys"
            width={823}
            height={787}
            priority
            className="h-40 w-auto max-w-full sm:h-56"
          />
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-blue">Islington Hackathon 2026 · Team The Biggys</p>
          <h1 className="text-4xl font-bold tracking-tight text-primary sm:text-5xl">
            KramIQ <span className="block text-2xl font-semibold uppercase tracking-tight text-muted-foreground sm:text-3xl">RTE Integrated Management System</span>
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            One source of truth for student records, result processing and examination seating — replacing the RTE Department&apos;s isolated
            spreadsheets with a validated, approval-gated, auditable workflow.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Button render={<Link href="/login" />}>Open the system</Button>
            <Button variant="outline" render={<a href="https://github.com/Salokya-1/The-Biggys" />}>Source on GitHub</Button>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {pillars.map((p) => (
            <article key={p.title} className="border-t-4 border-primary bg-card p-5 shadow-sm">
              <h2 className="mb-2 font-semibold uppercase tracking-wide text-primary">{p.title}</h2>
              <p className="text-sm text-muted-foreground">{p.body}</p>
            </article>
          ))}
        </section>

        <section className="max-w-md">
          <ApiStatus />
        </section>
      </main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        Prototype for Islington College&apos;s RTE Department · London Metropolitan University programmes · seeded, fictional data
      </footer>
    </div>
  );
}
