import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow, requireRole, STAFF } from '../plugins/auth';
import { capacityOf, findViolations, generateOrderedSeating, generateSeating, type SeatStudent, type SeatVenue } from '../lib/seating';
import { notifyUsers } from '../lib/notify';
import { renderSeatingPdf } from '../services/seating-pdf';
import { scheduleSemesterExams } from '../services/exams';
import { teacherConflicts } from '../services/calendar';
import { fromMinutes, overlaps, toMinutes } from '../lib/timetable';

const addMinutes = (t: string, min: number) => fromMinutes(toMinutes(t) + min);
/** ISO weekday: 1 = Monday … 7 = Sunday. */
const isoDow = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;

const seatSchema = z.object({ row: z.number().int().min(1), col: z.number().int().min(1) });
const venueBody = z.object({
  name: z.string().trim().min(1).max(60),
  building: z.string().trim().min(1).max(60),
  rows: z.number().int().min(1).max(60),
  cols: z.number().int().min(1).max(60),
  disabledSeats: z.array(seatSchema).max(500).default([]),
  adjacencyMode: z.enum(['ROW', 'ROW_AND_COLUMN']).default('ROW'),
  isClassroom: z.boolean().optional(),
  /** What the room is for: a lecture needs a hall, a workshop a lab, a tutorial a seminar room. */
  roomType: z.enum(['HALL', 'LECTURE_THEATRE', 'TUTORIAL_ROOM', 'SEMINAR_ROOM', 'LAB']).optional(),
  /** Drawn layout from the room designer: cell kind per "row:col" plus how seats are labelled. */
  layout: z
    .object({
      cells: z.record(z.string(), z.enum(['DESK', 'AISLE', 'OFF', 'TEACHER'])).optional(),
      labelMode: z.enum(['ROW_LETTER', 'NUMERIC']).optional(),
      note: z.string().max(200).optional(),
    })
    .nullable()
    .optional(),
});

