import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { overlaps, slotDate, toMinutes, weekOf } from '../lib/timetable';

/** ISO date (YYYY-MM-DD) → UTC midnight Date. */
export function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export const dayIso = (d: Date) => d.toISOString().slice(0, 10);
export const isoDow = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1; // 1 = Monday

const slotInclude = {
  section: { select: { id: true, name: true, intake: { select: { id: true, label: true, programme: { select: { code: true } } } } } },
  moduleOffering: { select: { id: true, module: { select: { code: true, title: true } } } },
  teacher: { select: { id: true, name: true } },
  venue: { select: { id: true, name: true, building: true } },
  semester: { select: { id: true, number: true, term: true, startDate: true, teachingWeeks: true, examStart: true, examEnd: true } },
} satisfies Prisma.TimetableSlotInclude;

export type SlotWithRelations = Prisma.TimetableSlotGetPayload<{ include: typeof slotInclude }>;

export interface DayItem {
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

export interface DayFilter {
  sectionId?: string;
  teacherId?: string;
  venueId?: string;
  studentId?: string; // for the student's own seat on exams
}

const addMinutes = (t: string, min: number) => {
  const m = toMinutes(t) + min;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Everything happening on one calendar day: weekly slots (with exceptions applied) plus exam sessions. */
export async function buildDay(date: Date, filter: DayFilter): Promise<DayItem[]> {
  const dow = isoDow(date);
  const dayEnd = new Date(date.getTime() + 86400e3 - 1);
  const semesters = await prisma.semester.findMany({ where: { startDate: { lte: dayEnd }, endDate: { gte: date } }, select: { id: true, startDate: true, teachingWeeks: true } });
  const items: DayItem[] = [];

  const teachingSemesters = semesters.map((s) => ({ ...s, week: weekOf(s.startDate, date, s.teachingWeeks) })).filter((s) => s.week !== null);
  if (teachingSemesters.length) {
    const slots = await prisma.timetableSlot.findMany({
      where: {
        semesterId: { in: teachingSemesters.map((s) => s.id) },
        dayOfWeek: dow,
        ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
        ...(filter.venueId ? { venueId: filter.venueId } : {}),
      },
      include: { ...slotInclude, exceptions: { where: { date } , include: { teacher: { select: { id: true, name: true } }, venue: { select: { id: true, name: true, building: true } } } } },
      orderBy: [{ startTime: 'asc' }, { section: { name: 'asc' } }],
    });
    for (const s of slots) {
      const sem = teachingSemesters.find((x) => x.id === s.semesterId)!;
      if (sem.week! < s.weekFrom || sem.week! > s.weekTo) continue;
      const ex = s.exceptions[0];
      const teacher = ex?.kind === 'TEACHER_CHANGE' && ex.teacher ? ex.teacher : s.teacher;
      const venue = ex?.kind === 'ROOM_CHANGE' && ex.venue ? ex.venue : s.venue;
      const startTime = ex?.kind === 'RESCHEDULED' && ex.startTime ? ex.startTime : s.startTime;
      const endTime = ex?.kind === 'RESCHEDULED' && ex.endTime ? ex.endTime : s.endTime;
      if (filter.teacherId && teacher.id !== filter.teacherId && s.teacher.id !== filter.teacherId) continue;
      items.push({
        kind: 'CLASS',
        id: `slot:${s.id}:${dayIso(date)}`,
        date: dayIso(date),
        startTime,
        endTime,
        title: `${s.moduleOffering.module.code} · ${s.moduleOffering.module.title}`,
        subtitle: `Section ${s.section.name} · ${s.section.intake.programme.code} ${s.section.intake.label} · ${teacher.name}${venue ? ` · ${venue.name}` : ''}`,
        module: s.moduleOffering.module,
        section: { id: s.section.id, name: s.section.name },
        teacher,
        venue: venue ? { id: venue.id, name: venue.name } : null,
        slotId: s.id,
        status: ex ? (ex.kind === 'CANCELLED' ? 'CANCELLED' : 'CHANGED') : 'SCHEDULED',
        change: ex ? { kind: ex.kind, reason: ex.reason, originalTeacher: ex.kind === 'TEACHER_CHANGE' ? s.teacher.name : null, originalVenue: ex.kind === 'ROOM_CHANGE' ? s.venue?.name ?? null : null } : undefined,
        week: sem.week!,
      });
    }
  }

  // Exams on this date
  const exams = await prisma.examSession.findMany({
    where: { date },
    include: {
      offerings: { select: { id: true, module: { select: { code: true, title: true } }, semester: { select: { intake: { select: { label: true, programme: { select: { code: true } } } } } } } },
      sections: { select: { id: true, name: true } },
      venues: { select: { id: true, name: true } },
      invigilators: { include: { user: { select: { id: true, name: true } }, venue: { select: { name: true } } } },
      seatAllocations: { where: { studentId: filter.studentId ?? '__none__' }, include: { venue: { select: { name: true } } } },
    },
    orderBy: { startTime: 'asc' },
  });
  for (const e of exams) {
    if (filter.teacherId && !e.invigilators.some((i) => i.userId === filter.teacherId)) continue;
    if (filter.sectionId) {
      const sec = await prisma.section.findUnique({ where: { id: filter.sectionId }, select: { intakeId: true } });
      const relevant = e.sections.length ? e.sections.some((s) => s.id === filter.sectionId) : await prisma.enrollment.count({ where: { moduleOfferingId: { in: e.offerings.map((o) => o.id) }, student: { intakeId: sec?.intakeId } } }).then((n) => n > 0);
      if (!relevant) continue;
    }
    if (filter.venueId && !e.venues.some((v) => v.id === filter.venueId)) continue;
    const seat = e.seatAllocations[0] ? `${e.seatAllocations[0].venue.name} ${e.seatAllocations[0].seatLabel}` : null;
    items.push({
      kind: 'EXAM',
      id: `exam:${e.id}`,
      date: dayIso(date),
      startTime: e.startTime,
      endTime: addMinutes(e.startTime, e.durationMin),
      title: `${e.kind === 'CLASS_TEST' ? 'Class test' : e.kind === 'RESIT' ? 'Resit exam' : 'Exam'} · ${e.offerings.map((o) => o.module.code).join(', ')}`,
      subtitle: `${e.title} · ${e.venues.map((v) => v.name).join(', ')}${e.sections.length ? ` · sections ${e.sections.map((s) => s.name).join(', ')}` : ''}`,
      examSessionId: e.id,
      status: 'SCHEDULED',
      seat,
      invigilators: e.invigilators.map((i) => ({ name: i.user.name, venue: i.venue.name })),
    });
  }
  return items.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime) || a.title.localeCompare(b.title));
}

/** Is a teacher free at date/time? Checks weekly slots (with exceptions) and exam invigilations. */
export async function teacherConflicts(teacherId: string, date: Date, startTime: string, endTime: string, opts: { excludeSlotId?: string; excludeExamId?: string } = {}) {
  const items = await buildDay(date, { teacherId });
  return items.filter((i) => {
    if (opts.excludeSlotId && i.slotId === opts.excludeSlotId) return false;
    if (opts.excludeExamId && i.examSessionId === opts.excludeExamId) return false;
    return i.status !== 'CANCELLED' && overlaps(startTime, endTime, i.startTime, i.endTime);
  });
}

export async function venueConflicts(venueId: string, date: Date, startTime: string, endTime: string, opts: { excludeSlotId?: string; excludeExamId?: string } = {}) {
  const items = await buildDay(date, { venueId });
  return items.filter((i) => {
    if (opts.excludeSlotId && i.slotId === opts.excludeSlotId) return false;
    if (opts.excludeExamId && i.examSessionId === opts.excludeExamId) return false;
    return i.status !== 'CANCELLED' && overlaps(startTime, endTime, i.startTime, i.endTime);
  });
}

export { slotInclude, slotDate };
