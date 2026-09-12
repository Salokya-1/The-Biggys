'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ApiStatus } from '@/components/api-status';
import { SheetStatusBadge, StandingBadge } from '@/components/status-badges';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { MarkSheetStatus, Standing } from '@/lib/types';

interface Dashboard {
  generatedAt: string;
  counts: { students: number; programmes: number; modules: number; openSheets: number; publishedSheets: number };
  funnel: { counts: Record<string, number>; overdueDays: number; overdue: { id: string; status: MarkSheetStatus; module: string; cohort: string; since: string }[] };
  publication: { id: string; module: string; title: string; cohort: string; lecturer: string | null; status: MarkSheetStatus; version: number; marksEntered: number; marksExpected: number; missing: number; updatedAt: string; overdue: boolean }[];
  importErrorRate: number;
  exams: { id: string; title: string; date: string; startTime: string; candidates: number; capacity: number; seated: number; utilisation: number; ready: boolean }[];
  academic: {
    passRates: { code: string; title: string; latest: { intake: string; passRate: number; n: number; resits: number }; previous: { intake: string; passRate: number } | null; delta: number | null }[];
    resitVolume: number;
    atRisk: { count: number; review: number; students: { id: string; studentId: string; name: string; standing: Standing; programme: { code: string }; intake: { label: string }; currentSemester: { number: number } | null }[] };
  };
  dataQuality: {
    missingResults: { code: string; missing: number }[];
    studentsWithoutSemester: { id: string; studentId: string; name: string }[];
    withdrawnWithActiveLogin: number;
    duplicateNames: { name: string; n: number }[];
    mismatchedIntake: { id: string; studentId: string; name: string }[];
  };
  workload: { id: string; name: string; role: string; offerings: number; students: number; credits: number; modules: string[]; leads: number }[];
}

const FUNNEL: MarkSheetStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'CORRECTION_REQUESTED'];
const FUNNEL_COLOUR: Record<string, string> = { DRAFT: '#bababa', SUBMITTED: '#2f6aaf', UNDER_REVIEW: '#41448b', APPROVED: '#e37e3f', PUBLISHED: '#3aa76d', CORRECTION_REQUESTED: '#f4d32a' };

