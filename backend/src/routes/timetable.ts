import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow, requireRole, STAFF } from '../plugins/auth';
import { DEFAULT_MAX_GAP_MIN, EARLY_PERIODS, STANDARD_PERIODS, findClashes, findGapViolations, generateTimetable, isFinalYearSemester, periodsForSemester, slotDate, suggestSlots, toMinutes } from '../lib/timetable';
import { buildDay, dayIso, parseDay, slotInclude, teacherConflicts, venueConflicts } from '../services/calendar';
import { notifyUsers } from '../lib/notify';

const time = z.string().regex(/^\d{2}:\d{2}$/);
const slotBody = z.object({
  semesterId: z.string().min(1),
  sectionId: z.string().min(1),
  moduleOfferingId: z.string().min(1),
  teacherId: z.string().min(1),
  venueId: z.string().min(1).nullable().optional(),
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: time,
  endTime: time,
  weekFrom: z.number().int().min(1).max(20).optional(),
  weekTo: z.number().int().min(1).max(20).optional(),
});
const exceptionBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['CANCELLED', 'TEACHER_CHANGE', 'ROOM_CHANGE', 'RESCHEDULED']),
  teacherId: z.string().optional(),
  venueId: z.string().optional(),
  startTime: time.optional(),
  endTime: time.optional(),
  reason: z.string().trim().min(3).max(300),
});

/** Students only ever see their own section; staff can look at any section, teacher or room. */
async function scopeFor(req: FastifyRequest, q: { sectionId?: string; teacherId?: string; venueId?: string }) {
  const u = req.user!;
  if (u.role === 'STUDENT') {
    const st = await prisma.student.findFirst({ where: { userId: u.id }, select: { id: true, sectionId: true } });
    if (!st?.sectionId) throw notFound('You are not assigned to a section yet');
    return { sectionId: st.sectionId, studentId: st.id };
  }
  return { sectionId: q.sectionId, teacherId: q.teacherId, venueId: q.venueId };
}

