'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, FileSpreadsheet, GripVertical, Plus, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MODULE_PALETTE } from '@/components/seat-grid';
import { ReasonField } from '@/components/reason-field';
import { api, ApiError, downloadWithAuth, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import type { SlotCandidate } from '@/lib/types';

interface Semester {
  id: string;
  number: number;
  term: 'AUTUMN' | 'SPRING' | 'SUMMER';
  startDate: string;
  endDate: string;
  teachingWeeks: number;
  examStart: string;
  intake: { id: string; label: string; programme: { code: string; name: string } };
  sections: { id: string; name: string }[];
  _count: { slots: number; examSessions: number };
}
interface Item {
  kind: 'CLASS' | 'EXAM';
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  subtitle: string;
  module?: { code: string; title: string };
  section?: { id: string; name: string } | null;
  teacher?: { id: string; name: string } | null;
  venue?: { id: string; name: string } | null;
  slotId?: string;
  classKind?: 'LECTURE' | 'TUTORIAL' | 'WORKSHOP';
  /** Every group in the room; a lecture combines the whole cohort. */
  groups?: string[];
  offeringId?: string;
  examSessionId?: string;
  status: 'SCHEDULED' | 'CANCELLED' | 'CHANGED';
  change?: { kind: string; reason: string; originalTeacher?: string | null; originalVenue?: string | null };
  week?: number;
  seat?: string | null;
  invigilators?: { name: string; venue: string }[];
}
interface Week {
  weekStart: string;
  monday: string;
  days: { date: string; items: Item[] }[];
}
interface PeriodGrid {
  finalYear: boolean;
  dayEndsBy: string;
  maxGapHours: number;
  sessions?: { kind: string; minutes: number; rooms: string[] }[];
  periods: { startTime: string; endTime: string }[];
}
interface Health {
  finalYear: boolean;
  dayEndsBy: string;
  maxGapHours: number;
  gaps: { section: string; dayOfWeek: number; after: string; before: string; gapMinutes: number }[];
  lateFinalYear: { slotId: string; section: string; module: string; endTime: string }[];
  clashes: number;
  slots: number;
}
type Teacher = { id: string; name: string };
type Venue = { id: string; name: string; isClassroom: boolean };
type Offering = { id: string; module: { code: string; title: string }; lecturer: { id: string; name: string } | null; coLecturer?: { id: string; name: string } | null };
interface NewClass {
  sectionId: string;
  moduleOfferingId: string;
  teacherId: string;
  venueId: string;
  kind: 'LECTURE' | 'TUTORIAL' | 'WORKSHOP';
  dayOfWeek: number;
  period: string; // "start-end"
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** The teaching week runs Sunday to Friday; Saturday is the weekend. */
const TEACHING_WEEK = [{ dayOfWeek: 7, label: 'Sun', index: 0 }, { dayOfWeek: 1, label: 'Mon', index: 1 }, { dayOfWeek: 2, label: 'Tue', index: 2 }, { dayOfWeek: 3, label: 'Wed', index: 3 }, { dayOfWeek: 4, label: 'Thu', index: 4 }, { dayOfWeek: 5, label: 'Fri', index: 5 }];
const KIND_LABEL: Record<string, string> = { LECTURE: 'Lecture', TUTORIAL: 'Tutorial', WORKSHOP: 'Workshop' };
const todayIso = () => new Date().toISOString().slice(0, 10);
const plusDaysIso = (d: number) => new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);
const subscribeNoop = () => () => {};
const useToday = () => useSyncExternalStore(subscribeNoop, todayIso, todayIso);

function weekOfDate(sem: Semester, iso: string): number {
  const start = new Date(sem.startDate);
  const monday = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - ((start.getUTCDay() + 6) % 7)));
  return Math.floor((new Date(iso + 'T00:00:00Z').getTime() - monday.getTime()) / (7 * 86400e3)) + 1;
}

