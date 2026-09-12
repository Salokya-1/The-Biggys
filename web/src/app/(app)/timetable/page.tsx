'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MODULE_PALETTE } from '@/components/seat-grid';
import { api, ApiError, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

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
  examSessionId?: string;
  status: 'SCHEDULED' | 'CANCELLED' | 'CHANGED';
  change?: { kind: string; reason: string; originalTeacher?: string | null; originalVenue?: string | null };
  week?: number;
  seat?: string | null;
  invigilators?: { name: string; venue: string }[];
}
interface Week {
  monday: string;
  days: { date: string; items: Item[] }[];
}
interface Teacher {
  id: string;
  name: string;
}
interface Venue {
  id: string;
  name: string;
  isClassroom: boolean;
}

const DAY_START = 8 * 60;
const DAY_END = 18 * 60;
const PX_PER_MIN = 1.1;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const todayIso = () => new Date().toISOString().slice(0, 10);
const plusDaysIso = (d: number) => new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);
const subscribeNoop = () => () => {};
/** Today's date read through an external-store hook so rendering stays pure. */
const useToday = () => useSyncExternalStore(subscribeNoop, todayIso, todayIso);

function weekOfDate(sem: Semester, iso: string): number {
  const start = new Date(sem.startDate);
  const monday = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - ((start.getUTCDay() + 6) % 7)));
  const d = new Date(iso + 'T00:00:00Z');
  return Math.floor((d.getTime() - monday.getTime()) / (7 * 86400e3)) + 1;
}