export async function timetableRoutes(app: FastifyInstance) {
  // ---------- semesters for the calendar picker ----------
  app.get('/timetable/semesters', async (req) => {
    const u = req.user!;
    const where = u.role === 'STUDENT' ? { intake: { students: { some: { userId: u.id } } } } : {};
    const semesters = await prisma.semester.findMany({
      where,
      include: { intake: { select: { id: true, label: true, programme: { select: { code: true, name: true } }, sections: { select: { id: true, name: true }, orderBy: { name: 'asc' } } } }, _count: { select: { slots: true, examSessions: true } } },
      orderBy: [{ startDate: 'desc' }, { intake: { programme: { code: 'asc' } } }],
    });
    return semesters.map((s) => ({ ...s, sections: s.intake.sections, examStart: s.examStart ?? new Date(s.startDate.getTime() + s.teachingWeeks * 7 * 86400e3) }));
  });

  // ---------- generate the weekly routine ----------
  app.post('/timetable/generate', { preHandler: [allow('timetable.write')] }, async (req) => {
    const { semesterId, sessionsPerWeek, replace } = parse(z.object({ semesterId: z.string(), sessionsPerWeek: z.number().int().min(1).max(5).default(2), replace: z.boolean().default(false) }), req.body);
    const semester = await prisma.semester.findUnique({
      where: { id: semesterId },
      include: {
        intake: { include: { sections: { include: { _count: { select: { students: true } } } } } },
        offerings: { include: { module: { select: { code: true } }, lecturer: { select: { id: true } } } },
        _count: { select: { slots: true } },
      },
    });
    if (!semester) throw notFound('Semester not found');
    if (semester._count.slots > 0 && !replace) throw conflict('This semester already has a timetable. Pass replace: true to regenerate.');
    if (semester.intake.sections.length === 0) throw badRequest('The intake has no sections');
    const missingTeacher = semester.offerings.filter((o) => !o.lecturerId);
    if (missingTeacher.length) throw badRequest(`Assign a lecturer first: ${missingTeacher.map((o) => o.module.code).join(', ')}`);
    const rooms = await prisma.venue.findMany({ where: { isClassroom: true } });
    // Other semesters running in the same weeks already occupy teachers and rooms.
    const concurrent = await prisma.timetableSlot.findMany({
      where: { semesterId: { not: semesterId }, semester: { startDate: { lte: semester.endDate }, endDate: { gte: semester.startDate } } },
      select: { teacherId: true, venueId: true, dayOfWeek: true, startTime: true, endTime: true },
    });

    // Final-year groups (semesters 5-6) finish by 10:00 on an early grid; nobody gets a gap over two hours.
    const finalYear = isFinalYearSemester(semester.number);
    const result = generateTimetable(
      semester.intake.sections.map((s) => ({
        id: s.id,
        name: s.name,
        size: s._count.students,
        periods: periodsForSemester(semester.number),
        latestEnd: finalYear ? '10:00' : undefined,
        maxGapMinutes: DEFAULT_MAX_GAP_MIN,
      })),
      semester.offerings.map((o) => ({ id: o.id, code: o.module.code, teacherId: o.lecturerId!, sessionsPerWeek })),
      rooms.map((r) => ({ id: r.id, name: r.name, capacity: r.rows * r.cols })),
      undefined,
      concurrent,
    );
    const sectionName = new Map(semester.intake.sections.map((s) => [s.id, s.name]));
    const moduleCode = new Map(semester.offerings.map((o) => [o.id, o.module.code]));
    await prisma.$transaction(async (tx) => {
      await tx.timetableSlot.deleteMany({ where: { semesterId } });
      await tx.timetableSlot.createMany({ data: result.slots.map((s) => ({ semesterId, sectionId: s.sectionId, moduleOfferingId: s.offeringId, teacherId: s.teacherId, venueId: s.venueId, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, weekFrom: 1, weekTo: semester.teachingWeeks })) });
      await audit(tx, { ...actorOf(req), action: 'timetable.generate', entityType: 'Semester', entityId: semesterId, after: { slots: result.slots.length, unplaced: result.unplaced.length, gapViolations: result.gapViolations.length, sessionsPerWeek, finalYear } });
    });
    return {
      slots: result.slots.length,
      sections: semester.intake.sections.length,
      offerings: semester.offerings.length,
      finalYear,
      dayEndsBy: finalYear ? '10:00' : '17:15',
      maxGapHours: DEFAULT_MAX_GAP_MIN / 60,
      unplaced: result.unplaced.map((u) => ({ ...u, section: sectionName.get(u.sectionId), module: moduleCode.get(u.offeringId) })),
      gapViolations: result.gapViolations.map((g) => ({ ...g, section: sectionName.get(g.sectionId) })),
    };
  });

  // ---------- slots ----------
  app.get('/timetable/slots', async (req) => {
    const q = parse(z.object({ semesterId: z.string().optional(), sectionId: z.string().optional(), teacherId: z.string().optional(), venueId: z.string().optional() }), req.query);
    const scope = await scopeFor(req, q);
    const slots = await prisma.timetableSlot.findMany({
      where: {
        ...(q.semesterId ? { semesterId: q.semesterId } : {}),
        ...(scope.sectionId ? { sectionId: scope.sectionId } : {}),
        ...(scope.teacherId ? { teacherId: scope.teacherId } : {}),
        ...(scope.venueId ? { venueId: scope.venueId } : {}),
      },
      include: slotInclude,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }, { section: { name: 'asc' } }],
    });
    return slots;
  });

  /** Free periods this class could move to instead - offered whenever a move is refused. */
  async function alternativesFor(slot: { id?: string; semesterId: string; sectionId: string; teacherId: string; venueId: string | null }) {
    const [semester, section, rooms] = await Promise.all([
      prisma.semester.findUnique({ where: { id: slot.semesterId }, select: { number: true, startDate: true, endDate: true } }),
      prisma.section.findUnique({ where: { id: slot.sectionId }, select: { id: true, _count: { select: { students: true } } } }),
      prisma.venue.findMany({ where: { isClassroom: true }, select: { id: true, name: true, rows: true, cols: true } }),
    ]);
    if (!semester || !section) return [];
    const others = await prisma.timetableSlot.findMany({
      where: { NOT: slot.id ? { id: slot.id } : undefined, semester: { startDate: { lte: semester.endDate }, endDate: { gte: semester.startDate } } },
      select: { sectionId: true, teacherId: true, venueId: true, dayOfWeek: true, startTime: true, endTime: true },
    });
    const finalYear = isFinalYearSemester(semester.number);
    return suggestSlots({
      periods: periodsForSemester(semester.number),
      section: { id: slot.sectionId, size: section._count.students, latestEnd: finalYear ? '10:00' : undefined, maxGapMinutes: DEFAULT_MAX_GAP_MIN },
      teacherId: slot.teacherId,
      currentVenueId: slot.venueId,
      rooms: rooms.map((r) => ({ id: r.id, name: r.name, capacity: r.rows * r.cols })),
      existing: others,
    });
  }

  async function assertNoClash(data: { semesterId: string; sectionId: string; teacherId: string; venueId: string | null; dayOfWeek: number; startTime: string; endTime: string }, excludeId?: string) {
    if (toMinutes(data.endTime) <= toMinutes(data.startTime)) throw badRequest('endTime must be after startTime');
    const others = await prisma.timetableSlot.findMany({
      where: { dayOfWeek: data.dayOfWeek, NOT: excludeId ? { id: excludeId } : undefined, OR: [{ teacherId: data.teacherId }, { sectionId: data.sectionId }, ...(data.venueId ? [{ venueId: data.venueId }] : [])] },
      include: { section: { select: { name: true } }, teacher: { select: { name: true } }, venue: { select: { name: true } }, moduleOffering: { select: { module: { select: { code: true } } } } },
    });
    const clashes = findClashes([{ id: 'new', ...data }, ...others.map((o) => ({ id: o.id, sectionId: o.sectionId, teacherId: o.teacherId, venueId: o.venueId, dayOfWeek: o.dayOfWeek, startTime: o.startTime, endTime: o.endTime }))]).filter((c) => c.a === 'new' || c.b === 'new');
    if (clashes.length) {
      const describe = clashes.map((c) => {
        const o = others.find((x) => x.id === (c.a === 'new' ? c.b : c.a))!;
        return `${c.kind === 'TEACHER' ? o.teacher.name : c.kind === 'SECTION' ? `Section ${o.section.name}` : o.venue?.name} already has ${o.moduleOffering.module.code} (section ${o.section.name}) ${o.startTime}–${o.endTime}`;
      });
      const alternatives = await alternativesFor({ id: excludeId, ...data });
      throw conflict('Timetable clash', { clashes: describe, kinds: [...new Set(clashes.map((c) => c.kind))], alternatives });
    }

    // Constraints: final-year groups finish by 10:00, and no section gets a gap over two hours.
    const sem = await prisma.semester.findUnique({ where: { id: data.semesterId }, select: { number: true } });
    if (sem && isFinalYearSemester(sem.number) && toMinutes(data.endTime) > toMinutes('10:00')) {
      const alternatives = await alternativesFor({ id: excludeId, ...data });
      throw conflict('Final-year classes must finish by 10:00', { clashes: [data.startTime + '-' + data.endTime + ' ends after 10:00 and this is a final-year group'], alternatives });
    }
    const sameDay = await prisma.timetableSlot.findMany({
      where: { sectionId: data.sectionId, dayOfWeek: data.dayOfWeek, NOT: excludeId ? { id: excludeId } : undefined },
      select: { sectionId: true, dayOfWeek: true, startTime: true, endTime: true },
    });
    const gaps = findGapViolations([...sameDay, { sectionId: data.sectionId, dayOfWeek: data.dayOfWeek, startTime: data.startTime, endTime: data.endTime }]);
    if (gaps.length) {
      const alternatives = await alternativesFor({ id: excludeId, ...data });
      throw conflict('That would leave a gap longer than two hours', {
        clashes: gaps.map((g) => Math.round((g.gapMinutes / 60) * 10) / 10 + ' h with nothing between ' + g.after + ' and ' + g.before),
        alternatives,
      });
    }
  }

  app.post('/timetable/slots', { preHandler: [allow('timetable.write')] }, async (req, reply) => {
    const body = parse(slotBody, req.body);
    await assertNoClash({ ...body, venueId: body.venueId ?? null });
    const slot = await prisma.timetableSlot.create({ data: { ...body, venueId: body.venueId ?? null }, include: slotInclude });
    await audit(prisma, { ...actorOf(req), action: 'timetable.slot.create', entityType: 'TimetableSlot', entityId: slot.id, after: body });
    reply.code(201);
    return slot;
  });

  app.patch('/timetable/slots/:id', { preHandler: [allow('timetable.write')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(slotBody.partial(), req.body);
    const before = await prisma.timetableSlot.findUnique({ where: { id } });
    if (!before) throw notFound('Slot not found');
    const merged = { ...before, ...body, venueId: body.venueId === undefined ? before.venueId : body.venueId };
    await assertNoClash({ semesterId: merged.semesterId, sectionId: merged.sectionId, teacherId: merged.teacherId, venueId: merged.venueId, dayOfWeek: merged.dayOfWeek, startTime: merged.startTime, endTime: merged.endTime }, id);
    const after = await prisma.timetableSlot.update({ where: { id }, data: { ...body, venueId: body.venueId === undefined ? undefined : body.venueId }, include: slotInclude });
    await audit(prisma, { ...actorOf(req), action: 'timetable.slot.update', entityType: 'TimetableSlot', entityId: id, before, after: body });
    if (body.teacherId && body.teacherId !== before.teacherId) {
      await notifyUsers(prisma, [body.teacherId, before.teacherId], { type: 'timetable.teacher_changed', title: `Teaching change: ${after.moduleOffering.module.code} section ${after.section.name}`, body: `${after.teacher.name} now teaches this class (${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][after.dayOfWeek - 1]} ${after.startTime}).`, payload: { slotId: id } });
    }
    return after;
  });

  app.delete('/timetable/slots/:id', { preHandler: [allow('timetable.write')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const before = await prisma.timetableSlot.findUnique({ where: { id } });
    if (!before) throw notFound('Slot not found');
    await prisma.timetableSlot.delete({ where: { id } });
    await audit(prisma, { ...actorOf(req), action: 'timetable.slot.delete', entityType: 'TimetableSlot', entityId: id, before });
    return { ok: true };
  });

  // ---------- one-day exceptions (cover teacher, room move, cancel, reschedule) ----------
  app.post('/timetable/slots/:id/exceptions', { preHandler: [allow('timetable.write')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(exceptionBody, req.body);
    const slot = await prisma.timetableSlot.findUnique({ where: { id }, include: slotInclude });
    if (!slot) throw notFound('Slot not found');
    const date = parseDay(body.date);
    const start = body.startTime ?? slot.startTime;
    const end = body.endTime ?? slot.endTime;
    if (body.kind === 'TEACHER_CHANGE') {
      if (!body.teacherId) throw badRequest('teacherId is required for a teacher change');
      const busy = await teacherConflicts(body.teacherId, date, start, end, { excludeSlotId: id });
      if (busy.length) throw conflict('The cover teacher is not free', { conflicts: busy.map((b) => `${b.startTime}–${b.endTime} ${b.title}`) });
    }
    if (body.kind === 'ROOM_CHANGE') {
      if (!body.venueId) throw badRequest('venueId is required for a room change');
      const busy = await venueConflicts(body.venueId, date, start, end, { excludeSlotId: id });
      if (busy.length) throw conflict('The room is not free', { conflicts: busy.map((b) => `${b.startTime}–${b.endTime} ${b.title}`) });
    }
    if (body.kind === 'RESCHEDULED') {
      if (!body.startTime || !body.endTime) throw badRequest('startTime and endTime are required to reschedule');
      const busy = await teacherConflicts(slot.teacherId, date, start, end, { excludeSlotId: id });
      if (busy.length) throw conflict('The teacher is not free at the new time', { conflicts: busy.map((b) => `${b.startTime}–${b.endTime} ${b.title}`) });
    }
    const ex = await prisma.slotException.upsert({
      where: { slotId_date: { slotId: id, date } },
      create: { slotId: id, date, kind: body.kind, teacherId: body.teacherId ?? null, venueId: body.venueId ?? null, startTime: body.startTime ?? null, endTime: body.endTime ?? null, reason: body.reason, createdById: req.user!.id },
      update: { kind: body.kind, teacherId: body.teacherId ?? null, venueId: body.venueId ?? null, startTime: body.startTime ?? null, endTime: body.endTime ?? null, reason: body.reason, createdById: req.user!.id },
    });
    await audit(prisma, { ...actorOf(req), action: 'timetable.exception', entityType: 'TimetableSlot', entityId: id, after: { ...body }, reason: body.reason });
    // tell the section's students and the teachers involved
    const students = await prisma.user.findMany({ where: { student: { sectionId: slot.sectionId, deletedAt: null } }, select: { id: true } });
    const label = `${slot.moduleOffering.module.code} on ${body.date} ${start}`;
    const text = body.kind === 'CANCELLED' ? `Class cancelled: ${label}. ${body.reason}` : body.kind === 'TEACHER_CHANGE' ? `Cover teacher for ${label}.` : body.kind === 'ROOM_CHANGE' ? `Room change for ${label}.` : `${label} moved to ${start}–${end}.`;
    await notifyUsers(prisma, [...students.map((s) => s.id), slot.teacherId, ...(body.teacherId ? [body.teacherId] : [])], { type: 'timetable.exception', title: `Timetable change · section ${slot.section.name}`, body: text, payload: { slotId: id, date: body.date } });
    reply.code(201);
    return ex;
  });

  app.delete('/timetable/exceptions/:id', { preHandler: [allow('timetable.write')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    await prisma.slotException.delete({ where: { id } });
    await audit(prisma, { ...actorOf(req), action: 'timetable.exception.delete', entityType: 'SlotException', entityId: id });
    return { ok: true };
  });

  // ---------- calendar views ----------
  app.get('/timetable/day', async (req) => {
    const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), sectionId: z.string().optional(), teacherId: z.string().optional(), venueId: z.string().optional() }), req.query);
    const scope = await scopeFor(req, q);
    const u = req.user!;
    const filter = { ...scope, ...(u.role === 'LECTURER' || u.role === 'MODULE_LEADER' ? (!q.sectionId && !q.teacherId && !q.venueId ? { teacherId: u.id } : {}) : {}) };
    return { date: q.date, items: await buildDay(parseDay(q.date), filter) };
  });

  app.get('/timetable/week', async (req) => {
    const q = parse(z.object({ semesterId: z.string().optional(), week: z.coerce.number().int().min(1).max(20).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), sectionId: z.string().optional(), teacherId: z.string().optional(), venueId: z.string().optional() }), req.query);
    const scope = await scopeFor(req, q);
    const u = req.user!;
    const filter = { ...scope, semesterId: q.semesterId, ...(u.role === 'LECTURER' || u.role === 'MODULE_LEADER' ? (!q.sectionId && !q.teacherId && !q.venueId ? { teacherId: u.id } : {}) : {}) };
    let monday: Date;
    if (q.semesterId && q.week) {
      const sem = await prisma.semester.findUnique({ where: { id: q.semesterId } });
      if (!sem) throw notFound('Semester not found');
      monday = slotDate(sem.startDate, q.week, 1);
    } else {
      const d = q.date ? parseDay(q.date) : new Date();
      monday = slotDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), 1, 1);
    }
    const days = await Promise.all(Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86400e3)).map(async (d) => ({ date: dayIso(d), items: await buildDay(d, filter) })));
    return { monday: dayIso(monday), days };
  });

  // teachers: everything I teach this week / today (convenience for the mobile app)
  app.get('/timetable/me', { preHandler: [requireRole(...STAFF, 'STUDENT')] }, async (req) => {
    const u = req.user!;
    const scope = await scopeFor(req, {});
    const today = new Date();
    const monday = slotDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())), 1, 1);
    const filter = u.role === 'STUDENT' ? scope : { teacherId: u.id };
    const days = await Promise.all(Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86400e3)).map(async (d) => ({ date: dayIso(d), items: await buildDay(d, filter) })));
    return { monday: dayIso(monday), days };
  });

  // staff directory of teachers (for cover / teacher change pickers)
  app.get('/timetable/teachers', { preHandler: [requireRole(...STAFF)] }, async () =>
    prisma.user.findMany({ where: { role: { in: ['LECTURER', 'MODULE_LEADER'] }, isActive: true }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }),
  );

  // guard: a student asking for a section must own it (used by the calendar UI to show the section name)
  app.get('/timetable/sections', async (req) => {
    const u = req.user!;
    if (u.role === 'STUDENT') {
      const st = await prisma.student.findFirst({ where: { userId: u.id }, select: { section: { select: { id: true, name: true, intake: { select: { label: true, programme: { select: { code: true } } } } } } } });
      return st?.section ? [st.section] : [];
    }
    const { intakeId } = parse(z.object({ intakeId: z.string().optional() }), req.query);
    return prisma.section.findMany({ where: intakeId ? { intakeId } : {}, select: { id: true, name: true, intake: { select: { id: true, label: true, programme: { select: { code: true } } } }, _count: { select: { students: true } } }, orderBy: [{ intake: { startDate: 'desc' } }, { name: 'asc' }] });
  });

  /** Where could this class go instead? Used by drag-and-drop when a move is refused. */
  app.get('/timetable/slots/:id/alternatives', { preHandler: [allow('timetable.write')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const slot = await prisma.timetableSlot.findUnique({ where: { id }, include: slotInclude });
    if (!slot) throw notFound('Slot not found');
    const alternatives = await alternativesFor(slot);
    return { slot: { id: slot.id, module: slot.moduleOffering.module.code, section: slot.section.name, teacher: slot.teacher.name, dayOfWeek: slot.dayOfWeek, startTime: slot.startTime, endTime: slot.endTime }, alternatives };
  });

  /** Sections whose day has a hole longer than two hours, plus final-year classes past the cut-off. */
  app.get('/timetable/health', { preHandler: [allow('timetable.read')] }, async (req) => {
    const { semesterId } = parse(z.object({ semesterId: z.string() }), req.query);
    const semester = await prisma.semester.findUnique({ where: { id: semesterId }, select: { number: true } });
    if (!semester) throw notFound('Semester not found');
    const slots = await prisma.timetableSlot.findMany({ where: { semesterId }, include: slotInclude });
    const names = new Map(slots.map((s) => [s.sectionId, s.section.name]));
    const finalYear = isFinalYearSemester(semester.number);
    const gaps = findGapViolations(slots).map((g) => ({ ...g, section: names.get(g.sectionId) ?? g.sectionId }));
    const lateFinalYear = finalYear
      ? slots.filter((s) => toMinutes(s.endTime) > toMinutes('10:00')).map((s) => ({ slotId: s.id, section: s.section.name, module: s.moduleOffering.module.code, dayOfWeek: s.dayOfWeek, endTime: s.endTime }))
      : [];
    const clashes = findClashes(slots.map((s) => ({ id: s.id, sectionId: s.sectionId, teacherId: s.teacherId, venueId: s.venueId, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime })));
    return { finalYear, dayEndsBy: finalYear ? '10:00' : '17:15', maxGapHours: DEFAULT_MAX_GAP_MIN / 60, gaps, lateFinalYear, clashes: clashes.length, slots: slots.length };
  });

  /** The period grid a semester uses, so the calendar can draw drop targets. */
  app.get('/timetable/periods', { preHandler: [allow('timetable.read')] }, async (req) => {
    const { semesterId } = parse(z.object({ semesterId: z.string().optional() }), req.query);
    const semester = semesterId ? await prisma.semester.findUnique({ where: { id: semesterId }, select: { number: true } }) : null;
    const finalYear = isFinalYearSemester(semester?.number ?? 1);
    const periods = (finalYear ? EARLY_PERIODS : STANDARD_PERIODS).filter((p) => p.dayOfWeek === 1).map((p) => ({ startTime: p.startTime, endTime: p.endTime }));
    return { finalYear, dayEndsBy: finalYear ? '10:00' : '17:15', maxGapHours: DEFAULT_MAX_GAP_MIN / 60, periods };
  });

  // unused-import guard
  void forbidden;
}
