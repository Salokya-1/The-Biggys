'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, FileSpreadsheet, Printer, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api, downloadWithAuth } from '@/lib/api';
import type { ModuleOverview } from '@/lib/types';

const GRADE_COLOUR: Record<string, string> = { A: '#2f6aaf', B: '#41448b', C: '#e37e3f', D: '#f4d32a', F: '#ce2626' };
const OUTCOME_COLOUR: Record<string, string> = { Passed: '#2f6aaf', Resits: '#e37e3f', Failed: '#ce2626', Deferred: '#767676', Awaiting: '#a3a3a3' };

/** One headline number. Square corners, like the rest of the dashboard tiles. */
function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="rounded-none">
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function ModuleOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['module-overview', id], queryFn: () => api<ModuleOverview>(`/api/offerings/${id}/overview`) });

  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-8 w-96" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError) return <Alert variant="destructive"><AlertDescription>{(q.error as Error).message}</AlertDescription></Alert>;

  const d = q.data;
  const o = d.offering;
  const s = d.stats;
  const outcomes = [
    { name: 'Passed', value: s.passed },
    { name: 'Resits', value: s.resits },
    { name: 'Failed', value: s.failed },
    { name: 'Deferred', value: s.deferred },
    { name: 'Awaiting', value: s.awaiting },
  ].filter((x) => x.value > 0);

  return (
    <div className="space-y-4">
      <Link href="/modules" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline print:hidden"><ArrowLeft className="h-4 w-4" /> Modules</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{o.module.code} · {o.module.title}</h1>
          <p className="text-sm text-muted-foreground">
            Module overview · {o.programme.code} {o.intake} · Semester {o.semester.number} ({o.semester.term.toLowerCase()}) · {o.module.credits} credits
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Taught by {o.teachers.map((t) => t.name).join(' and ') || '—'}
            {o.moduleLeader ? ` · led by ${o.moduleLeader}` : ''}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Link href={`/modules/${id}/class-list`}><Button size="sm" variant="outline"><Users className="mr-1 h-4 w-4" /> Class list</Button></Link>
          <Button
            size="sm"
            onClick={() => downloadWithAuth(`/api/offerings/${id}/report.xlsx`, `${o.module.code}-report.xlsx`).catch((e: Error) => toast.error(e.message))}
          >
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel report
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" /> Print</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Stat label="Enrolled" value={s.enrolled} hint={`${s.sections} sections`} />
        <Stat label="Pass rate" value={s.passRate === null ? '—' : `${s.passRate}%`} hint={`${s.passed} of ${s.withResult} results`} />
        <Stat label="Average" value={s.average ?? '—'} hint={s.highest === null ? 'no marks yet' : `${s.lowest}–${s.highest}`} />
        <Stat label="Resits" value={s.resits} hint={`${s.resitEnrolments} resit enrolments`} />
        <Stat label="Failed" value={s.failed} />
        <Stat label="Awaiting" value={s.awaiting} hint={`${s.published} published`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-none lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Marks distribution</CardTitle>
            <CardDescription>Every recorded result, in ten-point bands. This is the shape a moderation meeting asks to see.</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            {s.withResult === 0 ? (
              <p className="pt-8 text-center text-sm text-muted-foreground">No results recorded yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.bands} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                  <XAxis dataKey="band" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip cursor={{ fill: 'transparent' }} />
                  <Bar dataKey="students" name="Students">
                    {d.bands.map((b) => <Cell key={b.band} fill={b.from < 40 ? '#ce2626' : b.from < 60 ? '#e37e3f' : '#2f6aaf'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">Outcomes</CardTitle><CardDescription>Where the cohort stands</CardDescription></CardHeader>
          <CardContent className="h-64">
            {outcomes.length === 0 ? (
              <p className="pt-8 text-center text-sm text-muted-foreground">Nothing to show yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={outcomes} dataKey="value" nameKey="name" innerRadius={40} outerRadius={72} paddingAngle={1}>
                    {outcomes.map((x) => <Cell key={x.name} fill={OUTCOME_COLOUR[x.name]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">Grades</CardTitle><CardDescription>Awarded grade bands</CardDescription></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.grades} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="grade" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip cursor={{ fill: 'transparent' }} />
                <Bar dataKey="students" name="Students">
                  {d.grades.map((g) => <Cell key={g.grade} fill={GRADE_COLOUR[g.grade] ?? '#767676'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">Section averages</CardTitle><CardDescription>A section well below the others is worth a conversation, not an accusation.</CardDescription></CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.bySection} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="section" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="average" name="Average" stroke="#41448b" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-none">
        <CardHeader className="pb-2"><CardTitle className="text-base">By section</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Section</TableHead><TableHead className="text-right">Students</TableHead><TableHead className="text-right">Passed</TableHead><TableHead className="text-right">Resits</TableHead><TableHead className="text-right">Failed</TableHead><TableHead className="text-right">Average</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {d.bySection.map((b) => (
                <TableRow key={b.section}>
                  <TableCell className="font-medium">{b.section}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.students}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.passed}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.resits}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.failed}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.average ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">Assessment components</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Component</TableHead><TableHead className="text-right">Weight</TableHead><TableHead className="text-right">Average</TableHead><TableHead className="text-right">Marked</TableHead><TableHead className="text-right">Absent</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.components.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}<span className="ml-1 text-xs text-muted-foreground">/{c.maxMark}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{c.weight}%</TableCell>
                    <TableCell className="text-right tabular-nums">{c.averagePercent === null ? '—' : `${c.averagePercent}%`}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.marked}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.absent}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">Weekly classes</CardTitle><CardDescription>{d.classes.length} classes a week across {s.sections} sections</CardDescription></CardHeader>
          <CardContent className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Kind</TableHead><TableHead>Section</TableHead><TableHead>When</TableHead><TableHead>Room</TableHead><TableHead>Teacher</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.classes.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell><Badge variant="outline" className="rounded-none">{c.kindLabel}</Badge></TableCell>
                    <TableCell>{c.section}</TableCell>
                    <TableCell className="whitespace-nowrap">{c.day} {c.startTime}–{c.endTime}</TableCell>
                    <TableCell>{c.venue ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap">{c.teacher}</TableCell>
                  </TableRow>
                ))}
                {d.classes.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No routine generated for this semester yet.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
