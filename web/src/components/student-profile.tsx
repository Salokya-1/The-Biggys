'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AttendanceCard } from '@/components/attendance-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { OutcomeBadge, SheetStatusBadge, StandingBadge, StatusBadge } from '@/components/status-badges';
import type { StudentProfile } from '@/lib/types';

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

/** Shared between the staff view (/students/:id) and the student's own view (/me). */
export function StudentProfileView({ profile, forStudent }: { profile: StudentProfile; forStudent?: boolean }) {
  const s = profile.student;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{s.name}</h1>
          <p className="font-mono text-sm text-muted-foreground">{s.studentId}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.programme.code} · {s.programme.name} · Intake {s.intake.label}
            {s.currentSemester ? ` · Semester ${s.currentSemester.number}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={s.status} />
          <StandingBadge standing={s.standing} />
          {s.specialNeedsSeating && <Badge variant="outline">Special-needs seating</Badge>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        <Stat label="Modules taken" value={profile.stats.modulesTaken} />
        <Stat label="Passed" value={profile.stats.passed} />
        <Stat label="Failed" value={profile.stats.failed} />
        <Stat label="Resits" value={profile.stats.resits} />
        <Stat label={forStudent ? 'Awaiting publication' : 'Pending'} value={profile.stats.pending} />
      </div>

      <AttendanceCard studentId={s.id} />

      {profile.semesters.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No module enrolments yet.</CardContent>
        </Card>
      )}

      {profile.semesters.map((sem) => (
        <Card key={sem.number}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Semester {sem.number}</CardTitle>
            <CardDescription>
              {sem.summary.modules} module{sem.summary.modules === 1 ? '' : 's'} · {sem.summary.passed} passed · {sem.summary.failed} failed · {sem.summary.resit} resit · {sem.summary.pending} pending
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead className="text-right">Overall</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Outcome</TableHead>
                  {!forStudent && <TableHead>Sheet</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sem.modules.map((m) => (
                  <TableRow key={m.enrollmentId}>
                    <TableCell>
                      <div className="font-medium">{m.module.code} · {m.module.title}</div>
                      <div className="text-xs text-muted-foreground">{m.module.credits} credits{m.lecturer ? ` · ${m.lecturer}` : ''}</div>
                    </TableCell>
                    <TableCell>
                      {m.attempt}
                      {m.isResit && <Badge variant="outline" className="ml-2">Resit</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{m.result ? m.result.overallMark.toFixed(1) : '—'}</TableCell>
                    <TableCell>{m.result?.grade ?? '—'}</TableCell>
                    <TableCell>{m.result ? <OutcomeBadge outcome={m.result.outcome} /> : <span className="text-muted-foreground">Pending</span>}</TableCell>
                    {!forStudent && (
                      <TableCell>{m.result ? <SheetStatusBadge status={m.result.status} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