/** A drawn layout is the source of truth for which cells are seats; keep disabledSeats in step with it. */
function disabledFromLayout(layout: { cells?: Record<string, string> } | null | undefined, rows: number, cols: number) {
  if (!layout?.cells) return null;
  const off: { row: number; col: number }[] = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const kind = layout.cells[`${r}:${c}`];
      if (kind && kind !== 'DESK') off.push({ row: r, col: c });
    }
  }
  return off;
}
const sessionBody = z.object({
  title: z.string().trim().min(3).max(160),
  kind: z.enum(['FINAL', 'CLASS_TEST', 'RESIT']).default('FINAL'),
  seatingMode: z.enum(['MIXED', 'BY_ID']).default('MIXED'),
  semesterId: z.string().min(1).optional(),
  date: z.coerce.date(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.number().int().min(15).max(480),
  offeringIds: z.array(z.string().min(1)).min(1).max(20),
  venueIds: z.array(z.string().min(1)).min(1).max(20),
  sectionIds: z.array(z.string().min(1)).max(50).optional(),
  invigilators: z.array(z.object({ venueId: z.string().min(1), userId: z.string().min(1) })).max(50).optional(),
  seed: z.number().int().min(1).max(1_000_000).optional(),
});

const sessionInclude = {
  offerings: {
    select: {
      id: true,
      lecturerId: true,
      module: { select: { code: true, title: true } },
      semester: { select: { number: true, intake: { select: { label: true, programme: { select: { code: true } } } } } },
      _count: { select: { enrollments: true } },
    },
  },
  venues: true,
  sections: { select: { id: true, name: true } },
  invigilators: { include: { user: { select: { id: true, name: true } }, venue: { select: { id: true, name: true } } } },
  semester: { select: { id: true, number: true, term: true, intake: { select: { label: true, programme: { select: { code: true } } } } } },
  _count: { select: { seatAllocations: true } },
} satisfies Prisma.ExamSessionInclude;

const endOf = (startTime: string, durationMin: number) => {
  const m = toMinutes(startTime) + durationMin;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Every invigilator must be free (no class, no other invigilation) for the whole session. */
async function assertInvigilatorsFree(invigilators: { venueId: string; userId: string }[], date: Date, startTime: string, durationMin: number, excludeExamId?: string) {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const inv of invigilators) {
    if (seen.has(inv.userId)) {
      problems.push(`the same teacher is listed for two venues`);
      continue;
    }
    seen.add(inv.userId);
    const busy = await teacherConflicts(inv.userId, date, startTime, endOf(startTime, durationMin), { excludeExamId });
    if (busy.length) {
      const who = await prisma.user.findUnique({ where: { id: inv.userId }, select: { name: true } });
      problems.push(`${who?.name ?? inv.userId} is already busy: ${busy.map((b) => `${b.startTime}–${b.endTime} ${b.title}`).join('; ')}`);
    }
  }
  if (problems.length) throw conflict('Invigilator clash', { clashes: problems });
}

function toSeatVenue(v: { id: string; name: string; rows: number; cols: number; disabledSeats: unknown; adjacencyMode: 'ROW' | 'ROW_AND_COLUMN' }): SeatVenue {
  return { id: v.id, name: v.name, rows: v.rows, cols: v.cols, disabledSeats: (v.disabledSeats as { row: number; col: number }[]) ?? [], adjacencyMode: v.adjacencyMode };
}

/** Students sitting this session: active enrolments on its offerings (restricted to the session's sections for class tests), one row per student. */
async function candidatesFor(sessionId: string): Promise<(SeatStudent & { sectionName: string | null })[]> {
  const session = await prisma.examSession.findUnique({ where: { id: sessionId }, select: { sections: { select: { id: true } } } });
  const sectionIds = session?.sections.map((s) => s.id) ?? [];
  const enrollments = await prisma.enrollment.findMany({
    where: {
      deletedAt: null,
      moduleOffering: { examSessions: { some: { id: sessionId } } },
      student: { deletedAt: null, status: { in: ['ACTIVE', 'DEFERRED'] }, ...(sectionIds.length ? { sectionId: { in: sectionIds } } : {}) },
    },
    include: { student: { select: { id: true, studentId: true, name: true, specialNeedsSeating: true, section: { select: { name: true } } } }, moduleOffering: { select: { id: true, module: { select: { code: true } } } } },
    orderBy: [{ student: { studentId: 'asc' } }, { attempt: 'desc' }],
  });
  const seen = new Set<string>();
  const out: (SeatStudent & { sectionName: string | null })[] = [];
  for (const e of enrollments) {
    const k = `${e.studentId}:${e.moduleOfferingId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ studentId: e.student.id, label: e.student.studentId, name: e.student.name, offeringId: e.moduleOfferingId, moduleCode: e.moduleOffering.module.code, specialNeeds: e.student.specialNeedsSeating, sectionName: e.student.section?.name ?? null });
  }
  return out;
}

async function loadAllocations(sessionId: string) {
  return prisma.seatAllocation.findMany({
    where: { examSessionId: sessionId },
    include: { student: { select: { id: true, studentId: true, name: true, specialNeedsSeating: true, userId: true } }, moduleOffering: { select: { id: true, module: { select: { code: true } } } } },
    orderBy: [{ venueId: 'asc' }, { row: 'asc' }, { col: 'asc' }],
  });
}

export async function examRoutes(app: FastifyInstance) {
  // ---------- venues ----------
  app.get('/venues', { preHandler: [allow('seating.read')] }, async () => {
    const venues = await prisma.venue.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { examSessions: true } } } });
    return venues.map((v) => ({ ...v, capacity: capacityOf(toSeatVenue(v)) }));
  });
  app.post('/venues', { preHandler: [allow('venue.write')] }, async (req, reply) => {
    const body = parse(venueBody, req.body);
    if (body.disabledSeats.some((s) => s.row > body.rows || s.col > body.cols)) throw badRequest('A disabled seat is outside the grid');
    const drawn = disabledFromLayout(body.layout, body.rows, body.cols);
    const v = await prisma.venue.create({
      data: {
        ...body,
        disabledSeats: (drawn ?? body.disabledSeats) as Prisma.InputJsonValue,
        layout: (body.layout ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
    await audit(prisma, { ...actorOf(req), action: 'venue.create', entityType: 'Venue', entityId: v.id, after: v });
    reply.code(201);
    return v;
  });
  app.patch('/venues/:id', { preHandler: [allow('venue.write')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(venueBody.partial(), req.body);
    const before = await prisma.venue.findUnique({ where: { id } });
    if (!before) throw notFound('Venue not found');
    const rows = body.rows ?? before.rows;
    const cols = body.cols ?? before.cols;
    if ((body.disabledSeats ?? []).some((s) => s.row > rows || s.col > cols)) throw badRequest('A disabled seat is outside the grid');
    const drawn = body.layout === undefined ? null : disabledFromLayout(body.layout, rows, cols);
    const after = await prisma.venue.update({
      where: { id },
      data: {
        ...body,
        disabledSeats: (drawn ?? body.disabledSeats) as Prisma.InputJsonValue | undefined,
        layout: body.layout === undefined ? undefined : ((body.layout ?? Prisma.JsonNull) as Prisma.InputJsonValue),
      },
    });
    await audit(prisma, { ...actorOf(req), action: 'venue.update', entityType: 'Venue', entityId: id, before, after });
    return after;
  });

  // ---------- sessions ----------
  app.get('/exams', { preHandler: [allow('seating.read')] }, async () => {
    const sessions = await prisma.examSession.findMany({ include: sessionInclude, orderBy: { date: 'asc' } });
    return sessions.map((s) => ({
      ...s,
      capacity: s.venues.reduce((n, v) => n + capacityOf(toSeatVenue(v)), 0),
      candidates: s.offerings.reduce((n, o) => n + o._count.enrollments, 0),
      seated: s._count.seatAllocations,
    }));
  });

  // Admin creates any session; a lecturer / module leader may create a CLASS_TEST for offerings they teach or lead.
  app.post('/exams', { preHandler: [allow('exam.create')] }, async (req, reply) => {
    const body = parse(sessionBody, req.body);
    const u = req.user!;
    if (u.role !== 'ADMIN') {
      if (body.kind !== 'CLASS_TEST') throw forbidden('Only the RTE admin can create final or resit exams');
      const mine = await prisma.moduleOffering.count({ where: { id: { in: body.offeringIds }, OR: [{ lecturerId: u.id }, { module: { moduleLeaderId: u.id } }] } });
      if (mine !== body.offeringIds.length) throw forbidden('You can only set class tests for modules you teach or lead');
    }
    // A teacher setting their own class test invigilates the first room by default; other rooms need named invigilators.
    const invigilators = body.invigilators ?? (u.role !== 'ADMIN' ? [{ venueId: body.venueIds[0], userId: u.id }] : []);
    await assertInvigilatorsFree(invigilators, body.date, body.startTime, body.durationMin);
    const { offeringIds, venueIds, sectionIds, invigilators: _i, ...rest } = body;
    const s = await prisma.examSession.create({
      data: {
        ...rest,
        seed: body.seed ?? 1,
        generatedBy: 'manual',
        offerings: { connect: offeringIds.map((id) => ({ id })) },
        venues: { connect: venueIds.map((id) => ({ id })) },
        sections: sectionIds?.length ? { connect: sectionIds.map((id) => ({ id })) } : undefined,
        invigilators: { create: invigilators },
      },
      include: sessionInclude,
    });
    await audit(prisma, { ...actorOf(req), action: 'exam.create', entityType: 'ExamSession', entityId: s.id, after: { title: s.title, kind: s.kind, offeringIds, venueIds, sectionIds, invigilators } });
    await notifyUsers(prisma, invigilators.map((i) => i.userId).filter((x) => x !== u.id), { type: 'exam.invigilation', title: `Invigilation: ${s.title}`, body: `${s.date.toISOString().slice(0, 10)} ${s.startTime} · ${s.durationMin} min`, payload: { examSessionId: s.id } });
    reply.code(201);
    return s;
  });

  app.patch('/exams/:id', { preHandler: [allow('exam.create')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(sessionBody.partial(), req.body);
    const before = await prisma.examSession.findUnique({ where: { id }, include: sessionInclude });
    if (!before) throw notFound('Exam session not found');
    const u = req.user!;
    if (u.role !== 'ADMIN' && !(before.kind === 'CLASS_TEST' && before.offerings.every((o) => o.lecturerId === u.id))) throw forbidden('Only the RTE admin can change this session');
    const date = body.date ?? before.date;
    const startTime = body.startTime ?? before.startTime;
    const durationMin = body.durationMin ?? before.durationMin;
    if (body.invigilators || body.date || body.startTime || body.durationMin) {
      const invs = body.invigilators ?? before.invigilators.map((i) => ({ venueId: i.venueId, userId: i.userId }));
      await assertInvigilatorsFree(invs, date, startTime, durationMin, id);
    }
    const { offeringIds, venueIds, sectionIds, invigilators, ...rest } = body;
    const after = await prisma.examSession.update({
      where: { id },
      data: {
        ...rest,
        ...(offeringIds ? { offerings: { set: offeringIds.map((x) => ({ id: x })) } } : {}),
        ...(venueIds ? { venues: { set: venueIds.map((x) => ({ id: x })) } } : {}),
        ...(sectionIds ? { sections: { set: sectionIds.map((x) => ({ id: x })) } } : {}),
        ...(invigilators ? { invigilators: { deleteMany: {}, create: invigilators } } : {}),
      },
      include: sessionInclude,
    });
    await audit(prisma, { ...actorOf(req), action: 'exam.update', entityType: 'ExamSession', entityId: id, before: { title: before.title }, after: { ...rest, offeringIds, venueIds, sectionIds, invigilators } });
    return after;
  });

  app.delete('/exams/:id', { preHandler: [allow('exam.schedule')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const before = await prisma.examSession.findUnique({ where: { id }, select: { title: true } });
    if (!before) throw notFound('Exam session not found');
    await prisma.examSession.delete({ where: { id } });
    await audit(prisma, { ...actorOf(req), action: 'exam.delete', entityType: 'ExamSession', entityId: id, before });
    return { ok: true };
  });

  // ---------- whole-semester exam schedule (also runs automatically 3 weeks before the exam window) ----------
  app.post('/exams/schedule/generate', { preHandler: [allow('exam.schedule')] }, async (req) => {
    const { semesterId, durationMin, replace } = parse(z.object({ semesterId: z.string(), durationMin: z.number().int().min(30).max(240).optional(), replace: z.boolean().default(false) }), req.body);
    const r = await scheduleSemesterExams(semesterId, { actorId: req.user!.id, generatedBy: 'manual', durationMin, replace });
    if (r.skipped) throw conflict(`This semester already has ${r.existing} final exam session(s). Pass replace: true to regenerate.`);
    return r;
  });

  app.get('/exams/invigilations/me', { preHandler: [requireRole(...STAFF)] }, async (req) =>
    prisma.examInvigilator.findMany({ where: { userId: req.user!.id }, include: { examSession: { select: { id: true, title: true, date: true, startTime: true, durationMin: true, kind: true } }, venue: { select: { name: true } } }, orderBy: { examSession: { date: 'asc' } } }),
  );

  app.get('/exams/:id', { preHandler: [allow('seating.read')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const session = await prisma.examSession.findUnique({ where: { id }, include: sessionInclude });
    if (!session) throw notFound('Exam session not found');
    const [allocations, candidates] = await Promise.all([loadAllocations(id), candidatesFor(id)]);
    const seatedIds = new Set(allocations.map((a) => a.studentId));
    const venues = session.venues.map(toSeatVenue);
    const flat = allocations.map((a) => ({ venueId: a.venueId, studentId: a.studentId, offeringId: a.moduleOfferingId, row: a.row, col: a.col, seatLabel: a.seatLabel }));
    const violations = venues.flatMap((v) => {
      const here = new Set(flat.filter((a) => a.venueId === v.id).map((a) => a.offeringId));
      return here.size > 1 ? findViolations(v, flat) : [];
    });
    return {
      session: { id: session.id, title: session.title, kind: session.kind, seatingMode: session.seatingMode, date: session.date, startTime: session.startTime, durationMin: session.durationMin, seed: session.seed, offerings: session.offerings, sections: session.sections, invigilators: session.invigilators, semester: session.semester, generatedBy: session.generatedBy },
      venues: session.venues.map((v) => ({
        ...v,
        capacity: capacityOf(toSeatVenue(v)),
        used: allocations.filter((a) => a.venueId === v.id).length,
        violations: violations.filter((x) => x.venueId === v.id).length,
      })),
      allocations: allocations.map((a) => ({
        venueId: a.venueId,
        row: a.row,
        col: a.col,
        seatLabel: a.seatLabel,
        offeringId: a.moduleOfferingId,
        moduleCode: a.moduleOffering.module.code,
        student: a.student,
        runId: a.runId,
      })),
      candidates: candidates.length,
      unseated: candidates.filter((c) => !seatedIds.has(c.studentId)),
      violations,
      generated: allocations.length > 0,
      runId: allocations[0]?.runId ?? null,
    };
  });

  app.post('/exams/:id/seating/generate', { preHandler: [allow('seating.generate')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { seed } = parse(z.object({ seed: z.number().int().min(1).max(1_000_000).optional() }), req.body ?? {});
    const session = await prisma.examSession.findUnique({ where: { id }, include: { venues: true, offerings: { select: { id: true, module: { select: { code: true } } } } } });
    if (!session) throw notFound('Exam session not found');
    if (session.venues.length === 0) throw badRequest('Add at least one venue to the session first');
    const candidates = await candidatesFor(id);
    if (candidates.length === 0) throw badRequest('No enrolled students on the selected module offerings');

    const useSeed = seed ?? session.seed;
    const result = session.seatingMode === 'BY_ID' ? generateOrderedSeating(session.venues.map(toSeatVenue), candidates) : generateSeating(session.venues.map(toSeatVenue), candidates, useSeed);
    const runId = randomUUID();
    const previous = await prisma.seatAllocation.count({ where: { examSessionId: id } });

    await prisma.$transaction(async (tx) => {
      await tx.seatAllocation.deleteMany({ where: { examSessionId: id } });
      await tx.seatAllocation.createMany({
        data: result.allocations.map((a) => ({ examSessionId: id, venueId: a.venueId, studentId: a.studentId, moduleOfferingId: a.offeringId, row: a.row, col: a.col, seatLabel: a.seatLabel, runId })),
      });
      if (seed && seed !== session.seed) await tx.examSession.update({ where: { id }, data: { seed } });
      await audit(tx, { ...actorOf(req), action: 'seating.generate', entityType: 'ExamSession', entityId: id, before: { allocations: previous }, after: { runId, seed: useSeed, seated: result.allocations.length, unseated: result.unseated.length, violations: result.violations.length } });
      const byStudent = new Map(result.allocations.map((a) => [a.studentId, a]));
      const students = await tx.student.findMany({ where: { id: { in: [...byStudent.keys()] } }, select: { id: true, userId: true } });
      const venueName = new Map(session.venues.map((v) => [v.id, v.name]));
      for (const s of students) {
        if (!s.userId) continue;
        const a = byStudent.get(s.id)!;
        await notifyUsers(tx, [s.userId], { type: 'seat.allocated', title: `Exam seat: ${session.title}`, body: `${venueName.get(a.venueId)} · seat ${a.seatLabel} · ${session.date.toISOString().slice(0, 10)} ${session.startTime}`, payload: { examSessionId: id, venueId: a.venueId, seatLabel: a.seatLabel } });
      }
    });

    return { runId, seed: useSeed, seated: result.allocations.length, unseated: result.unseated, violations: result.violations, venues: result.venues };
  });

  app.delete('/exams/:id/seating', { preHandler: [allow('seating.generate')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const r = await prisma.seatAllocation.deleteMany({ where: { examSessionId: id } });
    await audit(prisma, { ...actorOf(req), action: 'seating.clear', entityType: 'ExamSession', entityId: id, before: { allocations: r.count } });
    return { cleared: r.count };
  });

  /**
   * Rooms that are free for this sitting, largest first, with the shortfall spelled out.
   *
   * "Capacity is insufficient" is a complaint. What RTE needs is the list of rooms it could add
   * and how many seats each one buys, so the answer is one or two clicks rather than a hunt.
   */
  /** Everything that happens in one room in a normal week, plus the exams booked into it. */
  app.get('/venues/:id/classes', { preHandler: [allow('seating.read')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const venue = await prisma.venue.findUnique({ where: { id } });
    if (!venue) throw notFound('Room not found');
    const [slots, exams] = await Promise.all([
      prisma.timetableSlot.findMany({
        where: { venueId: id },
        include: {
          section: { select: { name: true } },
          groups: { select: { name: true } },
          teacher: { select: { name: true } },
          moduleOffering: { select: { module: { select: { code: true, title: true } }, semester: { select: { number: true, intake: { select: { label: true, programme: { select: { code: true } } } } } } } },
        },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      }),
      prisma.examSession.findMany({ where: { venues: { some: { id } } }, select: { id: true, title: true, date: true, startTime: true, durationMin: true }, orderBy: { date: 'asc' } }),
    ]);
    const DAY: Record<number, string> = { 7: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };
    const hours = slots.reduce((n, s) => n + (toMinutes(s.endTime) - toMinutes(s.startTime)) / 60, 0);
    return {
      venue: { id: venue.id, name: venue.name, building: venue.building, roomType: venue.roomType, seats: venue.rows * venue.cols - ((venue.disabledSeats as unknown[]) ?? []).length },
      // 6 teaching days × 11 usable hours is the week this room could give.
      utilisation: Math.round((hours / (6 * 11)) * 1000) / 10,
      hoursPerWeek: Math.round(hours * 10) / 10,
      classes: slots.map((s) => ({
        id: s.id,
        day: DAY[s.dayOfWeek] ?? String(s.dayOfWeek),
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        kind: s.kind,
        module: s.moduleOffering.module,
        cohort: `${s.moduleOffering.semester.intake.programme.code} ${s.moduleOffering.semester.intake.label} S${s.moduleOffering.semester.number}`,
        groups: (s.groups.length ? s.groups : [s.section]).map((g) => g.name),
        teacher: s.teacher.name,
      })),
      exams: exams.map((e) => ({ ...e, endTime: addMinutes(e.startTime, e.durationMin) })),
    };
  });

  app.get('/exams/:id/free-rooms', { preHandler: [allow('seating.read')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const exam = await prisma.examSession.findUnique({
      where: { id },
      include: { venues: { select: { id: true, name: true, rows: true, cols: true, disabledSeats: true } }, offerings: { select: { id: true } } },
    });
    if (!exam) throw notFound('Exam session not found');

    const seats = (v: { rows: number; cols: number; disabledSeats: unknown }) => v.rows * v.cols - ((v.disabledSeats as unknown[]) ?? []).length;
    const endTime = addMinutes(exam.startTime, exam.durationMin);

    // Anything already booked that day: another exam, or a class in the same room.
    const [otherExams, classes, allRooms, candidates] = await Promise.all([
      prisma.examSession.findMany({ where: { date: exam.date, NOT: { id } }, select: { startTime: true, durationMin: true, venues: { select: { id: true } } } }),
      prisma.timetableSlot.findMany({ where: { dayOfWeek: isoDow(exam.date) }, select: { venueId: true, startTime: true, endTime: true } }),
      prisma.venue.findMany({ orderBy: [{ rows: 'desc' }] }),
      prisma.enrollment.count({ where: { moduleOfferingId: { in: exam.offerings.map((o) => o.id) }, deletedAt: null } }),
    ]);

    const takenByExam = new Set(
      otherExams.flatMap((e) => (overlaps(e.startTime, addMinutes(e.startTime, e.durationMin), exam.startTime, endTime) ? e.venues.map((v) => v.id) : [])),
    );
    const takenByClass = new Set(classes.filter((c) => c.venueId && overlaps(c.startTime, c.endTime, exam.startTime, endTime)).map((c) => c.venueId!));
    const inUse = new Set(exam.venues.map((v) => v.id));

    const capacity = exam.venues.reduce((n, v) => n + seats(v), 0);
    const free = allRooms
      .filter((v) => !inUse.has(v.id) && !takenByExam.has(v.id) && !takenByClass.has(v.id))
      .map((v) => ({ id: v.id, name: v.name, building: v.building, isExamHall: !v.isClassroom, seats: seats(v) }))
      .sort((a, b) => Number(b.isExamHall) - Number(a.isExamHall) || b.seats - a.seats);

    const busy = allRooms
      .filter((v) => !inUse.has(v.id) && (takenByExam.has(v.id) || takenByClass.has(v.id)))
      .map((v) => ({ id: v.id, name: v.name, seats: seats(v), why: takenByExam.has(v.id) ? 'another exam' : 'a class' }));

    // The smallest set of free rooms that closes the gap, offered as a one-click suggestion.
    const shortfall = Math.max(0, candidates - capacity);
    const suggestion: typeof free = [];
    let gained = 0;
    for (const room of free) {
      if (gained >= shortfall) break;
      suggestion.push(room);
      gained += room.seats;
    }

    return {
      window: { date: exam.date, startTime: exam.startTime, endTime },
      candidates,
      capacity,
      shortfall,
      inUse: exam.venues.map((v) => ({ id: v.id, name: v.name, seats: seats(v) })),
      free,
      busy,
      suggestion: gained >= shortfall ? suggestion : [],
      enough: gained >= shortfall,
    };
  });

  app.get('/exams/:id/lookup', { preHandler: [allow('seating.read')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { studentId } = parse(z.object({ studentId: z.string().trim().min(1) }), req.query);
    const a = await prisma.seatAllocation.findFirst({
      where: { examSessionId: id, student: { studentId: { equals: studentId, mode: 'insensitive' } } },
      include: { venue: { select: { id: true, name: true, building: true, rows: true, cols: true } }, student: { select: { studentId: true, name: true } }, moduleOffering: { select: { module: { select: { code: true } } } } },
    });
    if (!a) throw notFound(`No seat allocated for ${studentId} in this session`);
    return a;
  });

  app.get('/exams/:id/seating.pdf', { preHandler: [allow('seating.read')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const session = await prisma.examSession.findUnique({ where: { id }, include: { venues: true } });
    if (!session) throw notFound('Exam session not found');
    const allocations = await loadAllocations(id);
    const pdf = await renderSeatingPdf(
      session,
      session.venues.map((v) => ({ id: v.id, name: v.name, building: v.building, rows: v.rows, cols: v.cols, disabledSeats: (v.disabledSeats as { row: number; col: number }[]) ?? [] })),
      allocations.map((a) => ({ venueId: a.venueId, row: a.row, col: a.col, seatLabel: a.seatLabel, studentId: a.student.studentId, name: a.student.name, moduleCode: a.moduleOffering.module.code, specialNeeds: a.student.specialNeedsSeating })),
    );
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', `attachment; filename="seating-${session.date.toISOString().slice(0, 10)}.pdf"`);
    return pdf;
  });

  // ---------- student: my exam seats ----------
  app.get('/exams/me', { preHandler: [requireRole('STUDENT')] }, async (req) => {
    const sid = req.user!.studentId;
    if (!sid) throw notFound('No student record is linked to this account');
    const upcoming = await prisma.examSession.findMany({
      where: { offerings: { some: { enrollments: { some: { studentId: sid, deletedAt: null } } } } },
      include: {
        offerings: { where: { enrollments: { some: { studentId: sid } } }, select: { module: { select: { code: true, title: true } } } },
        seatAllocations: { where: { studentId: sid }, include: { venue: { select: { id: true, name: true, building: true, rows: true, cols: true, disabledSeats: true } } } },
      },
      orderBy: { date: 'asc' },
    });
    return upcoming.map((s) => ({
      id: s.id,
      title: s.title,
      date: s.date,
      startTime: s.startTime,
      durationMin: s.durationMin,
      modules: s.offerings.map((o) => o.module),
      seat: s.seatAllocations[0] ? { venue: s.seatAllocations[0].venue, row: s.seatAllocations[0].row, col: s.seatAllocations[0].col, seatLabel: s.seatAllocations[0].seatLabel } : null,
    }));
  });

  // staff can look at any student's upcoming seats from the profile
  app.get('/students/:id/seats', { preHandler: [requireRole(...STAFF)] }, async (req) => {
    const { id } = parse(idParam, req.params);
    return prisma.seatAllocation.findMany({
      where: { studentId: id },
      include: { examSession: { select: { id: true, title: true, date: true, startTime: true } }, venue: { select: { name: true } } },
      orderBy: { examSession: { date: 'asc' } },
    });
  });
}
