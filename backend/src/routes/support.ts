import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest, conflict, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow } from '../plugins/auth';
import { notifyRole, notifyUsers } from '../lib/notify';
import { dayIso, parseDay } from '../services/calendar';
import { DAY_FIRST_START, DAY_LAST_END, SESSION, overlaps, startTimes, toMinutes, fromMinutes } from '../lib/timetable';

const DAY_NAME: Record<number, string> = { 7: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };
const isoDow = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;

/** A student is at risk on a module when their latest attempt failed, needs a resit, or is missing. */
function atRisk(rows: { outcome: string | null; overallMark: number | null }[]) {
  const latest = rows[0];
  if (!latest) return { flag: true, why: 'no result recorded yet' };
  if (latest.outcome === 'FAIL') return { flag: true, why: 'failed' };
  if (latest.outcome === 'RESIT') return { flag: true, why: 'resit' };
  if (latest.overallMark !== null && latest.overallMark < 45) return { flag: true, why: `borderline at ${latest.overallMark}` };
  return { flag: false, why: '' };
}

/** The first window where the teacher and a room are both free on that date. */
async function firstFreeWindow(date: Date, teacherId: string, minutes: number, size: number) {
  const dow = isoDow(date);
  const [slots, rooms, support] = await Promise.all([
    prisma.timetableSlot.findMany({ where: { dayOfWeek: dow }, select: { teacherId: true, venueId: true, startTime: true, endTime: true } }),
    prisma.venue.findMany({ where: { isClassroom: true }, select: { id: true, name: true, rows: true, cols: true, roomType: true } }),
    prisma.supportClass.findMany({ where: { date }, select: { teacherId: true, venueId: true, startTime: true, endTime: true } }),
  ]);
  const booked = [...slots, ...support];
  const wanted = SESSION.TUTORIAL.rooms;
  // A room not on the wanted list sorts last, not first — otherwise indexOf's -1 books the hall.
  const rank = (rt: string) => (wanted.indexOf(rt as never) === -1 ? wanted.length : wanted.indexOf(rt as never));
  const usable = rooms
    .filter((r) => r.rows * r.cols >= size)
    .sort((a, b) => rank(a.roomType) - rank(b.roomType) || a.rows * a.cols - b.rows * b.cols);

  for (const start of startTimes(DAY_FIRST_START, DAY_LAST_END)) {
    const end = fromMinutes(toMinutes(start) + minutes);
    if (toMinutes(end) > toMinutes(DAY_LAST_END)) break;
    if (booked.some((b) => b.teacherId === teacherId && overlaps(b.startTime, b.endTime, start, end))) continue;
    const room = usable.find((r) => !booked.some((b) => b.venueId === r.id && overlaps(b.startTime, b.endTime, start, end)));
    if (room) return { startTime: start, endTime: end, venueId: room.id, venueName: room.name };
  }
  return null;
}

/**
 * Support classes and class alerts.
 *
 * Both exist because a timetable that only describes the plan is not much use when the plan goes
 * wrong. One lays on extra teaching for the students of a module who are actually struggling; the
 * other lets a room full of students tell RTE that nobody has turned up, and finds cover.
 */