export default function TimetablePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isStaff = user?.role !== 'STUDENT';
  const isAdmin = user?.role === 'ADMIN';

  const semesters = useQuery({ queryKey: ['tt', 'semesters'], queryFn: () => api<Semester[]>('/api/timetable/semesters') });
  const teachers = useQuery({ queryKey: ['tt', 'teachers'], queryFn: () => api<Teacher[]>('/api/timetable/teachers'), enabled: !!isStaff });
  const venues = useQuery({ queryKey: ['venues'], queryFn: () => api<Venue[]>('/api/venues'), enabled: !!isStaff });

  const [semesterId, setSemesterId] = useState<string>('');
  const [week, setWeek] = useState<number>(0);
  const [sectionId, setSectionId] = useState('all');
  const [teacherId, setTeacherId] = useState('all');
  const [venueId, setVenueId] = useState('all');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const today = useToday();
  const soon = useSyncExternalStore(subscribeNoop, () => plusDaysIso(21), () => plusDaysIso(21));

  // Default: the semester running (or starting within three weeks) with the most classes, else the fullest overall.
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

  const generate = useMutation({
    mutationFn: () => api<{ slots: number; unplaced: unknown[] }>('/api/timetable/generate', { method: 'POST', body: { semesterId: sem!.id, replace: (sem?._count.slots ?? 0) > 0 } }),
    onSuccess: (r) => {
      toast.success(`Routine generated: ${r.slots} weekly classes${r.unplaced.length ? `, ${r.unplaced.length} could not be placed` : ''}`);
      void qc.invalidateQueries({ queryKey: ['tt'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Generation failed'),
  });

  const modules = useMemo(() => [...new Set((wk.data?.days ?? []).flatMap((d) => d.items.filter((i) => i.kind === 'CLASS').map((i) => i.module?.code ?? '')))].sort(), [wk.data]);
  const colourOf = (item: Item) => (item.kind === 'EXAM' ? 'bg-brand-orange/25 border-brand-orange' : `${MODULE_PALETTE[Math.max(0, modules.indexOf(item.module?.code ?? '')) % MODULE_PALETTE.length]} border-transparent`);

  const isExamWeek = sem ? effectiveWeek > sem.teachingWeeks : false;
  const selected = wk.data?.days.find((d) => d.date === selectedDay) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Timetable</h1>
          <p className="text-sm text-muted-foreground">
            {isStaff ? 'One constant weekly routine per section for the 12 teaching weeks, then the 2-week exam window. Click a day for the day view and changes.' : 'Your section\'s weekly routine and exam dates. Click a day to see details or to request an absence.'}
          </p>
        </div>
        {isAdmin && sem && (
          <Button size="sm" variant={sem._count.slots ? 'outline' : 'default'} disabled={generate.isPending} onClick={() => (sem._count.slots === 0 || confirm(`Regenerate the routine for ${sem.intake.programme.code} ${sem.intake.label} Semester ${sem.number}? Existing slots and one-off changes are replaced.`)) && generate.mutate()}>
            <RefreshCw className={cn('mr-1 h-4 w-4', generate.isPending && 'animate-spin')} /> {sem._count.slots ? 'Regenerate routine' : 'Generate routine'}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {semesters.data && (
          <Select value={sem?.id ?? ''} onValueChange={(v) => { setSemesterId(v ?? ''); setWeek(0); setSectionId('all'); }} items={Object.fromEntries(semesters.data.map((s) => [s.id, `${s.intake.programme.code} ${s.intake.label} · Sem ${s.number} (${s.term.toLowerCase()})`]))}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Semester" /></SelectTrigger>
            <SelectContent>{semesters.data.map((s) => <SelectItem key={s.id} value={s.id}>{s.intake.programme.code} {s.intake.label} · Sem {s.number} ({s.term.toLowerCase()}){s._count.slots ? '' : ' · no routine'}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => setWeek(Math.max(1, effectiveWeek - 1))} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
          <span className={cn('min-w-[9rem] text-center text-sm', isExamWeek && 'font-semibold text-brand-orange')}>{isExamWeek ? `Exam week ${effectiveWeek - (sem?.teachingWeeks ?? 12)}` : `Week ${effectiveWeek} of ${sem?.teachingWeeks ?? 12}`}{wk.data ? ` · ${wk.data.monday}` : ''}</span>
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

      {wk.isError && <Alert variant="destructive"><AlertDescription>{(wk.error as Error).message}</AlertDescription></Alert>}
      {sem && sem._count.slots === 0 && !isExamWeek && (
        <Alert><AlertDescription>No routine has been generated for this semester yet.{isAdmin ? ' Use “Generate routine”.' : ''}</AlertDescription></Alert>
      )}

      {/* ---------- week grid ---------- */}
      {wk.isPending && sem ? (
        <Skeleton className="h-[480px] w-full" />
      ) : wk.data ? (
        <div className="overflow-x-auto border bg-card">
          <div className="grid min-w-[900px]" style={{ gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }}>
            <div className="border-b border-r bg-muted/40" />
            {wk.data.days.map((d, i) => {
              const isToday = d.date === today;
              return (
                <button key={d.date} onClick={() => setSelectedDay(d.date)} className={cn('border-b border-r px-2 py-2 text-left text-xs hover:bg-accent', isToday && 'bg-primary/10')}>
                  <div className="font-semibold">{DAYS[i]}</div>
                  <div className="text-muted-foreground">{d.date.slice(5)} · {d.items.length} item{d.items.length === 1 ? '' : 's'}</div>
                </button>
              );
            })}
            <div className="relative border-r" style={{ height: (DAY_END - DAY_START) * PX_PER_MIN }}>
              {Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, h) => (
                <div key={h} className="absolute right-1 text-[10px] text-muted-foreground" style={{ top: h * 60 * PX_PER_MIN - 6 }}>{String(8 + h).padStart(2, '0')}:00</div>
              ))}
            </div>
            {wk.data.days.map((d) => (
              <div key={d.date} className="relative border-r" style={{ height: (DAY_END - DAY_START) * PX_PER_MIN }} onClick={() => setSelectedDay(d.date)}>
                {Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, h) => <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: h * 60 * PX_PER_MIN }} />)}
                {d.items.map((it) => {
                  const top = Math.max(0, (toMin(it.startTime) - DAY_START) * PX_PER_MIN);
                  const height = Math.max(22, (toMin(it.endTime) - toMin(it.startTime)) * PX_PER_MIN - 2);
                  return (
                    <div key={it.id} className={cn('absolute inset-x-0.5 overflow-hidden border-l-4 px-1.5 py-0.5 text-[11px] leading-tight', colourOf(it), it.status === 'CANCELLED' && 'opacity-50 line-through')} style={{ top, height }} title={`${it.startTime}–${it.endTime} ${it.title}\n${it.subtitle}`}>
                      <div className="truncate font-semibold">{it.kind === 'EXAM' ? '📝 ' : ''}{it.module?.code ?? it.title}{it.section && isStaff ? ` · ${it.section.name}` : ''}</div>
                      <div className="truncate">{it.startTime}–{it.endTime}{it.venue ? ` · ${it.venue.name}` : ''}{it.seat ? ` · seat ${it.seat}` : ''}</div>
                      {it.status === 'CHANGED' && <div className="truncate text-brand-orange">changed</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {modules.map((m, i) => <span key={m} className={cn('border-l-4 px-1.5', MODULE_PALETTE[i % MODULE_PALETTE.length])}>{m}</span>)}
        <span className="border-l-4 border-brand-orange bg-brand-orange/25 px-1.5">Exam</span>
      </div>

      {/* ---------- day view ---------- */}
      {selected && sem && (
        <DayView day={selected} sem={sem} teachers={teachers.data ?? []} venues={venues.data ?? []} onClose={() => setSelectedDay(null)} />
      )}
    </div>
  );
}

function DayView({ day, sem, teachers, venues, onClose }: { day: { date: string; items: Item[] }; sem: Semester; teachers: Teacher[]; venues: Venue[]; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';
  const isStudent = user?.role === 'STUDENT';
  const [action, setAction] = useState<{ kind: 'CANCEL' | 'TEACHER' | 'ROOM' | 'RESCHEDULE' | 'TEACHER_ABSENCE' | 'STUDENT_ABSENCE' | 'SECTION_SWAP'; item?: Item } | null>(null);
  const [reason, setReason] = useState('');
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
    onError: (e) => toast.error(e instanceof ApiError && e.details && typeof e.details === 'object' && 'clashes' in e.details ? `${e.message}: ${(e.details as { clashes: string[] }).clashes.join('; ')}` : e instanceof ApiError && e.details && typeof e.details === 'object' && 'conflicts' in e.details ? `${e.message}: ${(e.details as { conflicts: string[] }).conflicts.join('; ')}` : e instanceof Error ? e.message : 'Failed'),
  });

  const titles: Record<string, string> = { CANCEL: 'Cancel this class', TEACHER: 'Cover teacher for this class', ROOM: 'Move this class to another room', RESCHEDULE: 'Reschedule this class', TEACHER_ABSENCE: 'Report my absence', STUDENT_ABSENCE: 'Request absence from this class', SECTION_SWAP: 'Request a section change' };

  return (
    <div className="border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /><span className="font-semibold">{new Date(day.date + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</span><span className="text-xs text-muted-foreground">{day.items[0]?.week ? `week ${day.items[0].week}` : ''}</span></div>
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
                {isAdmin && (
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
            <div className="space-y-1"><Label>Reason (recorded and shown to everyone affected)</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Guest lecture in the auditorium / medical appointment" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>Back</Button>
            <Button disabled={run.isPending || reason.trim().length < 3 || (action?.kind === 'TEACHER' && !teacherId) || (action?.kind === 'ROOM' && !venueId) || (action?.kind === 'RESCHEDULE' && (!start || !end)) || (action?.kind === 'SECTION_SWAP' && !targetSection)} onClick={() => run.mutate()}>{run.isPending ? 'Working…' : 'Confirm'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
