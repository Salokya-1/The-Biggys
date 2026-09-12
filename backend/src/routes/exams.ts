import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow, requireRole, STAFF } from '../plugins/auth';
import { capacityOf, findViolations, generateSeating, type SeatStudent, type SeatVenue } from '../lib/seating';
import { notifyUsers } from '../lib/notify';
import { renderSeatingPdf } from '../services/seating-pdf';

const seatSchema = z.object({ row: z.number().int().min(1), col: z.number().int().min(1) });
const venueBody = z.object({
  name: z.string().trim().min(1).max(60),
  building: z.string().trim().min(1).max(60),
  rows: z.number().int().min(1).max(60),
  cols: z.number().int().min(1).max(60),
  disabledSeats: z.array(seatSchema).max(500).default([]),
  adjacencyMode: z.enum(['ROW', 'ROW_AND_COLUMN']).default('ROW'),
});
const sessionBody = z.object({
  title: z.string().trim().min(3).max(160),
  date: z.coerce.date(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.number().int().min(15).max(480),
  offeringIds: z.array(z.string().min(1)).min(1).max(20),
  venueIds: z.array(z.string().min(1)).min(1).max(20),
  seed: z.number().int().min(1).max(1_000_000).optional(),
});

const sessionInclude = {
  offerings: {
    select: {
      id: true,
      module: { select: { code: true, title: true } },
      semester: { select: { number: true, intake: { select: { label: true, programme: { select: { code: true } } } } } },
      _count: { select: { enrollments: true } },
    },
  },
  venues: true,
  _count: { select: { seatAllocations: true } },
} satisfies Prisma.ExamSessionInclude;

function toSeatVenue(v: { id: string; name: string; rows: number; cols: number; disabledSeats: unknown; adjacencyMode: 'ROW' | 'ROW_AND_COLUMN' }): SeatVenue {
  return { id: v.id, name: v.name, rows: v.rows, cols: v.cols, disabledSeats: (v.disabledSeats as { row: number; col: number }[]) ?? [], adjacencyMode: v.adjacencyMode };
}

/** Students sitting this session: active enrolments on its offerings, one row per student (latest attempt). */
async function candidatesFor(sessionId: string): Promise<SeatStudent[]> {
  const enrollments = await prisma.enrollment.findMany({
    where: { deletedAt: null, moduleOffering: { examSessions: { some: { id: sessionId } } }, student: { deletedAt: null, status: { in: ['ACTIVE', 'DEFERRED'] } } },
    include: { student: { select: { id: true, studentId: true, name: true, specialNeedsSeating: true } }, moduleOffering: { select: { id: true, module: { select: { code: true } } } } },
    orderBy: [{ student: { studentId: 'asc' } }, { attempt: 'desc' }],
  });
  const seen = new Set<string>();
  const out: SeatStudent[] = [];
  for (const e of enrollments) {
    const k = `${e.studentId}:${e.moduleOfferingId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ studentId: e.student.id, label: e.student.studentId, name: e.student.name, offeringId: e.moduleOfferingId, moduleCode: e.moduleOffering.module.code, specialNeeds: e.student.specialNeedsSeating });
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
  app.post('/venues', { preHandler: [allow('seating.generate')] }, async (req, reply) => {
    const body = parse(venueBody, req.body);
    if (body.disabledSeats.some((s) => s.row > body.rows || s.col > body.cols)) throw badRequest('A disabled seat is outside the grid');
    const v = await prisma.venue.create({ data: { ...body, disabledSeats: body.disabledSeats as Prisma.InputJsonValue } });
    await audit(prisma, { ...actorOf(req), action: 'venue.create', entityType: 'Venue', entityId: v.id, after: v });
    reply.code(201);
    return v;
  });
  app.patch('/venues/:id', { preHandler: [allow('seating.generate')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(venueBody.partial(), req.body);
    const before = await prisma.venue.findUnique({ where: { id } });
    if (!before) throw notFound('Venue not found');
    const rows = body.rows ?? before.rows;
    const cols = body.cols ?? before.cols;
    if ((body.disabledSeats ?? []).some((s) => s.row > rows || s.col > cols)) throw badRequest('A disabled seat is outside the grid');
    const after = await prisma.venue.update({ where: { id }, data: { ...body, disabledSeats: body.disabledSeats as Prisma.InputJsonValue | undefined } });
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

  app.post('/exams', { preHandler: [allow('seating.generate')] }, async (req, reply) => {
    const body = parse(sessionBody, req.body);
    const { offeringIds, venueIds, ...rest } = body;
    const s = await prisma.examSession.create({
      data: { ...rest, seed: body.seed ?? 1, offerings: { connect: offeringIds.map((id) => ({ id })) }, venues: { connect: venueIds.map((id) => ({ id })) } },
      include: sessionInclude,
    });
    await audit(prisma, { ...actorOf(req), action: 'exam.create', entityType: 'ExamSession', entityId: s.id, after: { title: s.title, offeringIds, venueIds } });
    reply.code(201);
    return s;
  });

  app.patch('/exams/:id', { preHandler: [allow('seating.generate')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(sessionBody.partial(), req.body);
    const before = await prisma.examSession.findUnique({ where: { id }, include: sessionInclude });
    if (!before) throw notFound('Exam session not found');
    const { offeringIds, venueIds, ...rest } = body;
    const after = await prisma.examSession.update({
      where: { id },
      data: {
        ...rest,
        ...(offeringIds ? { offerings: { set: offeringIds.map((x) => ({ id: x })) } } : {}),
        ...(venueIds ? { venues: { set: venueIds.map((x) => ({ id: x })) } } : {}),
      },
      include: sessionInclude,
    });
    await audit(prisma, { ...actorOf(req), action: 'exam.update', entityType: 'ExamSession', entityId: id, before: { title: before.title }, after: { title: after.title, offeringIds, venueIds } });
    return after;
  });

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
      session: { id: session.id, title: session.title, date: session.date, startTime: session.startTime, durationMin: session.durationMin, seed: session.seed, offerings: session.offerings },
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
    const result = generateSeating(session.venues.map(toSeatVenue), candidates, useSeed);
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