function Tile({ label, value, hint, warn }: { label: string; value: string | number; hint?: string; warn?: boolean }) {
  return (
    <Card className={cn("rounded-none", warn && "border-amber-300 dark:border-amber-800")}>
      <CardHeader className="pb-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
}

export default function DashboardPage() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/api/dashboard'), refetchInterval: 30_000 });
  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-8 w-72" /><div className="grid gap-4 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-64" /></div>;
  if (q.isError) return <Alert variant="destructive"><AlertDescription>{(q.error as Error).message}</AlertDescription></Alert>;
  const d = q.data;
  const funnelData = FUNNEL.map((s) => ({ status: s.replace('_', ' '), key: s, count: d.funnel.counts[s] ?? 0 }));
  const dq = d.dataQuality;
  const dqTotal = dq.missingResults.reduce((n, m) => n + m.missing, 0) + dq.studentsWithoutSemester.length + dq.withdrawnWithActiveLogin + dq.duplicateNames.length + dq.mismatchedIntake.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operations dashboard</h1>
          <p className="text-sm text-muted-foreground">Live view of result processing, exam readiness, academic risk and data quality. Refreshes every 30 s.</p>
        </div>
        <span className="text-xs text-muted-foreground">Generated {new Date(d.generatedAt).toLocaleTimeString()}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Active students" value={d.counts.students} hint={`${d.counts.programmes} programmes · ${d.counts.modules} modules`} />
        <Tile label="Sheets in pipeline" value={d.counts.openSheets} hint={`${d.counts.publishedSheets} published`} />
        <Tile label="Overdue in review" value={d.funnel.overdue.length} hint={`> ${d.funnel.overdueDays} days without action`} warn={d.funnel.overdue.length > 0} />
        <Tile label="At-risk students" value={d.academic.atRisk.count} hint={`${d.academic.atRisk.review} under review · ${d.academic.resitVolume} resit enrolments`} warn={d.academic.atRisk.review > 0} />
        <Tile label="Data-quality issues" value={dqTotal} hint={`import error rate ${d.importErrorRate}%`} warn={dqTotal > 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-none lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Result-processing funnel</CardTitle><CardDescription>Mark sheets by pipeline state. Click a state on the Mark sheets page to work the queue.</CardDescription></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="status" tick={{ fontSize: 11 }} interval={0} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip cursor={{ fill: 'transparent' }} />
                <Bar dataKey="count" radius={[0, 0, 0, 0]}>
                  {funnelData.map((f) => <Cell key={f.key} fill={FUNNEL_COLOUR[f.key]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">Overdue</CardTitle><CardDescription>Waiting more than {d.funnel.overdueDays} days in a review state</CardDescription></CardHeader>
          <CardContent className="max-h-64 space-y-2 overflow-y-auto text-sm">
            {d.funnel.overdue.length === 0 && <p className="text-muted-foreground">Nothing overdue.</p>}
            {d.funnel.overdue.map((o) => (
              <Link key={o.id} href={`/marksheets/${o.id}`} className="flex items-center justify-between rounded-none border p-2 hover:bg-muted">
                <span><span className="font-medium">{o.module}</span> <span className="text-muted-foreground">{o.cohort}</span></span>
                <span className="flex items-center gap-2"><SheetStatusBadge status={o.status} /><span className="text-xs text-muted-foreground">{Math.floor((new Date(d.generatedAt).getTime() - new Date(o.since).getTime()) / 86400e3)}d</span></span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-none">
        <CardHeader className="pb-2"><CardTitle className="text-base">Publication status</CardTitle><CardDescription>Every open mark sheet, with missing marks and who holds it</CardDescription></CardHeader>
        <CardContent className="max-h-72 overflow-y-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Module</TableHead><TableHead>Cohort</TableHead><TableHead>Lecturer</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Marks</TableHead><TableHead className="text-right">Missing</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.publication.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No open mark sheets.</TableCell></TableRow>}
              {d.publication.map((p) => (
                <TableRow key={p.id} className={p.overdue ? 'bg-amber-50/60 dark:bg-amber-950/20' : undefined}>
                  <TableCell><Link href={`/marksheets/${p.id}`} className="font-medium hover:underline">{p.module}</Link> <span className="text-xs text-muted-foreground">v{p.version}</span></TableCell>
                  <TableCell className="text-xs">{p.cohort}</TableCell>
                  <TableCell>{p.lecturer ?? '—'}</TableCell>
                  <TableCell><SheetStatusBadge status={p.status} /></TableCell>
                  <TableCell className="text-right font-mono text-xs">{p.marksEntered}/{p.marksExpected}</TableCell>
                  <TableCell className="text-right">{p.missing > 0 ? <Badge variant="outline" className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{p.missing}</Badge> : <span className="text-muted-foreground">0</span>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(p.updatedAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">Exam readiness</CardTitle><CardDescription>Upcoming sessions: seating generated and venue utilisation</CardDescription></CardHeader>
          <CardContent className="max-h-64 space-y-2 overflow-y-auto text-sm">
            {d.exams.length === 0 && <p className="text-muted-foreground">No upcoming sessions.</p>}
            {d.exams.map((e) => (
              <Link key={e.id} href={`/exams/${e.id}`} className="block rounded-none border p-3 hover:bg-muted">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{e.title}</span>
                  {e.ready ? <Badge variant="outline" className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">Seated</Badge> : <Badge variant="outline" className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Seating pending</Badge>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{new Date(e.date).toLocaleDateString()} {e.startTime} · {e.candidates} candidates · capacity {e.capacity} · utilisation {e.utilisation}%</div>
                <div className="mt-2 h-1.5 w-full rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${Math.min(100, e.utilisation)}%` }} /></div>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">Faculty workload (current semesters)</CardTitle><CardDescription>Teaching load per lecturer — offerings, students and credits</CardDescription></CardHeader>
          <CardContent className="max-h-72 overflow-y-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Staff</TableHead><TableHead className="text-right">Offerings</TableHead><TableHead className="text-right">Students</TableHead><TableHead className="text-right">Credits</TableHead><TableHead>Modules</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.workload.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell><div className="font-medium">{w.name}</div><div className="text-xs text-muted-foreground">{w.role.replace('_', ' ')}{w.leads ? ` · leads ${w.leads}` : ''}</div></TableCell>
                    <TableCell className="text-right">{w.offerings}</TableCell>
                    <TableCell className="text-right">{w.students}</TableCell>
                    <TableCell className="text-right">{w.credits}</TableCell>
                    <TableCell className="text-xs">{w.modules.join(', ') || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">Pass rate by module</CardTitle><CardDescription>Latest published offering vs the previous cohort (first attempts)</CardDescription></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.academic.passRates.map((p) => ({ code: p.code, latest: p.latest.passRate, previous: p.previous?.passRate ?? 0 }))} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="code" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip cursor={{ fill: 'transparent' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="previous" name="Previous" fill="#bababa" radius={[0, 0, 0, 0]} />
                <Bar dataKey="latest" name="Latest" fill="#41448b" radius={[0, 0, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">Biggest movers</CardTitle><CardDescription>Pass-rate change against the previous offering</CardDescription></CardHeader>
          <CardContent className="max-h-72 overflow-y-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Module</TableHead><TableHead className="text-right">Latest</TableHead><TableHead className="text-right">Previous</TableHead><TableHead className="text-right">Δ</TableHead></TableRow></TableHeader>
              <TableBody>
                {[...d.academic.passRates].filter((p) => p.delta !== null).sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!)).slice(0, 8).map((p) => (
                  <TableRow key={p.code}>
                    <TableCell><div className="font-medium">{p.code}</div><div className="text-xs text-muted-foreground">{p.title}</div></TableCell>
                    <TableCell className="text-right">{p.latest.passRate}% <span className="text-xs text-muted-foreground">({p.latest.intake})</span></TableCell>
                    <TableCell className="text-right">{p.previous?.passRate}%</TableCell>
                    <TableCell className={`text-right font-medium ${p.delta! < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      <span className="inline-flex items-center gap-1">{p.delta! < 0 ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}{p.delta! > 0 ? '+' : ''}{p.delta}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">At-risk students</CardTitle><CardDescription>Under review (any fail or two outstanding resits) or with one outstanding resit</CardDescription></CardHeader>
          <CardContent className="max-h-72 overflow-y-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Cohort</TableHead><TableHead>Standing</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.academic.atRisk.students.length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-muted-foreground">No students at risk.</TableCell></TableRow>}
                {d.academic.atRisk.students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell><Link href={`/students/${s.id}`} className="font-medium hover:underline">{s.name}</Link><div className="font-mono text-xs text-muted-foreground">{s.studentId}</div></TableCell>
                    <TableCell className="text-xs">{s.programme.code} {s.intake.label}{s.currentSemester ? ` S${s.currentSemester.number}` : ''}</TableCell>
                    <TableCell><StandingBadge standing={s.standing} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {d.academic.atRisk.count > d.academic.atRisk.students.length && <p className="mt-2 text-xs text-muted-foreground">Showing {d.academic.atRisk.students.length} of {d.academic.atRisk.count}. <Link href="/students?standing=REVIEW" className="underline">Open the directory</Link>.</p>}
          </CardContent>
        </Card>
        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">Data quality</CardTitle><CardDescription>What the spreadsheets were hiding — surfaced, not silently fixed</CardDescription></CardHeader>
          <CardContent className="max-h-72 space-y-3 overflow-y-auto text-sm">
            {dqTotal === 0 && <p className="text-muted-foreground">No issues detected.</p>}
            {dq.missingResults.map((m) => (
              <div key={m.code} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span><strong>{m.missing}</strong> published enrolment{m.missing === 1 ? '' : 's'} on <strong>{m.code}</strong> without a result (marks never completed)</span></div>
            ))}
            {dq.studentsWithoutSemester.length > 0 && (
              <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span><strong>{dq.studentsWithoutSemester.length}</strong> active student{dq.studentsWithoutSemester.length === 1 ? '' : 's'} with no current semester: {dq.studentsWithoutSemester.map((s) => <Link key={s.id} href={`/students/${s.id}`} className="underline">{s.studentId}</Link>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ', ', el] : [el]), [])}</span></div>
            )}
            {dq.mismatchedIntake.length > 0 && (
              <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span><strong>{dq.mismatchedIntake.length}</strong> student{dq.mismatchedIntake.length === 1 ? '' : 's'} whose intake belongs to a different programme: {dq.mismatchedIntake.map((s) => <Link key={s.id} href={`/students/${s.id}`} className="underline">{s.studentId}</Link>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ', ', el] : [el]), [])}</span></div>
            )}
            {dq.withdrawnWithActiveLogin > 0 && (
              <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span><strong>{dq.withdrawnWithActiveLogin}</strong> withdrawn student{dq.withdrawnWithActiveLogin === 1 ? '' : 's'} still with an active login</span></div>
            )}
            {dq.duplicateNames.map((n) => (
              <div key={n.name} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span>Possible duplicate: <strong>{n.name}</strong> appears {n.n} times with different IDs</span></div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="max-w-md"><ApiStatus /></div>
    </div>
  );
}