export async function supportRoutes(app: FastifyInstance) {
  /** Who on this module needs help, and why. Shown before anything is booked. */
  app.get('/offerings/:id/at-risk', { preHandler: [allow('module.read')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const offering = await prisma.moduleOffering.findUnique({
      where: { id },
      include: {
        module: { select: { code: true, title: true } },
        lecturer: { select: { id: true, name: true } },
        coLecturer: { select: { id: true, name: true } },
        enrollments: {
          where: { deletedAt: null },
          include: {
            student: { select: { id: true, studentId: true, name: true, userId: true, section: { select: { name: true } } } },
            results: { orderBy: { markSheetVersion: 'desc' }, take: 1, select: { outcome: true, overallMark: true } },
          },
          orderBy: { student: { studentId: 'asc' } },
        },
      },
    });
    if (!offering) throw notFound('Module offering not found');

    // One row per student: a resit enrolment and its original are the same person.
    const byStudent = new Map<string, { studentId: string; id: string; name: string; section: string | null; why: string }>();
    for (const e of offering.enrollments) {
      const rows = e.results.map((r) => ({ outcome: r.outcome, overallMark: r.overallMark === null ? null : Number(r.overallMark) }));
      const risk = atRisk(rows);
      if (!risk.flag) {
        byStudent.delete(e.student.id); // a later passing attempt clears the earlier flag
        continue;
      }
      byStudent.set(e.student.id, { id: e.student.id, studentId: e.student.studentId, name: e.student.name, section: e.student.section?.name ?? null, why: risk.why });
    }
    return {
      offering: { id: offering.id, module: offering.module, teachers: [offering.lecturer, offering.coLecturer].filter(Boolean) },
      enrolled: new Set(offering.enrollments.map((e) => e.student.id)).size,
      students: [...byStudent.values()],
    };
  });

  /** Lay on one extra class for those students, at the first time the teacher and a room are free. */
  app.post('/offerings/:id/support-class', { preHandler: [allow('timetable.write')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        teacherId: z.string().optional(),
        studentIds: z.array(z.string()).optional(),
        minutes: z.number().int().min(30).max(180).default(60),
        reason: z.string().trim().min(5).max(300).default('Extra support for students at risk on this module'),
      }),
      req.body,
    );

    const offering = await prisma.moduleOffering.findUnique({
      where: { id },
      include: { module: { select: { code: true, title: true } }, lecturer: { select: { id: true, name: true } }, coLecturer: { select: { id: true, name: true } } },
    });
    if (!offering) throw notFound('Module offering not found');

    const teacherId = body.teacherId ?? offering.lecturerId ?? offering.coLecturerId;
    if (!teacherId) throw badRequest('This module has no teacher to take the class');

    let studentIds = body.studentIds;
    if (!studentIds?.length) {
      const enrolments = await prisma.enrollment.findMany({
        where: { moduleOfferingId: id, deletedAt: null },
        include: { student: { select: { id: true } }, results: { orderBy: { markSheetVersion: 'desc' }, take: 1, select: { outcome: true, overallMark: true } } },
      });
      const flagged = new Set<string>();
      for (const e of enrolments) {
        const risk = atRisk(e.results.map((r) => ({ outcome: r.outcome, overallMark: r.overallMark === null ? null : Number(r.overallMark) })));
        if (risk.flag) flagged.add(e.student.id);
        else flagged.delete(e.student.id);
      }
      studentIds = [...flagged];
    }
    if (!studentIds.length) throw badRequest('Nobody on this module is currently at risk');

    const date = parseDay(body.date);
    const window = await firstFreeWindow(date, teacherId, body.minutes, studentIds.length);
    if (!window) throw conflict('No room and teacher are free together on that date — try another day');

    const created = await prisma.supportClass.create({
      data: {
        moduleOfferingId: id,
        teacherId,
        venueId: window.venueId,
        date,
        startTime: window.startTime,
        endTime: window.endTime,
        reason: body.reason,
        createdById: req.user!.id,
        students: { connect: studentIds.map((sid) => ({ id: sid })) },
      },
      include: { teacher: { select: { id: true, name: true } }, venue: { select: { name: true } }, students: { select: { id: true, studentId: true, name: true, userId: true } } },
    });

    const when = `${DAY_NAME[isoDow(date)]} ${dayIso(date)}, ${window.startTime}–${window.endTime}`;
    const title = `Support class: ${offering.module.code} ${offering.module.title}`;
    const userIds = created.students.map((s) => s.userId).filter((u): u is string => Boolean(u));
    if (userIds.length) {
      await notifyUsers(prisma, userIds, { type: 'support.scheduled', title, body: `${when} in ${window.venueName} with ${created.teacher.name}. ${body.reason}`, payload: { supportClassId: created.id } });
    }
    await notifyUsers(prisma, [teacherId], { type: 'support.scheduled', title: `You are taking a support class: ${offering.module.code}`, body: `${when} in ${window.venueName}, ${created.students.length} students.`, payload: { supportClassId: created.id } });
    await audit(prisma, { ...actorOf(req), action: 'support.create', entityType: 'SupportClass', entityId: created.id, after: { module: offering.module.code, students: created.students.length, when, room: window.venueName }, reason: body.reason });

    reply.code(201);
    return { ...created, when, venueName: window.venueName };
  });

  app.get('/support-classes', { preHandler: [allow('module.read')] }, async () =>
    prisma.supportClass.findMany({
      include: {
        moduleOffering: { select: { id: true, module: { select: { code: true, title: true } } } },
        teacher: { select: { name: true } },
        venue: { select: { name: true } },
        students: { select: { studentId: true, name: true } },
      },
      orderBy: { date: 'desc' },
      take: 100,
    }),
  );

  // ---------- "nobody has turned up to teach this" ----------

  /**
   * A student raises the alert from their own timetable. RTE is told at once, and if a teacher of
   * the same module is free that period, cover is assigned there and then and that teacher is told.
   */
  app.post('/timetable/slots/:id/alert', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        kind: z.enum(['TEACHER_ABSENT', 'NO_TEACHER_ASSIGNED', 'ROOM_PROBLEM']).default('TEACHER_ABSENT'),
        note: z.string().trim().max(300).optional(),
      }),
      req.body,
    );
    const slot = await prisma.timetableSlot.findUnique({
      where: { id },
      include: {
        section: { select: { id: true, name: true } },
        groups: { select: { id: true } },
        teacher: { select: { id: true, name: true } },
        venue: { select: { name: true } },
        moduleOffering: { select: { id: true, lecturerId: true, coLecturerId: true, module: { select: { code: true, title: true, moduleLeaderId: true } } } },
      },
    });
    if (!slot) throw notFound('Class not found');

    const u = req.user!;
    if (u.role === 'STUDENT') {
      const me = await prisma.student.findFirst({ where: { userId: u.id }, select: { sectionId: true } });
      const inRoom = [slot.sectionId, ...slot.groups.map((g) => g.id)];
      if (!me?.sectionId || !inRoom.includes(me.sectionId)) throw badRequest('That class is not one of yours');
    }

    const date = parseDay(body.date);
    // One alert per class per day: twenty students reporting the same empty room is one problem.
    const existing = await prisma.classAlert.findFirst({ where: { slotId: id, date, status: { in: ['OPEN', 'COVER_ASSIGNED'] } }, include: { cover: { select: { name: true } } } });
    if (existing) {
      return { ...existing, alreadyRaised: true, message: existing.coverId ? `Already reported — ${existing.cover?.name} is covering.` : 'Already reported — RTE has been told and is looking for cover.' };
    }

    const alert = await prisma.classAlert.create({ data: { slotId: id, date, kind: body.kind, note: body.note ?? null, raisedById: u.id } });

    // Cover: the module's other teacher first, then any teacher of the same module, if free.
    const dow = isoDow(date);
    const candidates = [slot.moduleOffering.coLecturerId, slot.moduleOffering.lecturerId, slot.moduleOffering.module.moduleLeaderId]
      .filter((c): c is string => Boolean(c) && c !== slot.teacherId);
    let cover: { id: string; name: string } | null = null;
    for (const candidateId of [...new Set(candidates)]) {
      const clash = await prisma.timetableSlot.findFirst({ where: { teacherId: candidateId, dayOfWeek: dow, NOT: { id } } });
      const busy = clash ? overlaps(clash.startTime, clash.endTime, slot.startTime, slot.endTime) : false;
      if (busy) continue;
      const who = await prisma.user.findFirst({ where: { id: candidateId, isActive: true }, select: { id: true, name: true } });
      if (who) {
        cover = who;
        break;
      }
    }

    const what = `${slot.moduleOffering.module.code} ${slot.moduleOffering.module.title}, group ${slot.section.name}, ${slot.startTime}–${slot.endTime}${slot.venue ? ` in ${slot.venue.name}` : ''}`;
    if (cover) {
      await prisma.classAlert.update({ where: { id: alert.id }, data: { status: 'COVER_ASSIGNED', coverId: cover.id } });
      await prisma.slotException.create({
        data: { slotId: id, date, kind: 'TEACHER_CHANGE', teacherId: cover.id, reason: `No teacher present — cover assigned automatically after a student alert${body.note ? `: ${body.note}` : ''}` },
      });
      await notifyUsers(prisma, [cover.id], { type: 'class.cover', title: `Please cover ${slot.moduleOffering.module.code} now`, body: `${what} on ${body.date}. The class reported that no teacher was present.`, payload: { slotId: id, alertId: alert.id } });
    }

    await notifyRole(prisma, 'ADMIN', {
      type: 'class.alert',
      title: cover ? `No teacher in ${slot.moduleOffering.module.code} — ${cover.name} assigned` : `No teacher in ${slot.moduleOffering.module.code} — cover needed`,
      body: `${what} on ${body.date}. Reported by ${u.name}.${body.note ? ` "${body.note}"` : ''}${cover ? '' : ' No teacher of this module is free — please assign someone.'}`,
      payload: { slotId: id, alertId: alert.id, date: body.date },
    });
    if (slot.moduleOffering.module.moduleLeaderId) {
      await notifyUsers(prisma, [slot.moduleOffering.module.moduleLeaderId], { type: 'class.alert', title: `No teacher in ${slot.moduleOffering.module.code}`, body: `${what} on ${body.date}.`, payload: { alertId: alert.id } });
    }
    await audit(prisma, { ...actorOf(req), action: 'class.alert', entityType: 'ClassAlert', entityId: alert.id, after: { slot: what, date: body.date, cover: cover?.name ?? null }, reason: body.note ?? null });

    reply.code(201);
    return { ...alert, cover, message: cover ? `RTE has been told and ${cover.name} is on the way.` : 'RTE has been told and is finding cover now.' };
  });

  app.get('/class-alerts', { preHandler: [allow('timetable.read')] }, async (req) => {
    const { status } = parse(z.object({ status: z.enum(['OPEN', 'COVER_ASSIGNED', 'RESOLVED', 'DISMISSED']).optional() }), req.query);
    return prisma.classAlert.findMany({
      where: status ? { status } : {},
      include: {
        raisedBy: { select: { name: true, role: true } },
        cover: { select: { name: true } },
        slot: { select: { startTime: true, endTime: true, section: { select: { name: true } }, teacher: { select: { name: true } }, venue: { select: { name: true } }, moduleOffering: { select: { module: { select: { code: true, title: true } } } } } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
  });

  /** RTE assigns cover by hand, or closes the alert. */
  app.post('/class-alerts/:id/resolve', { preHandler: [allow('timetable.write')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ status: z.enum(['COVER_ASSIGNED', 'RESOLVED', 'DISMISSED']), coverId: z.string().optional(), note: z.string().trim().max(300).optional() }), req.body);
    const before = await prisma.classAlert.findUnique({ where: { id }, include: { slot: { select: { id: true, startTime: true, endTime: true, moduleOffering: { select: { module: { select: { code: true } } } } } } } });
    if (!before) throw notFound('Alert not found');

    if (body.coverId) {
      await prisma.slotException.create({ data: { slotId: before.slotId, date: before.date, kind: 'TEACHER_CHANGE', teacherId: body.coverId, reason: body.note ?? 'Cover assigned by RTE after a class alert' } });
      await notifyUsers(prisma, [body.coverId], { type: 'class.cover', title: `Please cover ${before.slot.moduleOffering.module.code}`, body: `${before.slot.startTime}–${before.slot.endTime} on ${dayIso(before.date)}.`, payload: { alertId: id } });
    }
    const after = await prisma.classAlert.update({
      where: { id },
      data: { status: body.status, coverId: body.coverId ?? before.coverId, resolutionNote: body.note ?? null, resolvedAt: new Date() },
      include: { cover: { select: { name: true } } },
    });
    await audit(prisma, { ...actorOf(req), action: 'class.alert.resolve', entityType: 'ClassAlert', entityId: id, before: { status: before.status }, after: { status: body.status, cover: after.cover?.name ?? null }, reason: body.note ?? null });
    return after;
  });
}
