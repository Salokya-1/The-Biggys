'use client';

import Image from 'next/image';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { StudentProfile } from '@/lib/types';

/**
 * The results document a student actually hands to somebody.
 *
 * Printed rather than generated server-side as a PDF: the browser's own print dialogue already
 * produces a PDF on every platform the college uses, and one HTML document that looks right on
 * screen and on paper is far less to keep true than a second rendering pipeline that drifts from
 * the first. The page is laid out for A4, carries both crests, and states plainly that it is not
 * the sealed transcript — a printout that could be mistaken for an official document is worse
 * than no printout.
 */
export function Transcript({ profile }: { profile: StudentProfile }) {
  const s = profile.student;
  const published = profile.semesters.flatMap((sem) => sem.modules.filter((m) => m.result));
  const credits = published.reduce((n, m) => n + (m.result && m.result.outcome !== 'FAIL' ? m.module.credits : 0), 0);
  const weighted = published.filter((m) => m.result);
  const average = weighted.length ? Math.round((weighted.reduce((n, m) => n + m.result!.overallMark, 0) / weighted.length) * 10) / 10 : null;

  return (
    <>
      <div className="flex justify-end" data-print-hide>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Printer className="mr-1 h-4 w-4" /> Download results
        </Button>
      </div>

      {/* Only ever on paper: on screen the profile below already says all of this, better. */}
      <div className="print-only text-black">
        <header className="mb-6 flex items-start justify-between gap-6 border-b-2 border-black pb-4">
          <div className="flex items-center gap-4">
            <Image src="/brand/islington-logo.svg" alt="Islington College" width={220} height={52} className="h-14 w-auto" />
            <span className="h-12 w-px bg-black/25" />
            <Image src="/brand/kramiq-square.png" alt="KramIQ" width={96} height={96} className="h-12 w-12" />
          </div>
          <div className="text-right text-[11px] leading-relaxed">
            <p className="text-base font-semibold">Statement of Results</p>
            <p>Islington College · London Metropolitan University</p>
            <p>Issued {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </header>

        <section className="mb-5 grid grid-cols-2 gap-x-8 gap-y-1 text-[12px]">
          <p><span className="inline-block w-32 text-black/60">Name</span><span className="font-medium">{s.name}</span></p>
          <p><span className="inline-block w-32 text-black/60">Student ID</span><span className="font-mono font-medium">{s.studentId}</span></p>
          <p><span className="inline-block w-32 text-black/60">Programme</span><span className="font-medium">{s.programme.code} — {s.programme.name}</span></p>
          <p><span className="inline-block w-32 text-black/60">Intake</span><span className="font-medium">{s.intake.label}</span></p>
          <p><span className="inline-block w-32 text-black/60">Level</span><span className="font-medium">{s.programme.level}</span></p>
          <p><span className="inline-block w-32 text-black/60">Standing</span><span className="font-medium">{s.standing}</span></p>
        </section>

        <section className="mb-5 flex gap-8 border-y border-black/20 py-2 text-[12px]">
          <p><span className="text-black/60">Modules passed </span><span className="font-semibold">{profile.stats.passed}</span></p>
          <p><span className="text-black/60">Credits achieved </span><span className="font-semibold">{credits}</span></p>
          <p><span className="text-black/60">Average mark </span><span className="font-semibold">{average ?? '—'}</span></p>
          <p><span className="text-black/60">Resits </span><span className="font-semibold">{profile.stats.resits}</span></p>
        </section>

        {profile.semesters.map((sem) => (
          <section key={sem.number} className="print-keep mb-5">
            <h2 className="mb-1 text-[13px] font-semibold">Semester {sem.number}</h2>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-y border-black/30 text-left">
                  <th className="py-1 pr-2 font-semibold">Code</th>
                  <th className="py-1 pr-2 font-semibold">Module</th>
                  <th className="py-1 pr-2 text-right font-semibold">Credits</th>
                  <th className="py-1 pr-2 text-right font-semibold">Mark</th>
                  <th className="py-1 pr-2 font-semibold">Grade</th>
                  <th className="py-1 font-semibold">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {sem.modules.map((m) => (
                  <tr key={m.enrollmentId} className="border-b border-black/10">
                    <td className="py-1 pr-2 font-mono">{m.module.code}</td>
                    <td className="py-1 pr-2">{m.module.title}{m.isResit ? ' (resit)' : ''}</td>
                    <td className="py-1 pr-2 text-right">{m.module.credits}</td>
                    <td className="py-1 pr-2 text-right font-medium">{m.result ? m.result.overallMark : '—'}</td>
                    <td className="py-1 pr-2">{m.result?.grade ?? '—'}</td>
                    <td className="py-1">{m.result ? m.result.outcome : 'Awaiting publication'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        <footer className="mt-8 border-t border-black/30 pt-3 text-[10px] leading-relaxed text-black/70">
          <p>
            Produced by KramIQ, the RTE management system of Islington College, from records held at the date of issue.
            Only published results appear. This is a statement for the student&apos;s own reference and is <span className="font-semibold">not</span> a
            sealed academic transcript; official transcripts are issued by the RTE office on request.
          </p>
        </footer>
      </div>
    </>
  );
}
