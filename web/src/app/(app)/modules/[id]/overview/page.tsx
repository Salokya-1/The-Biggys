'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, FileSpreadsheet, LifeBuoy, Printer, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, downloadWithAuth } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AtRisk, ModuleOverview } from '@/lib/types';

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

      <AtRiskPanel offeringId={id} />

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

/**
 * The students on this module who are actually struggling, and one button to lay on extra
 * teaching for exactly them — rather than repeating the material to a cohort that passed.
 */
function AtRiskPanel({ offeringId }: { offeringId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<{ date: string; minutes: number; reason: string } | null>(null);

  const q = useQuery({ queryKey: ['at-risk', offeringId], queryFn: () => api<AtRisk>(`/api/offerings/${offeringId}/at-risk`) });
  const create = useMutation({
    mutationFn: (f: { date: string; minutes: number; reason: string }) =>
      api<{ when: string; venueName: string; students: unknown[] }>(`/api/offerings/${offeringId}/support-class`, { method: 'POST', body: f }),
    onSuccess: (r) => {
      setForm(null);
      qc.invalidateQueries({ queryKey: ['at-risk', offeringId] });
      toast.success('Support class booked', { description: `${r.when} in ${r.venueName} — ${r.students.length} students told.`, duration: 9000 });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isPending || q.isError) return null;
  const students = q.data.students;

  return (
    <Card className="rounded-none">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">At risk on this module</CardTitle>
            <CardDescription>
              {students.length === 0
                ? 'Nobody is failing, resitting or borderline.'
                : `${students.length} of ${q.data.enrolled} students failed, are resitting, or are sitting under 45.`}
            </CardDescription>
          </div>
          {students.length > 0 && can('timetable.write') ? (
            <Button
              size="sm"
              onClick={() => setForm({ date: new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10), minutes: 60, reason: 'Extra support for the students at risk on this module' })}
            >
              <LifeBuoy className="mr-1 h-4 w-4" /> Lay on a support class
            </Button>
          ) : null}
        </div>
      </CardHeader>
      {students.length > 0 ? (
        <CardContent className="max-h-72 overflow-y-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Student ID</TableHead><TableHead>Name</TableHead><TableHead>Group</TableHead><TableHead>Why</TableHead></TableRow></TableHeader>
            <TableBody>
              {students.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.studentId}</TableCell>
                  <TableCell>{s.name}</TableCell>
                  <TableCell>{s.section ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{s.why}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      ) : null}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Support class for {students.length} students</DialogTitle>
            <DialogDescription>
              Pick the day. The first hour where the module&apos;s teacher and a suitable room are both free is taken, and everyone in the list is told.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
                <div className="space-y-1"><Label>Length (minutes)</Label><Input type="number" min={30} max={180} step={30} value={form.minutes} onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })} /></div>
              </div>
              <div className="space-y-1">
                <Label>What is it for?</Label>
                <Textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button disabled={!form?.date || create.isPending} onClick={() => form && create.mutate(form)}>{create.isPending ? 'Booking…' : 'Book and notify'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