export default function TimetablePage() {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const isStaff = user?.role !== 'STUDENT';
  const canEdit = can('timetable.write');

  const semesters = useQuery({ queryKey: ['tt', 'semesters'], queryFn: () => api<Semester[]>('/api/timetable/semesters') });
  const teachers = useQuery({ queryKey: ['tt', 'teachers'], queryFn: () => api<Teacher[]>('/api/timetable/teachers'), enabled: !!isStaff });
  const venues = useQuery({ queryKey: ['venues'], queryFn: () => api<Venue[]>('/api/venues'), enabled: !!isStaff });

  const [semesterId, setSemesterId] = useState('');
  const [week, setWeek] = useState(0);
  const [sectionId, setSectionId] = useState('all');
  const [teacherId, setTeacherId] = useState('all');
  const [venueId, setVenueId] = useState('all');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Item | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [clash, setClash] = useState<{ item: Item; message: string; clashes: string[]; alternatives: SlotCandidate[] } | null>(null);
  const [newClass, setNewClass] = useState<NewClass | null>(null);
  const router = useRouter();
  const today = useToday();
  const soon = useSyncExternalStore(subscribeNoop, () => plusDaysIso(21), () => plusDaysIso(21));

  const sem = useMemo(() => {
    if (!semesters.data?.length) return undefined;
    if (semesterId) return semesters.data.find((s) => s.id === semesterId);
    const running = semesters.data.filter((s) => s.startDate.slice(0, 10) <= soon && s.endDate.slice(0, 10) >= today);
    const bySlots = (a: Semester, b: Semester) => b._count.slots - a._count.slots;
    return [...running].sort(bySlots)[0] ?? [...semesters.data].sort(bySlots)[0];
  }, [semesters.data, semesterId, today, soon]);

  const effectiveWeek = week || (sem ? Math.min(Math.max(weekOfDate(sem, today), 1), sem.teachingWeeks + 2) : 1);
  const query = qs({ semesterId: sem?.id, week: effectiveWeek, sectionId: isStaff ? sectionId : undefined, teacherId: isStaff ? teacherId : undefined, venueId: isStaff ? venueId : undefined });
  const wk = useQuery({ queryKey: ['tt', 'week', query], queryFn: () => api<Week>(`/api/timetable/week${query}`), enabled: !!sem });
  const grid = useQuery({ queryKey: ['tt', 'periods', sem?.id], queryFn: () => api<PeriodGrid>(`/api/timetable/periods${qs({ semesterId: sem?.id })}`), enabled: !!sem });
  const health = useQuery({ queryKey: ['tt', 'health', sem?.id], queryFn: () => api<Health>(`/api/timetable/health${qs({ semesterId: sem?.id })}`), enabled: !!sem && isStaff });
  const offerings = useQuery({ queryKey: ['tt', 'offerings', sem?.id], queryFn: () => api<Offering[]>(`/api/offerings${qs({ semesterId: sem?.id })}`), enabled: !!sem && !!newClass });

  /** Add a single class to the routine. The same clash, cut-off and gap checks run as for a drag. */
  const addClass = useMutation({
    mutationFn: (v: NewClass) => {
      const [startTime, endTime] = v.period.split('-');
      return api('/api/timetable/slots', {
        method: 'POST',
        body: { semesterId: sem!.id, sectionId: v.sectionId, moduleOfferingId: v.moduleOfferingId, teacherId: v.teacherId, venueId: v.venueId || null, kind: v.kind, dayOfWeek: v.dayOfWeek, startTime, endTime },
      });
    },
    onSuccess: () => {
      toast.success('Class added to the routine');
      setNewClass(null);
      void qc.invalidateQueries({ queryKey: ['tt'] });
    },
    onError: (e) => {
      const details = e instanceof ApiError && e.details && typeof e.details === 'object' ? (e.details as { clashes?: string[] }) : {};
      toast.error(e instanceof Error ? e.message : 'Could not add the class', { description: details.clashes?.join(' · ') });
    },
  });

  const generate = useMutation({
    mutationFn: () => api<{ slots: number; unplaced: { section?: string; module?: string; missing: number; reason: string }[]; gapViolations: unknown[]; dayEndsBy: string }>('/api/timetable/generate', { method: 'POST', body: { semesterId: sem!.id, replace: (sem?._count.slots ?? 0) > 0 } }),
    onSuccess: (r) => {
      toast.success(`${r.slots} weekly classes generated, day ends by ${r.dayEndsBy}${r.unplaced.length ? ` · ${r.unplaced.length} could not be placed` : ''}`);
      if (r.unplaced.length) toast.warning(r.unplaced.slice(0, 3).map((u) => `${u.module} section ${u.section}: ${u.reason}`).join(' · '), { duration: 12000 });
      void qc.invalidateQueries({ queryKey: ['tt'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Generation failed'),
  });

  /** Drag-and-drop move. A refusal comes back with the clashes and free alternatives. */
  const move = useMutation({
    mutationFn: (v: { item: Item; dayOfWeek: number; startTime: string; endTime: string; venueId?: string }) =>
      api(`/api/timetable/slots/${v.item.slotId}`, { method: 'PATCH', body: { dayOfWeek: v.dayOfWeek, startTime: v.startTime, endTime: v.endTime, ...(v.venueId ? { venueId: v.venueId } : {}) } }),
    onSuccess: () => {
      toast.success('Class moved');
      setClash(null);
      void qc.invalidateQueries({ queryKey: ['tt'] });
    },
    onError: (e, v) => {
      const details = e instanceof ApiError && e.details && typeof e.details === 'object' ? (e.details as { clashes?: string[]; alternatives?: SlotCandidate[] }) : {};
      setClash({ item: v.item, message: e instanceof Error ? e.message : 'Move refused', clashes: details.clashes ?? [], alternatives: details.alternatives ?? [] });
    },
  });

  const modules = useMemo(() => [...new Set((wk.data?.days ?? []).flatMap((d) => d.items.filter((i) => i.kind === 'CLASS').map((i) => i.module?.code ?? '')))].sort(), [wk.data]);
  const colourOf = (item: Item) => (item.kind === 'EXAM' ? 'bg-brand-orange/25 border-l-brand-orange' : `${MODULE_PALETTE[Math.max(0, modules.indexOf(item.module?.code ?? '')) % MODULE_PALETTE.length]} border-l-transparent`);
  const isExamWeek = sem ? effectiveWeek > sem.teachingWeeks : false;
  const selected = wk.data?.days.find((d) => d.date === selectedDay) ?? null;
  const periods = grid.data?.periods ?? [];
  // Sunday first, Saturday dropped — the days a class can actually be on.
  const allDays = wk.data?.days ?? [];
  const weekdays = allDays.length ? TEACHING_WEEK.map((d) => ({ ...allDays[d.index], dayOfWeek: d.dayOfWeek, label: d.label })) : [];
  // A class sits in the row it starts on and keeps its own length: a lecture runs 90 minutes, a
  // tutorial 60 and a workshop 120, so matching on the end time too would hide most of them.
  const inPeriod = (i: Item, p: { startTime: string }) => i.startTime === p.startTime;
  const offGrid = (day: { items: Item[] }) => day.items.filter((i) => !periods.some((p) => inPeriod(i, p)));

  /** The slot id travels in the drag payload, so a drop works even before React re-renders. */
  const DRAG_TYPE = 'application/x-rte-slot';
  const allItems = useMemo(() => (wk.data?.days ?? []).flatMap((d) => d.items), [wk.data]);
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const onDrop = (e: React.DragEvent, dayIndex: number, p: { startTime: string; endTime: string }) => {
    e.preventDefault();
    const slotId = e.dataTransfer.getData(DRAG_TYPE) || dragging?.slotId;
    setDragging(null);
    setHover(null);
    if (!slotId || !canEdit) return;
    const item = allItems.find((i) => i.slotId === slotId);
    if (!item) return;
    if (item.startTime === p.startTime && item.date === weekdays[dayIndex]?.date) return;
    // A class keeps its own length when it moves: a two-hour workshop dropped on an hourly row is
    // still a two-hour workshop, not a shortened one.
    const endTime = clock(mins(p.startTime) + (mins(item.endTime) - mins(item.startTime)));
    move.mutate({ item, dayOfWeek: weekdays[dayIndex].dayOfWeek, startTime: p.startTime, endTime });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Timetable</h1>
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? 'One constant weekly routine per section for the 12 teaching weeks. Drag a class to another slot — clashes, the final-year cut-off and the two-hour gap rule are checked before it moves.'
              : isStaff
                ? 'The weekly routine for the classes you teach. Click a day to see the detail or report an absence.'
                : "Your section's weekly routine and exam dates. Click a day for detail or to request an absence."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        {canEdit && sem && (
          <Button size="sm" variant="outline" onClick={() => setNewClass({ sectionId: sem.sections[0]?.id ?? '', moduleOfferingId: '', teacherId: '', venueId: '', kind: 'LECTURE', dayOfWeek: 7, period: periods[0] ? `${periods[0].startTime}-${periods[0].endTime}` : '08:00-09:30' })}>
            <Plus className="mr-1 h-4 w-4" /> Add class
          </Button>
        )}
        {isStaff && (
          <Button size="sm" variant="outline" onClick={() => router.push('/exams?new=1')}>
            <CalendarDays className="mr-1 h-4 w-4" /> Add exam
          </Button>
        )}
        {isStaff && sem && (
          <Button
            size="sm"
            variant="outline"
            title="One row per session — day, time, hours, class type, year, course, specialisation, module, lecturer, group, block, room — plus a sheet per year and the teacher workload"
            onClick={() => downloadWithAuth(`/api/timetable/allocation.xlsx${qs({ semesterId: sem.id })}`, `resource-allocation-${sem.intake.programme.code}-${sem.intake.label.replace(/\s+/g, '')}.xlsx`).catch((e: Error) => toast.error(e.message))}
          >
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Resource allocation
          </Button>
        )}
        {canEdit && sem && (
          <Button size="sm" variant={sem._count.slots ? 'outline' : 'default'} disabled={generate.isPending} onClick={() => (sem._count.slots === 0 || confirm(`Regenerate the routine for ${sem.intake.programme.code} ${sem.intake.label} Semester ${sem.number}? Existing slots and one-off changes are replaced.`)) && generate.mutate()}>
            <RefreshCw className={cn('mr-1 h-4 w-4', generate.isPending && 'animate-spin')} /> {sem._count.slots ? 'Regenerate routine' : 'Generate routine'}
          </Button>
        )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {semesters.data && (
          <Select value={sem?.id ?? ''} onValueChange={(v) => { setSemesterId(v ?? ''); setWeek(0); setSectionId('all'); }} items={Object.fromEntries(semesters.data.map((s) => [s.id, `${s.intake.programme.code} ${s.intake.label} · Sem ${s.number}`]))}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Semester" /></SelectTrigger>
            <SelectContent>{semesters.data.map((s) => <SelectItem key={s.id} value={s.id}>{s.intake.programme.code} {s.intake.label} · Sem {s.number} ({s.term.toLowerCase()}){s._count.slots ? '' : ' · no routine'}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => setWeek(Math.max(1, effectiveWeek - 1))} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
          <span className={cn('min-w-[9rem] text-center text-sm', isExamWeek && 'font-semibold text-brand-orange')}>{isExamWeek ? `Exam week ${effectiveWeek - (sem?.teachingWeeks ?? 12)}` : `Week ${effectiveWeek} of ${sem?.teachingWeeks ?? 12}`}{wk.data ? ` · ${wk.data.weekStart}` : ''}</span>
          <Button variant="outline" size="icon-sm" onClick={() => setWeek(Math.min((sem?.teachingWeeks ?? 12) + 2, effectiveWeek + 1))} aria-label="Next week"><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setWeek(0)}>Today</Button>
        </div>
        {isStaff && sem && (
          <>
            <Select value={sectionId} onValueChange={(v) => setSectionId(v ?? 'all')} items={{ all: 'All sections', ...Object.fromEntries(sem.sections.map((s) => [s.id, `Section ${s.name}`])) }}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All sections</SelectItem>{sem.sections.map((s) => <SelectItem key={s.id} value={s.id}>Section {s.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={teacherId} onValueChange={(v) => setTeacherId(v ?? 'all')} items={{ all: 'All teachers', ...Object.fromEntries((teachers.data ?? []).map((t) => [t.id, t.name])) }}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All teachers</SelectItem>{teachers.data?.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={venueId} onValueChange={(v) => setVenueId(v ?? 'all')} items={{ all: 'All rooms', ...Object.fromEntries((venues.data ?? []).map((v) => [v.id, v.name])) }}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All rooms</SelectItem>{venues.data?.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
          </>
        )}
      </div>

      {grid.data && (
        <p className="text-xs text-muted-foreground">
          {grid.data.finalYear ? `Final-year group: classes finish by ${grid.data.dayEndsBy} so students are free for work and placements.` : `Classes start on the half hour from 06:30 and finish by ${grid.data.dayEndsBy}.`}{' '}
          Lectures run 90 minutes for the whole cohort in a hall, tutorials an hour per group, workshops two hours in a lab. No group may have a gap longer than {grid.data.maxGapHours} hours.
        </p>
      )}
      {health.data && (health.data.gaps.length > 0 || health.data.lateFinalYear.length > 0) && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Routine warnings</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc pl-4 text-xs">
              {health.data.gaps.slice(0, 4).map((g, i) => <li key={i}>Section {g.section}, {DAYS[g.dayOfWeek - 1]}: {Math.round((g.gapMinutes / 60) * 10) / 10} h with nothing between {g.after} and {g.before}</li>)}
              {health.data.lateFinalYear.slice(0, 4).map((l) => <li key={l.slotId}>Section {l.section} {l.module} finishes at {l.endTime}, after the 10:00 final-year cut-off</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {wk.isError && <Alert variant="destructive"><AlertDescription>{(wk.error as Error).message}</AlertDescription></Alert>}
      {sem && sem._count.slots === 0 && !isExamWeek && <Alert><AlertDescription>No routine has been generated for this semester yet.{canEdit ? ' Use “Generate routine”.' : ''}</AlertDescription></Alert>}

      {/* ---------- week grid: periods × weekdays, drag to move ---------- */}
      {wk.isPending || grid.isPending ? (
        <Skeleton className="h-[420px] w-full" />
      ) : wk.data ? (
        <div className="overflow-x-auto border bg-card">
          <div className="grid min-w-[900px]" style={{ gridTemplateColumns: '92px repeat(5, minmax(0, 1fr))' }}>
            <div className="border-b border-r bg-muted/40 p-2 text-[11px] text-muted-foreground">Period</div>
            {weekdays.map((d, i) => (
              <button key={d.date} onClick={() => setSelectedDay(d.date)} className={cn('border-b border-r px-2 py-2 text-left text-xs hover:bg-accent', d.date === today && 'bg-primary/10')}>
                <div className="font-semibold">{weekdays[i].label}</div>
                <div className="text-muted-foreground">{d.date.slice(5)} · {d.items.length} item{d.items.length === 1 ? '' : 's'}</div>
              </button>
            ))}

            {periods.map((p) => (
              <div key={p.startTime} className="contents">
                <div className="border-b border-r bg-muted/20 p-2 text-[11px] text-muted-foreground">{p.startTime}<br />{p.endTime}</div>
                {weekdays.map((d, di) => {
                  const cellKey = `${di}:${p.startTime}`;
                  const items = d.items.filter((i) => inPeriod(i, p));
                  return (
                    <div
                      key={cellKey}
                      onDragOver={(e) => {
                        if (!canEdit || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setHover(cellKey);
                      }}
                      onDragLeave={() => setHover((h) => (h === cellKey ? null : h))}
                      onDrop={(e) => onDrop(e, di, p)}
                      onClick={() => setSelectedDay(d.date)}
                      className={cn('min-h-[62px] space-y-1 border-b border-r p-1', hover === cellKey && 'bg-primary/10 ring-1 ring-inset ring-primary')}
                    >
                      {items.map((it) => (
                        <div
                          key={it.id}
                          draggable={canEdit && it.kind === 'CLASS' && it.status !== 'CANCELLED'}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_TYPE, it.slotId ?? '');
                            e.dataTransfer.effectAllowed = 'move';
                            setDragging(it);
                          }}
                          onDragEnd={() => { setDragging(null); setHover(null); }}
                          title={`${it.startTime}–${it.endTime} ${it.title}\n${it.subtitle}${canEdit && it.kind === 'CLASS' ? '\nDrag to move this class' : ''}`}
                          className={cn(
                            'flex items-start gap-1 border-l-4 px-1.5 py-1 text-[11px] leading-tight',
                            colourOf(it),
                            it.status === 'CANCELLED' && 'opacity-50 line-through',
                            canEdit && it.kind === 'CLASS' && it.status !== 'CANCELLED' && 'cursor-grab active:cursor-grabbing',
                            dragging?.id === it.id && 'opacity-40',
                          )}
                        >
                          {canEdit && it.kind === 'CLASS' && it.status !== 'CANCELLED' && <GripVertical className="mt-0.5 h-3 w-3 shrink-0 opacity-50" />}
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">
                              {it.kind === 'EXAM' ? '📝 ' : ''}{it.module?.code ?? it.title}
                              {isStaff && (it.groups?.length ? ` · ${it.groups.join('+')}` : it.section ? ` · ${it.section.name}` : '')}
                            </span>
                            <span className="block truncate">
                              {it.classKind ? `${KIND_LABEL[it.classKind]} · ` : ''}{it.startTime}–{it.endTime}
                            </span>
                            <span className="block truncate">{it.venue?.name ?? ''}{it.teacher && isStaff ? ` · ${it.teacher.name.split(' ')[0]}` : ''}{it.seat ? ` · seat ${it.seat}` : ''}</span>
                            {it.status === 'CHANGED' && <span className="block truncate text-brand-orange">changed</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}

            {weekdays.some((d) => offGrid(d).length > 0) && (
              <div className="contents">
                <div className="border-r bg-muted/20 p-2 text-[11px] text-muted-foreground">Other</div>
                {weekdays.map((d) => (
                  <div key={`other-${d.date}`} className="min-h-[48px] space-y-1 border-r p-1" onClick={() => setSelectedDay(d.date)}>
                    {offGrid(d).map((it) => (
                      <div key={it.id} className={cn('border-l-4 px-1.5 py-1 text-[11px] leading-tight', colourOf(it), it.status === 'CANCELLED' && 'opacity-50 line-through')} title={it.subtitle}>
                        <span className="block truncate font-semibold">{it.kind === 'EXAM' ? '📝 ' : ''}{it.module?.code ?? it.title}</span>
                        <span className="block truncate">{it.startTime}–{it.endTime}{it.venue ? ` · ${it.venue.name}` : ''}{it.seat ? ` · seat ${it.seat}` : ''}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {modules.map((m, i) => <span key={m} className={cn('border-l-4 px-1.5', MODULE_PALETTE[i % MODULE_PALETTE.length])}>{m}</span>)}
        <span className="border-l-4 border-brand-orange bg-brand-orange/25 px-1.5">Exam</span>
        {canEdit && <span>Drag a class block to move it.</span>}
      </div>

      {selected && sem && <DayView day={selected} sem={sem} teachers={teachers.data ?? []} venues={venues.data ?? []} onClose={() => setSelectedDay(null)} />}

      {/* ---------- clash dialog with alternatives ---------- */}
      {/* ---------- add one class to the routine ---------- */}
      <Dialog open={!!newClass} onOpenChange={(o) => !o && setNewClass(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add a class</DialogTitle>
            <DialogDescription>
              This goes through the same checks as a drag: the section, the teacher and the room must all be free, a final-year day must end by {grid.data?.dayEndsBy ?? '10:00'}, and no group may be left a gap longer than {grid.data?.maxGapHours ?? 2} hours.
            </DialogDescription>
          </DialogHeader>
          {newClass && sem && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Section</Label>
                <Select value={newClass.sectionId} onValueChange={(v) => setNewClass({ ...newClass, sectionId: v ?? '' })} items={Object.fromEntries(sem.sections.map((s) => [s.id, s.name]))}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Section" /></SelectTrigger>
                  <SelectContent>{sem.sections.map((s) => <SelectItem key={s.id} value={s.id}>Section {s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Class kind</Label>
                <Select value={newClass.kind} onValueChange={(v) => setNewClass({ ...newClass, kind: (v ?? 'LECTURE') as NewClass['kind'] })} items={KIND_LABEL}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Module</Label>
                <Select
                  value={newClass.moduleOfferingId}
                  onValueChange={(v) => {
                    const o = offerings.data?.find((x) => x.id === v);
                    setNewClass({ ...newClass, moduleOfferingId: v ?? '', teacherId: newClass.teacherId || o?.lecturer?.id || '' });
                  }}
                  items={Object.fromEntries((offerings.data ?? []).map((o) => [o.id, `${o.module.code} · ${o.module.title}`]))}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder={offerings.isPending ? 'Loading modules…' : 'Choose a module'} /></SelectTrigger>
                  <SelectContent>{(offerings.data ?? []).map((o) => <SelectItem key={o.id} value={o.id}>{o.module.code} · {o.module.title}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Teacher</Label>
                <Select value={newClass.teacherId} onValueChange={(v) => setNewClass({ ...newClass, teacherId: v ?? '' })} items={Object.fromEntries((teachers.data ?? []).map((t) => [t.id, t.name]))}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose a teacher" /></SelectTrigger>
                  <SelectContent>{(teachers.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Day</Label>
                <Select value={String(newClass.dayOfWeek)} onValueChange={(v) => setNewClass({ ...newClass, dayOfWeek: Number(v ?? 7) })} items={Object.fromEntries(TEACHING_WEEK.map((d) => [String(d.dayOfWeek), d.label]))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{TEACHING_WEEK.map((d) => <SelectItem key={d.dayOfWeek} value={String(d.dayOfWeek)}>{d.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Period</Label>
                <Select value={newClass.period} onValueChange={(v) => setNewClass({ ...newClass, period: v ?? '' })} items={Object.fromEntries(periods.map((p) => [`${p.startTime}-${p.endTime}`, `${p.startTime}–${p.endTime}`]))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{periods.map((p) => <SelectItem key={p.startTime} value={`${p.startTime}-${p.endTime}`}>{p.startTime}–{p.endTime}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Room</Label>
                <Select value={newClass.venueId} onValueChange={(v) => setNewClass({ ...newClass, venueId: v ?? '' })} items={Object.fromEntries((venues.data ?? []).filter((v) => v.isClassroom).map((v) => [v.id, v.name]))}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose a room" /></SelectTrigger>
                  <SelectContent>{(venues.data ?? []).filter((v) => v.isClassroom).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewClass(null)}>Cancel</Button>
            <Button disabled={!newClass?.sectionId || !newClass?.moduleOfferingId || !newClass?.teacherId || addClass.isPending} onClick={() => newClass && addClass.mutate(newClass)}>
              {addClass.isPending ? 'Adding…' : 'Add class'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!clash} onOpenChange={(o) => !o && setClash(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{clash?.message}</DialogTitle>
            <DialogDescription>{clash ? `${clash.item.module?.code} · section ${clash.item.section?.name} could not be moved there.` : ''}</DialogDescription>
          </DialogHeader>
          {clash && (
            <div className="space-y-3">
              {clash.clashes.length > 0 && (
                <Alert variant="destructive">
                  <AlertDescription><ul className="list-disc pl-4 text-xs">{clash.clashes.map((c, i) => <li key={i}>{c}</li>)}</ul></AlertDescription>
                </Alert>
              )}
              <div>
                <div className="mb-1 text-sm font-medium">Free slots that do work</div>
                {clash.alternatives.length === 0 && <p className="text-sm text-muted-foreground">No free slot this week keeps the teacher, the room and the rules happy. Free a room or move another class first.</p>}
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {clash.alternatives.map((a, i) => (
                    <Button key={i} variant="outline" size="sm" className="justify-between" disabled={move.isPending} onClick={() => move.mutate({ item: clash.item, dayOfWeek: a.dayOfWeek, startTime: a.startTime, endTime: a.endTime, venueId: a.venueId })}>
                      <span>{DAYS[a.dayOfWeek - 1]} {a.startTime}–{a.endTime}</span>
                      <span className="text-xs text-muted-foreground">{a.venueName}{a.keepsRoom ? ' (same room)' : ''}{a.createsGap ? ' · leaves a gap' : ''}</span>
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setClash(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DayView({ day, sem, teachers, venues, onClose }: { day: { date: string; items: Item[] }; sem: Semester; teachers: Teacher[]; venues: Venue[]; onClose: () => void }) {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const canEdit = can('timetable.write');
  const isStudent = user?.role === 'STUDENT';
  const [action, setAction] = useState<{ kind: 'CANCEL' | 'TEACHER' | 'ROOM' | 'RESCHEDULE' | 'TEACHER_ABSENCE' | 'STUDENT_ABSENCE' | 'SECTION_SWAP'; item?: Item } | null>(null);
  const [reason, setReason] = useState('');
  const [reasonOk, setReasonOk] = useState(true);
  const [teacherId, setTeacherId] = useState('');
  const [venueId, setVenueId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [targetSection, setTargetSection] = useState('');

  const done = () => {
    setAction(null);
    setReason('');
    setTeacherId('');
    setVenueId('');
    setStart('');
    setEnd('');
    setTargetSection('');
    void qc.invalidateQueries({ queryKey: ['tt'] });
    void qc.invalidateQueries({ queryKey: ['requests'] });
  };

  const run = useMutation({
    mutationFn: async () => {
      if (!action) return;
      const it = action.item;
      if (action.kind === 'CANCEL' || action.kind === 'TEACHER' || action.kind === 'ROOM' || action.kind === 'RESCHEDULE') {
        const kind = action.kind === 'CANCEL' ? 'CANCELLED' : action.kind === 'TEACHER' ? 'TEACHER_CHANGE' : action.kind === 'ROOM' ? 'ROOM_CHANGE' : 'RESCHEDULED';
        return api(`/api/timetable/slots/${it!.slotId}/exceptions`, { method: 'POST', body: { date: day.date, kind, reason, teacherId: teacherId || undefined, venueId: venueId || undefined, startTime: start || undefined, endTime: end || undefined } });
      }
      return api('/api/requests', { method: 'POST', body: { kind: action.kind, slotId: it?.slotId, date: day.date, targetSectionId: targetSection || undefined, reason } });
    },
    onSuccess: () => {
      toast.success(action && ['CANCEL', 'TEACHER', 'ROOM', 'RESCHEDULE'].includes(action.kind) ? 'Change applied and everyone affected notified' : 'Request sent to the RTE office');
      done();
    },
    onError: (e) => {
      const d = e instanceof ApiError && e.details && typeof e.details === 'object' ? (e.details as { clashes?: string[]; conflicts?: string[] }) : {};
      const extra = d.clashes ?? d.conflicts;
      toast.error(extra ? `${(e as Error).message}: ${extra.join('; ')}` : e instanceof Error ? e.message : 'Failed');
    },
  });

  const titles: Record<string, string> = { CANCEL: 'Cancel this class', TEACHER: 'Cover teacher for this class', ROOM: 'Move this class to another room', RESCHEDULE: 'Reschedule this class', TEACHER_ABSENCE: 'Report my absence', STUDENT_ABSENCE: 'Request absence from this class', SECTION_SWAP: 'Request a section change' };
  const needsReason = true;

  return (
    <div className="border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <span className="font-semibold">{new Date(day.date + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</span>
          <span className="text-xs text-muted-foreground">{day.items[0]?.week ? `week ${day.items[0].week}` : ''}</span>
        </div>
        <div className="flex gap-2">
          {isStudent && sem.sections.length > 1 && <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'SECTION_SWAP' })}>Request section change</Button>}
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
      <div className="divide-y">
        {day.items.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing scheduled.</p>}
        {day.items.map((it) => (
          <div key={it.id} className={cn('flex flex-wrap items-start justify-between gap-3 p-4', it.status === 'CANCELLED' && 'opacity-60')}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm">{it.startTime}–{it.endTime}</span>
                <span className={cn('font-medium', it.status === 'CANCELLED' && 'line-through')}>{it.title}</span>
                {it.kind === 'EXAM' && <Badge variant="outline" className="border-brand-orange text-brand-orange">Exam</Badge>}
                {it.status === 'CANCELLED' && <Badge variant="outline" className="border-transparent bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">Cancelled</Badge>}
                {it.status === 'CHANGED' && <Badge variant="outline" className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{it.change?.kind.replace('_', ' ').toLowerCase()}</Badge>}
              </div>
              <div className="text-sm text-muted-foreground">{it.subtitle}{it.seat ? ` · your seat ${it.seat}` : ''}</div>
              {it.change && <div className="text-xs text-muted-foreground">{it.change.reason}{it.change.originalTeacher ? ` · originally ${it.change.originalTeacher}` : ''}{it.change.originalVenue ? ` · originally ${it.change.originalVenue}` : ''}</div>}
              {it.invigilators && it.invigilators.length > 0 && <div className="text-xs text-muted-foreground">Invigilators: {it.invigilators.map((i) => `${i.name} (${i.venue})`).join(', ')}</div>}
            </div>
            {it.kind === 'CLASS' && it.status !== 'CANCELLED' && (
              <div className="flex flex-wrap gap-1.5">
                {canEdit && (
                  <>
                    <Button size="xs" variant="outline" onClick={() => setAction({ kind: 'TEACHER', item: it })}>Change teacher</Button>
                    <Button size="xs" variant="outline" onClick={() => setAction({ kind: 'ROOM', item: it })}>Change room</Button>
                    <Button size="xs" variant="outline" onClick={() => setAction({ kind: 'RESCHEDULE', item: it })}>Reschedule</Button>
                    <Button size="xs" variant="destructive" onClick={() => setAction({ kind: 'CANCEL', item: it })}>Cancel class</Button>
                  </>
                )}
                {(user?.role === 'LECTURER' || user?.role === 'MODULE_LEADER') && it.teacher?.id === user.id && <Button size="xs" variant="outline" onClick={() => setAction({ kind: 'TEACHER_ABSENCE', item: it })}>Report absence</Button>}
                {isStudent && <Button size="xs" variant="outline" onClick={() => setAction({ kind: 'STUDENT_ABSENCE', item: it })}>Request absence</Button>}
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action ? titles[action.kind] : ''}</DialogTitle>
            <DialogDescription>{action?.item ? `${action.item.startTime}–${action.item.endTime} · ${action.item.title} · ${day.date}` : day.date}. Clashes with the teacher&apos;s or room&apos;s other commitments are rejected.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {action?.kind === 'TEACHER' && (
              <div className="space-y-1"><Label>Cover teacher</Label>
                <Select value={teacherId} onValueChange={(v) => setTeacherId(v ?? '')} items={Object.fromEntries(teachers.map((t) => [t.id, t.name]))}><SelectTrigger className="w-full"><SelectValue placeholder="Choose a teacher" /></SelectTrigger><SelectContent>{teachers.filter((t) => t.id !== action.item?.teacher?.id).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select>
              </div>
            )}
            {action?.kind === 'ROOM' && (
              <div className="space-y-1"><Label>Room</Label>
                <Select value={venueId} onValueChange={(v) => setVenueId(v ?? '')} items={Object.fromEntries(venues.map((v) => [v.id, v.name]))}><SelectTrigger className="w-full"><SelectValue placeholder="Choose a room" /></SelectTrigger><SelectContent>{venues.filter((v) => v.isClassroom).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select>
              </div>
            )}
            {action?.kind === 'RESCHEDULE' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label>Start</Label><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
                <div className="space-y-1"><Label>End</Label><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
              </div>
            )}
            {action?.kind === 'SECTION_SWAP' && (
              <div className="space-y-1"><Label>Move me to</Label>
                <Select value={targetSection} onValueChange={(v) => setTargetSection(v ?? '')} items={Object.fromEntries(sem.sections.map((s) => [s.id, `Section ${s.name}`]))}><SelectTrigger className="w-full"><SelectValue placeholder="Choose a section" /></SelectTrigger><SelectContent>{sem.sections.map((s) => <SelectItem key={s.id} value={s.id}>Section {s.name}</SelectItem>)}</SelectContent></Select>
              </div>
            )}
            {action && ['TEACHER_ABSENCE', 'STUDENT_ABSENCE', 'SECTION_SWAP'].includes(action.kind) ? (
              <ReasonField value={reason} onChange={setReason} onVerdict={(v) => setReasonOk(v !== 'GIBBERISH')} label="Reason (checked automatically, then read by the RTE office)" />
            ) : (
              <div className="space-y-1"><Label>Reason (recorded and shown to everyone affected)</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Guest lecture in the auditorium" /></div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>Back</Button>
            <Button
              disabled={
                run.isPending ||
                (needsReason && reason.trim().length < 5) ||
                !reasonOk ||
                (action?.kind === 'TEACHER' && !teacherId) ||
                (action?.kind === 'ROOM' && !venueId) ||
                (action?.kind === 'RESCHEDULE' && (!start || !end)) ||
                (action?.kind === 'SECTION_SWAP' && !targetSection)
              }
              onClick={() => run.mutate()}
            >
              {run.isPending ? 'Working…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
