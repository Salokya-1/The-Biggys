import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow } from '../plugins/auth';
import { notifyUsers } from '../lib/notify';

/**
 * Attendance below this, once enough of the term has run, is the point at which somebody should
 * be talking to the student rather than waiting for the exam board to find out.
 */
export const AT_RISK_PERCENT = 50;
/** How many weeks must have run before a low percentage means anything. Two missed classes in
 *  week one is noise; the same rate sustained to week five is a pattern. */
export const AT_RISK_AFTER_WEEK = 5;

const COUNTS_AS_PRESENT = ['PRESENT', 'LATE', 'EXCUSED'] as const;

export async function attendanceRoutes(app: FastifyInstance) {
  /** The register for one class on one date, with anything already recorded filled in. */
  app.get('/timetable/slots/:id/register', { preHandler: [allow('attendance.read')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { date } = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.query);
    const on = new Date(`${date}T00:00:00.000Z`);

    const slot = await prisma.timetableSlot.findUnique({
      where: { id },
      include: {
        section: { select: { id: true, name: true } },
        groups: { select: { id: true, name: true } },
        moduleOffering: { select: { id: true, module: { select: { code: true, title: true } } } },
      },
    });
    if (!slot) throw notFound('Class not found');

    const sectionIds = [...new Set([slot.sectionId, ...slot.groups.map((g) => g.id)])];
    const [students, existing] = await Promise.all([
      prisma.student.findMany({
        where: { sectionId: { in: sectionIds }, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, studentId: true, name: true, section: { select: { name: true } } },
        orderBy: { studentId: 'asc' },
      }),
      prisma.attendanceRecord.findMany({ where: { slotId: id, date: on }, select: { studentId: true, status: true } }),
    ]);
    const byStudent = new Map(existing.map((e) => [e.studentId, e.status]));

    return {
      slot: { id: slot.id, startTime: slot.startTime, endTime: slot.endTime, kind: slot.kind },
      module: slot.moduleOffering.module,
      date,
      marked: existing.length > 0,
      students: students.map((s) => ({
        id: s.id,
        studentId: s.studentId,
        name: s.name,
        group: s.section?.name ?? null,
        status: byStudent.get(s.id) ?? null,
      })),
    };
  });

  app.post('/timetable/slots/:id/register', { preHandler: [allow('attendance.write')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        entries: z
          .array(z.object({ studentId: z.string(), status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']) }))
          .min(1)
          .max(500),
      }),
      req.body,
    );
    const on = new Date(`${body.date}T00:00:00.000Z`);
    const slot = await prisma.timetableSlot.findUnique({ where: { id }, select: { moduleOfferingId: true } });
    if (!slot) throw notFound('Class not found');
    const markedById = req.user!.id;

    // A register gets corrected after the fact more often than it gets filed once, so a second
    // submission replaces the first rather than colliding with it.
    await prisma.$transaction([
      prisma.attendanceRecord.deleteMany({ where: { slotId: id, date: on, studentId: { in: body.entries.map((e) => e.studentId) } } }),
      prisma.attendanceRecord.createMany({
        data: body.entries.map((e) => ({
          studentId: e.studentId,
          slotId: id,
          offeringId: slot.moduleOfferingId,
          date: on,
          status: e.status,
          markedById,
        })),
      }),
    ]);
    await audit(prisma, { ...actorOf(req), action: 'attendance.marked', entityType: 'TimetableSlot', entityId: id, after: { date: body.date, entries: body.entries.length } });
    return { ok: true, marked: body.entries.length };
  });

  /** One student's attendance, module by module. */
  app.get('/students/:id/attendance', { preHandler: [allow('attendance.read')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const rows = await prisma.attendanceRecord.findMany({
      where: { studentId: id },
      select: { status: true, date: true, offering: { select: { id: true, module: { select: { code: true, title: true } } } } },
    });
    const byOffering = new Map<string, { code: string; title: string; held: number; attended: number; lastAbsence: Date | null }>();
    for (const r of rows) {
      const key = r.offering.id;
      const cur = byOffering.get(key) ?? { code: r.offering.module.code, title: r.offering.module.title, held: 0, attended: 0, lastAbsence: null };
      cur.held += 1;
      if ((COUNTS_AS_PRESENT as readonly string[]).includes(r.status)) cur.attended += 1;
      else if (!cur.lastAbsence || r.date > cur.lastAbsence) cur.lastAbsence = r.date;
      byOffering.set(key, cur);
    }
    const modules = [...byOffering.entries()].map(([offeringId, v]) => ({
      offeringId,
      ...v,
      percent: v.held ? Math.round((v.attended / v.held) * 100) : null,
    }));
    const held = modules.reduce((n, m) => n + m.held, 0);
    const attended = modules.reduce((n, m) => n + m.attended, 0);
    return {
      overall: held ? Math.round((attended / held) * 100) : null,
      held,
      attended,
      threshold: AT_RISK_PERCENT,
      modules: modules.sort((a, b) => (a.percent ?? 100) - (b.percent ?? 100)),
    };
  });

  /**
   * Everyone whose attendance has fallen below the threshold once enough of the term has run.
   *
   * Weeks are counted from the semester's own start, not from today, so a module that began late
   * is not judged on a fortnight of data.
   */
  app.get('/attendance/at-risk', { preHandler: [allow('attendance.read')] }, async (req) => {
    const q = parse(z.object({ programmeId: z.string().optional(), threshold: z.coerce.number().min(1).max(100).optional() }), req.query);
    const threshold = q.threshold ?? AT_RISK_PERCENT;

    const rows = await prisma.attendanceRecord.findMany({
      where: q.programmeId ? { student: { programmeId: q.programmeId } } : undefined,
      select: {
        status: true,
        studentId: true,
        student: { select: { studentId: true, name: true, programme: { select: { code: true } }, section: { select: { name: true } } } },
        offering: { select: { semester: { select: { startDate: true } } } },
        date: true,
      },
    });

    const now = Date.now();
    const perStudent = new Map<string, { studentId: string; name: string; programme: string; group: string | null; held: number; attended: number; weeks: number }>();
    for (const r of rows) {
      const weeks = Math.floor((now - r.offering.semester.startDate.getTime()) / (7 * 86400e3));
      const cur =
        perStudent.get(r.studentId) ??
        {
          studentId: r.student.studentId,
          name: r.student.name,
          programme: r.student.programme.code,
          group: r.student.section?.name ?? null,
          held: 0,
          attended: 0,
          weeks: 0,
        };
      cur.held += 1;
      if ((COUNTS_AS_PRESENT as readonly string[]).includes(r.status)) cur.attended += 1;
      cur.weeks = Math.max(cur.weeks, weeks);
      perStudent.set(r.studentId, cur);
    }

    const atRisk = [...perStudent.entries()]
      .map(([id, v]) => ({ id, ...v, percent: v.held ? Math.round((v.attended / v.held) * 100) : 100 }))
      .filter((s) => s.weeks >= AT_RISK_AFTER_WEEK && s.percent < threshold)
      .sort((a, b) => a.percent - b.percent);

    return { threshold, afterWeek: AT_RISK_AFTER_WEEK, count: atRisk.length, students: atRisk };
  });

  /** Tell the students on the list, and their programme office, that they are short. */
  app.post('/attendance/at-risk/notify', { preHandler: [allow('attendance.write')] }, async (req) => {
    const body = parse(z.object({ studentIds: z.array(z.string()).min(1).max(500) }), req.body);
    const students = await prisma.student.findMany({
      where: { id: { in: body.studentIds }, userId: { not: null } },
      select: { userId: true, name: true },
    });
    if (students.length === 0) throw badRequest('None of those students has a login to notify');
    const sent = await notifyUsers(prisma, students.map((s) => s.userId!), {
      type: 'attendance.at-risk',
      title: 'Your attendance has fallen below the required level',
      body: `You have attended less than ${AT_RISK_PERCENT}% of your classes. Speak to the RTE office — continuing at this level puts your progression at risk.`,
    });
    await audit(prisma, { ...actorOf(req), action: 'attendance.at-risk.notified', entityType: 'Student', entityId: 'bulk', after: { students: students.length } });
    return { notified: sent };
  });
}
