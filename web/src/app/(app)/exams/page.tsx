'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarRange, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiError, api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { YEARS, semestersInYear, yearAndSemester, yearLabel, yearOfSemester } from '@/lib/academic-year';
import { cn } from '@/lib/utils';
import type { ExamSessionListItem, Venue } from '@/lib/types';

interface Offering {
  id: string;
  module: { code: string; title: string };
  semester: { id: string; number: number; intake: { id: string; label: string; programme: { code: string } } };
  _count: { enrollments: number };
}
interface Semester {
  id: string;
  number: number;
  term: string;
  examStart: string;
  intake: { label: string; programme: { code: string } };
  sections: { id: string; name: string }[];
  _count: { slots: number; examSessions: number };
}
interface Teacher {
  id: string;
  name: string;
}
type Session = ExamSessionListItem & { kind: 'FINAL' | 'CLASS_TEST' | 'RESIT'; seatingMode: 'MIXED' | 'BY_ID'; generatedBy: string | null; invigilators: { user: { name: string }; venue: { name: string } }[]; sections: { name: string }[] };

const KIND_STYLE = { FINAL: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200', CLASS_TEST: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200', RESIT: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200' };

export default function ExamsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api<Session[]>('/api/exams') });
  // The timetable's "Add exam" button links here with ?new=1, so the form is already open.
  const search = useSearchParams();
  const [open, setOpen] = useState(search.get('new') === '1');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const offerings = useQuery({ queryKey: ['offerings'], queryFn: () => api<Offering[]>('/api/offerings'), enabled: open });
  const venues = useQuery({ queryKey: ['venues'], queryFn: () => api<Venue[]>('/api/venues'), enabled: open });
  const teachers = useQuery({ queryKey: ['tt', 'teachers'], queryFn: () => api<Teacher[]>('/api/timetable/teachers'), enabled: open });
  const semesters = useQuery({ queryKey: ['tt', 'semesters'], queryFn: () => api<Semester[]>('/api/timetable/semesters'), enabled: open || scheduleOpen });
  const [form, setForm] = useState({ title: '', kind: (isAdmin ? 'FINAL' : 'CLASS_TEST') as 'FINAL' | 'CLASS_TEST' | 'RESIT', seatingMode: 'MIXED' as 'MIXED' | 'BY_ID', date: '', startTime: '09:00', durationMin: 120, seed: 1, offeringIds: [] as string[], venueIds: [] as string[], sectionIds: [] as string[], invigilators: {} as Record<string, string> });
  const [scheduleSemester, setScheduleSemester] = useState('');
  // People ask for "the second years", not "semesters three and four". Year narrows the list;
  // semester stays available inside it, because an exam belongs to one semester and half a year's
  // sittings are not the same thing as the year's.
  const [year, setYear] = useState('all');
  const [semester, setSemester] = useState('all');

  // sections available = sections of the intakes of the chosen offerings
  const sectionOptions = useMemo(() => {
    const intakeIds = new Set((offerings.data ?? []).filter((o) => form.offeringIds.includes(o.id)).map((o) => o.semester.intake.id));
    return (semesters.data ?? []).filter((s) => intakeIds.size && [...intakeIds].some((id) => (offerings.data ?? []).some((o) => o.semester.intake.id === id && o.semester.id === s.id))).flatMap((s) => s.sections.map((sec) => ({ ...sec, label: `${s.intake.programme.code} ${s.intake.label} · Section ${sec.name}` })));
  }, [offerings.data, semesters.data, form.offeringIds]);

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/api/exams', {
        method: 'POST',
        body: {
          ...form,
          durationMin: Number(form.durationMin),
          seed: Number(form.seed),
          sectionIds: form.sectionIds.length ? form.sectionIds : undefined,
          invigilators: Object.entries(form.invigilators).filter(([, u]) => u).map(([venueId, userId]) => ({ venueId, userId })),
          semesterId: (offerings.data ?? []).find((o) => o.id === form.offeringIds[0])?.semester.id,
        },
      }),
    onSuccess: () => {
      toast.success('Exam session created');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['exams'] });
      void qc.invalidateQueries({ queryKey: ['tt'] });
    },
    onError: (e) => toast.error(e instanceof ApiError && e.details && typeof e.details === 'object' && 'clashes' in e.details ? `${e.message}: ${(e.details as { clashes: string[] }).clashes.join('; ')}` : e instanceof Error ? e.message : 'Failed'),
  });

  const schedule = useMutation({
    mutationFn: (replace: boolean) => api<{ sessions: number; unscheduled: unknown[]; warnings: string[]; examStart: string; examEnd: string }>('/api/exams/schedule/generate', { method: 'POST', body: { semesterId: scheduleSemester, replace } }),
    onSuccess: (r) => {
      toast.success(`${r.sessions} exams scheduled between ${r.examStart.slice(0, 10)} and ${r.examEnd.slice(0, 10)}${r.unscheduled.length ? ` · ${r.unscheduled.length} could not be placed` : ''}${r.warnings.length ? ` · ${r.warnings.length} warnings` : ''}`);
      setScheduleOpen(false);
      void qc.invalidateQueries({ queryKey: ['exams'] });
      void qc.invalidateQueries({ queryKey: ['tt'] });
    },
    onError: (e, replace) => {
      if (e instanceof ApiError && e.status === 409 && !replace && confirm(`${e.message}\n\nRegenerate and replace the existing final exams?`)) schedule.mutate(true);
      else toast.error(e instanceof Error ? e.message : 'Failed');
    },
  });

  // 74 offerings and 52 rooms is too many to hunt through by eye.
  // Only offer people who can really stand in the room: not teaching, not already invigilating,
  // and not the ones who teach the module being examined.
  const freeQuery = qs({ date: form.date, startTime: form.startTime, durationMin: form.durationMin, offeringIds: form.offeringIds.join(',') || undefined });
  const freeInvigilators = useQuery({
    queryKey: ['free-invigilators', freeQuery],
    queryFn: () => api<{ free: { id: string; name: string }[]; busy: { id: string; name: string; busyBecause: string }[] }>(`/api/exams/free-invigilators${freeQuery}`),
    enabled: !!form.date && !!form.startTime,
  });
  const [moduleQuery, setModuleQuery] = useState('');
  const [venueQuery, setVenueQuery] = useState('');
  const matches = (needle: string, ...hay: (string | number | undefined)[]) =>
    !needle.trim() || hay.filter(Boolean).join(' ').toLowerCase().includes(needle.trim().toLowerCase());
  const toggle = (key: 'offeringIds' | 'venueIds' | 'sectionIds', id: string, on: boolean) => setForm((f) => ({ ...f, [key]: on ? [...f[key], id] : f[key].filter((x) => x !== id) }));

  /** An exam's year comes from the semester its modules sit in; a session spans only one. */
  const semesterOf = (e: ExamSessionListItem) => e.offerings[0]?.semester.number ?? null;
  const shown = (exams.data ?? []).filter((e) => {
    const n = semesterOf(e);
    if (n === null) return year === 'all';
    if (year !== 'all' && yearOfSemester(n) !== Number(year)) return false;
    if (semester !== 'all' && n !== Number(semester)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Exam sessions</h1>
          <p className="text-sm text-muted-foreground">Final exams are generated for the whole semester (automatically three weeks before the exam window, or here). Teachers can set class tests for their own modules. Invigilator and room clashes are rejected.</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && <Button size="sm" variant="outline" onClick={() => setScheduleOpen(true)}><CalendarRange className="mr-1 h-4 w-4" /> Generate semester schedule</Button>}
          {user?.role !== 'STUDENT' && <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> {isAdmin ? 'New session' : 'New class test'}</Button>}
        </div>
      </div>

      {exams.isError && <Alert variant="destructive"><AlertDescription>{(exams.error as Error).message}</AlertDescription></Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={year}
          onValueChange={(v) => { setYear(v ?? 'all'); setSemester('all'); }}
          items={{ all: 'Every year', ...Object.fromEntries(YEARS.map((y) => [String(y), yearLabel(y)])) }}
        >
          <SelectTrigger className="w-56"><SelectValue placeholder="Year" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every year</SelectItem>
            {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{yearLabel(y)}</SelectItem>)}
          </SelectContent>
        </Select>

        {year !== 'all' && (
          <Select
            value={semester}
            onValueChange={(v) => setSemester(v ?? 'all')}
            items={{ all: 'Both semesters', ...Object.fromEntries(semestersInYear(Number(year)).map((n) => [String(n), `Semester ${n}`])) }}
          >
            <SelectTrigger className="w-44"><SelectValue placeholder="Semester" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Both semesters</SelectItem>
              {semestersInYear(Number(year)).map((n) => <SelectItem key={n} value={String(n)}>Semester {n}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <span className="text-sm text-muted-foreground">
          {shown.length} of {exams.data?.length ?? 0} sitting{(exams.data?.length ?? 0) === 1 ? '' : 's'}
        </span>
      </div>

      <div className="overflow-x-auto border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Session</TableHead><TableHead>Kind</TableHead><TableHead>When</TableHead><TableHead>Modules</TableHead><TableHead>Venues · invigilators</TableHead><TableHead className="text-right">Candidates</TableHead><TableHead>Seating</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {exams.isPending && Array.from({ length: 3 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>)}
            {shown.length === 0 && !exams.isPending && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{exams.data?.length ? 'No exam sits in that year.' : 'No exam sessions yet.'}</TableCell></TableRow>}
            {shown.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <Link href={`/exams/${e.id}`} className="font-medium hover:underline">{e.title}</Link>
                  {semesterOf(e) !== null && <div className="text-[11px] text-muted-foreground">{yearAndSemester(semesterOf(e)!)}</div>}
                  {e.generatedBy === 'auto' && <div className="text-[10px] uppercase tracking-wide text-muted-foreground">auto-scheduled</div>}
                </TableCell>
                <TableCell><Badge variant="outline" className={cn('border-transparent', KIND_STYLE[e.kind])}>{e.kind.replace('_', ' ')}</Badge>{e.seatingMode === 'BY_ID' && <div className="text-[10px] text-muted-foreground">by ID order</div>}</TableCell>
                <TableCell className="text-sm">{new Date(e.date).toLocaleDateString()} {e.startTime} · {e.durationMin} min</TableCell>
                <TableCell className="text-xs">{e.offerings.map((o) => o.module.code).join(', ')}{e.sections.length ? ` · sections ${e.sections.map((s) => s.name).join(', ')}` : ''}</TableCell>
                <TableCell className="text-xs">{e.venues.map((v) => v.name).join(', ')}<div className="text-muted-foreground">{e.invigilators.length ? e.invigilators.map((i) => `${i.user.name} (${i.venue.name})`).join(', ') : 'no invigilators'}</div></TableCell>
                <TableCell className="text-right">{e.candidates} / {e.capacity}</TableCell>
                <TableCell>
                  {e.seated > 0 ? <Badge variant="outline" className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">{e.seated} seated</Badge> : e.candidates > e.capacity ? <Badge variant="outline" className="border-transparent bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">Over capacity</Badge> : <Badge variant="outline" className="border-transparent bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Pending</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ---------- generate whole-semester schedule ---------- */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Generate semester exam schedule</DialogTitle><DialogDescription>One final exam per module inside the two-week exam window, weekdays at 09:00 and 13:00, one exam per day per cohort, venues packed largest-first, one invigilator per venue who does not teach the module. Runs automatically 3 weeks before the window if nobody has done it.</DialogDescription></DialogHeader>
          <Select value={scheduleSemester} onValueChange={(v) => setScheduleSemester(v ?? '')} items={Object.fromEntries((semesters.data ?? []).map((s) => [s.id, `${s.intake.programme.code} ${s.intake.label} · Sem ${s.number} · exams from ${s.examStart.slice(0, 10)}${s._count.examSessions ? ` (${s._count.examSessions} sessions exist)` : ''}`]))}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Semester" /></SelectTrigger>
            <SelectContent>{(semesters.data ?? []).filter((s) => s.term !== 'SUMMER').map((s) => <SelectItem key={s.id} value={s.id}>{s.intake.programme.code} {s.intake.label} · Sem {s.number} · exams from {s.examStart.slice(0, 10)}{s._count.examSessions ? ` (${s._count.examSessions} exist)` : ''}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter><Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button><Button disabled={!scheduleSemester || schedule.isPending} onClick={() => schedule.mutate(false)}>{schedule.isPending ? 'Scheduling…' : 'Generate'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- create session / class test ---------- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{isAdmin ? 'New exam session' : 'New class test'}</DialogTitle><DialogDescription>Pick the module offerings, the rooms and (for class tests) the sections. Seating “by ID” seats each section in ascending student-ID order; “mixed” keeps same-module students apart.</DialogDescription></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2"><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Class test 1 — Programming (sections A, B)" /></div>
            <div className="space-y-1"><Label>Kind</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: (v ?? 'CLASS_TEST') as typeof form.kind })} items={{ FINAL: 'Final exam', CLASS_TEST: 'Class test', RESIT: 'Resit exam' }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{(isAdmin ? ['FINAL', 'CLASS_TEST', 'RESIT'] : ['CLASS_TEST']).map((k) => <SelectItem key={k} value={k}>{k === 'FINAL' ? 'Final exam' : k === 'RESIT' ? 'Resit exam' : 'Class test'}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><Label>Seating</Label>
              <Select value={form.seatingMode} onValueChange={(v) => setForm({ ...form, seatingMode: (v ?? 'MIXED') as typeof form.seatingMode })} items={{ MIXED: 'Mixed (anti-cheat)', BY_ID: 'By section, ascending ID' }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MIXED">Mixed (anti-cheat)</SelectItem><SelectItem value="BY_ID">By section, ascending ID</SelectItem></SelectContent></Select>
            </div>
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div className="space-y-1"><Label>Start time</Label><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
            <div className="space-y-1"><Label>Duration (min)</Label><Input type="number" min={15} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })} /></div>
            <div className="space-y-1"><Label>Seed</Label><Input type="number" min={1} value={form.seed} onChange={(e) => setForm({ ...form, seed: Number(e.target.value) })} /></div>
            <div className="space-y-2 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Module offerings</Label>
                <span className="text-xs text-muted-foreground">{form.offeringIds.length} selected</span>
              </div>
              <Input value={moduleQuery} onChange={(e) => setModuleQuery(e.target.value)} placeholder="Search a module by code, title, programme or intake" className="h-8" />
              <div className="max-h-48 space-y-1 overflow-y-auto border p-2 text-sm">
                {offerings.data
                  ?.filter((o) => form.offeringIds.includes(o.id) || matches(moduleQuery, o.module.code, o.module.title, o.semester.intake.programme.code, o.semester.intake.label, `sem ${o.semester.number}`))
                  .map((o) => (
                  <label key={o.id} className="flex items-center gap-2"><Checkbox checked={form.offeringIds.includes(o.id)} onCheckedChange={(c) => toggle('offeringIds', o.id, !!c)} /><span>{o.module.code} · {o.module.title} — {o.semester.intake.programme.code} {o.semester.intake.label} Sem {o.semester.number} ({o._count.enrollments})</span></label>
                  ))}
                {offerings.data && offerings.data.filter((o) => matches(moduleQuery, o.module.code, o.module.title, o.semester.intake.programme.code, o.semester.intake.label)).length === 0 && (
                  <p className="py-2 text-center text-xs text-muted-foreground">No module matches “{moduleQuery}”.</p>
                )}
              </div>
            </div>
            {form.kind === 'CLASS_TEST' && sectionOptions.length > 0 && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Sections sitting (leave empty for all)</Label>
                <div className="flex flex-wrap gap-2 border p-2 text-sm">
                  {sectionOptions.map((s) => <label key={s.id} className="flex items-center gap-1.5"><Checkbox checked={form.sectionIds.includes(s.id)} onCheckedChange={(c) => toggle('sectionIds', s.id, !!c)} />{s.label}</label>)}
                </div>
              </div>
            )}
            <div className="space-y-2 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Venues and invigilators</Label>
                <span className="text-xs text-muted-foreground">
                  {form.venueIds.length} selected · {(venues.data ?? []).filter((v) => form.venueIds.includes(v.id)).reduce((n, v) => n + v.capacity, 0)} seats
                  {freeInvigilators.data ? ` · ${freeInvigilators.data.free.length} staff free at that time` : ''}
                </span>
              </div>
              <Input value={venueQuery} onChange={(e) => setVenueQuery(e.target.value)} placeholder="Search a room by name or block" className="h-8" />
              <div className="max-h-56 space-y-1 overflow-y-auto border p-2 text-sm">
                {venues.data
                  ?.filter((v) => form.venueIds.includes(v.id) || matches(venueQuery, v.name, v.building))
                  .map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center gap-2">
                    <label className="flex flex-1 items-center gap-2"><Checkbox checked={form.venueIds.includes(v.id)} onCheckedChange={(c) => toggle('venueIds', v.id, !!c)} /><span>{v.name} ({v.building}) — capacity {v.capacity}{v.isClassroom ? '' : ' · exam hall'}</span></label>
                    {form.venueIds.includes(v.id) && (() => {
                      const free = freeInvigilators.data?.free ?? teachers.data ?? [];
                      const picked = form.invigilators[v.id];
                      // Anyone already chosen stays in the list even if they are busy, so a
                      // deliberate choice is never silently dropped.
                      const options = picked && !free.some((f) => f.id === picked)
                        ? [...free, ...(teachers.data ?? []).filter((x) => x.id === picked)]
                        : free;
                      return (
                        <Select value={picked ?? ''} onValueChange={(u) => setForm({ ...form, invigilators: { ...form.invigilators, [v.id]: u ?? '' } })} items={Object.fromEntries(options.map((o) => [o.id, o.name]))}>
                          <SelectTrigger className="w-56">
                            <SelectValue placeholder={form.date ? `Free invigilator (${free.length})` : 'Pick a date first'} />
                          </SelectTrigger>
                          <SelectContent>{options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
                        </Select>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending || !form.title || !form.date || form.offeringIds.length === 0 || form.venueIds.length === 0} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
