import { prisma } from '../lib/prisma';
import { examSlots, generateExamSchedule } from '../lib/exam-schedule';
import { capacityOf } from '../lib/seating';
import { audit } from '../lib/audit';
import { notifyRole, notifyUsers } from '../lib/notify';

const AUTO_LEAD_DAYS = 21;

/** Create FINAL exam sessions (with venues and invigilators) for every offering of a semester. */
export async function scheduleSemesterExams(semesterId: string, opts: { actorId: string | null; generatedBy: 'auto' | 'manual'; durationMin?: number; replace?: boolean }) {
  const semester = await prisma.semester.findUnique({
    where: { id: semesterId },
    include: {
      intake: { select: { label: true, programme: { select: { code: true } } } },
      offerings: { include: { module: { select: { code: true, title: true } }, _count: { select: { enrollments: true } } } },
      examSessions: { where: { kind: 'FINAL' }, select: { id: true } },
    },
  });
  if (!semester) throw new Error('Semester not found');
  if (semester.examSessions.length && !opts.replace) return { skipped: true as const, existing: semester.examSessions.length };

  const examStart = semester.examStart ?? new Date(semester.startDate.getTime() + semester.teachingWeeks * 7 * 86400e3);
  const examEnd = semester.examEnd ?? new Date(examStart.getTime() + 14 * 86400e3);
  const venues = await prisma.venue.findMany();
  const teachers = await prisma.user.findMany({ where: { role: { in: ['LECTURER', 'MODULE_LEADER'] }, isActive: true }, select: { id: true, name: true } });

  const result = generateExamSchedule(
    semester.offerings.map((o) => ({ id: o.id, code: o.module.code, semesterId, candidates: o._count.enrollments, teacherId: o.lecturerId })),
    venues.map((v) => ({ id: v.id, name: v.name, capacity: capacityOf({ id: v.id, name: v.name, rows: v.rows, cols: v.cols, disabledSeats: (v.disabledSeats as { row: number; col: number }[]) ?? [], adjacencyMode: v.adjacencyMode }), examHall: !v.isClassroom })),
    teachers,
    examSlots(examStart, examEnd),
    opts.durationMin ?? 120,
  );

  const created: string[] = [];
  await prisma.$transaction(async (tx) => {
    if (opts.replace && semester.examSessions.length) {
      // Take the old sessions apart before deleting them. Relying on the database to cascade is
      // fragile — a camera request or a seat allocation left pointing at a session fails the
      // delete with a foreign-key error and the whole regeneration is lost.
      const oldIds = semester.examSessions.map((e) => e.id);
      await tx.cameraAccessRequest.updateMany({ where: { examSessionId: { in: oldIds } }, data: { examSessionId: null } });
      await tx.seatAllocation.deleteMany({ where: { examSessionId: { in: oldIds } } });
      await tx.examInvigilator.deleteMany({ where: { examSessionId: { in: oldIds } } });
      // Implicit many-to-many rows go with an explicit disconnect, one session at a time.
      for (const id of oldIds) {
        const s = await tx.examSession.findUnique({ where: { id }, select: { offerings: { select: { id: true } }, venues: { select: { id: true } }, sections: { select: { id: true } } } });
        if (!s) continue;
        await tx.examSession.update({
          where: { id },
          data: {
            offerings: { disconnect: s.offerings.map((x) => ({ id: x.id })) },
            venues: { disconnect: s.venues.map((x) => ({ id: x.id })) },
            sections: { disconnect: s.sections.map((x) => ({ id: x.id })) },
          },
        });
      }
      await tx.examSession.deleteMany({ where: { id: { in: oldIds } } });
    }
    for (const s of result.sessions) {
      const off = semester.offerings.find((o) => o.id === s.offeringIds[0])!;
      const session = await tx.examSession.create({
        data: {
          title: `Final exam — ${off.module.code} ${off.module.title} (${semester.intake.programme.code} ${semester.intake.label}, Sem ${semester.number})`,
          kind: 'FINAL',
          seatingMode: 'MIXED',
          semesterId,
          date: s.date,
          startTime: s.startTime,
          durationMin: s.durationMin,
          seed: 1,
          generatedBy: opts.generatedBy,
          offerings: { connect: s.offeringIds.map((id) => ({ id })) },
          venues: { connect: s.venueIds.map((id) => ({ id })) },
          invigilators: { create: s.invigilators.map((i) => ({ venueId: i.venueId, userId: i.userId })) },
        },
      });
      created.push(session.id);
    }
    await audit(tx, { actorId: opts.actorId, action: 'exams.schedule', entityType: 'Semester', entityId: semesterId, after: { generatedBy: opts.generatedBy, sessions: created.length, unscheduled: result.unscheduled, warnings: result.warnings } });
    const invigilatorIds = [...new Set(result.sessions.flatMap((s) => s.invigilators.map((i) => i.userId)))];
    await notifyUsers(tx, invigilatorIds, { type: 'exam.invigilation', title: `Invigilation duties: ${semester.intake.programme.code} ${semester.intake.label} Sem ${semester.number}`, body: `The exam schedule has been ${opts.generatedBy === 'auto' ? 'generated automatically' : 'published'}. Check your calendar for your invigilation slots.`, payload: { semesterId } });
    const students = await tx.user.findMany({ where: { student: { currentSemesterId: semesterId, deletedAt: null } }, select: { id: true } });
    await notifyUsers(tx, students.map((s) => s.id), { type: 'exam.scheduled', title: `Exam timetable published — Semester ${semester.number}`, body: `${created.length} exams between ${examStart.toISOString().slice(0, 10)} and ${examEnd.toISOString().slice(0, 10)}. Pay your semester fee to receive your admit card.`, payload: { semesterId } });
  });
  return { skipped: false as const, sessions: created.length, unscheduled: result.unscheduled, warnings: result.warnings, examStart, examEnd };
}

/** Semesters whose exam window starts within the lead time and that have no FINAL sessions yet. */
export async function autoScheduleDueExams(log: (msg: string, data?: unknown) => void = () => {}) {
  const now = new Date();
  const horizon = new Date(now.getTime() + AUTO_LEAD_DAYS * 86400e3);
  const due = await prisma.semester.findMany({
    where: { term: { not: 'SUMMER' }, examStart: { gte: now, lte: horizon }, examSessions: { none: { kind: 'FINAL' } }, offerings: { some: { enrollments: { some: { deletedAt: null } } } } },
    select: { id: true, number: true, intake: { select: { label: true, programme: { select: { code: true } } } } },
  });
  const done: { semesterId: string; sessions: number }[] = [];
  for (const s of due) {
    try {
      const r = await scheduleSemesterExams(s.id, { actorId: null, generatedBy: 'auto' });
      if (!r.skipped) {
        done.push({ semesterId: s.id, sessions: r.sessions });
        log('auto-scheduled exams', { semester: `${s.intake.programme.code} ${s.intake.label} S${s.number}`, sessions: r.sessions, unscheduled: r.unscheduled.length });
        await notifyRole(prisma, 'ADMIN', { type: 'exam.autoscheduled', title: `Exam schedule generated: ${s.intake.programme.code} ${s.intake.label} Sem ${s.number}`, body: `${r.sessions} sessions created 3 weeks before the exam window. Review venues and invigilators, then generate seating.`, payload: { semesterId: s.id } });
      }
    } catch (err) {
      log('auto-schedule failed', { semesterId: s.id, err: (err as Error).message });
    }
  }
  return done;
}
