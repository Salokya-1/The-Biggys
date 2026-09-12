import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { requireRole } from '../plugins/auth';
import { notifyRole, notifyUsers } from '../lib/notify';
import { parseDay, teacherConflicts } from '../services/calendar';

const createBody = z.object({
  kind: z.enum(['TEACHER_ABSENCE', 'STUDENT_ABSENCE', 'SECTION_SWAP']),
  slotId: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetSectionId: z.string().optional(),
  reason: z.string().trim().min(5).max(500),
});
const decideBody = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(300).optional(),
  coverTeacherId: z.string().optional(),
});

const include = {
  requester: { select: { id: true, name: true, role: true, student: { select: { studentId: true, section: { select: { name: true } } } } } },
  decidedBy: { select: { id: true, name: true } },
  slot: { select: { id: true, dayOfWeek: true, startTime: true, endTime: true, section: { select: { id: true, name: true } }, moduleOffering: { select: { module: { select: { code: true, title: true } } } }, teacher: { select: { id: true, name: true } } } },
  targetSection: { select: { id: true, name: true } },
};

/** Absence and change requests: teachers (absence → cover/cancel), students (absence, section swap). */
export async function requestRoutes(app: FastifyInstance) {
  app.post('/requests', async (req, reply) => {
    const body = parse(createBody, req.body);
    const u = req.user!;
    const date = parseDay(body.date);
    if (body.kind === 'TEACHER_ABSENCE') {
      if (u.role === 'STUDENT') throw forbidden('Only teaching staff can report teacher absence');
      if (!body.slotId) throw badRequest('slotId is required');
      const slot = await prisma.timetableSlot.findUnique({ where: { id: body.slotId } });
      if (!slot) throw notFound('Slot not found');
      if (slot.teacherId !== u.id && u.role !== 'ADMIN') throw forbidden('You can only report absence for your own classes');
    } else {
      if (u.role !== 'STUDENT') throw forbidden('Only students can make this request');
      const st = await prisma.student.findFirst({ where: { userId: u.id }, select: { sectionId: true, intakeId: true } });
      if (!st?.sectionId) throw badRequest('You are not assigned to a section');
      if (body.kind === 'STUDENT_ABSENCE') {
        if (!body.slotId) throw badRequest('slotId is required');
        const slot = await prisma.timetableSlot.findUnique({ where: { id: body.slotId } });
        if (!slot || slot.sectionId !== st.sectionId) throw forbidden('That class is not in your section');
      } else {
        if (!body.targetSectionId) throw badRequest('targetSectionId is required');
        const target = await prisma.section.findUnique({ where: { id: body.targetSectionId } });
        if (!target || target.intakeId !== st.intakeId) throw badRequest('Target section must belong to your intake');
        if (target.id === st.sectionId) throw badRequest('You are already in that section');
      }
    }
    const r = await prisma.changeRequest.create({ data: { kind: body.kind, requesterId: u.id, slotId: body.slotId ?? null, date, targetSectionId: body.targetSectionId ?? null, reason: body.reason }, include });
    await audit(prisma, { ...actorOf(req), action: 'request.create', entityType: 'ChangeRequest', entityId: r.id, after: body });
    const title = body.kind === 'TEACHER_ABSENCE' ? `Teacher absence: ${r.slot?.moduleOffering.module.code} on ${body.date}` : body.kind === 'STUDENT_ABSENCE' ? `Student absence request from ${u.name}` : `Section change request from ${u.name}`;
    await notifyRole(prisma, 'ADMIN', { type: 'request.created', title, body: body.reason, payload: { requestId: r.id } });
    if (body.kind === 'TEACHER_ABSENCE' && r.slot) {
      const leader = await prisma.module.findFirst({ where: { code: r.slot.moduleOffering.module.code }, select: { moduleLeaderId: true } });
      if (leader?.moduleLeaderId) await notifyUsers(prisma, [leader.moduleLeaderId], { type: 'request.created', title, body: body.reason, payload: { requestId: r.id } });
    }
    reply.code(201);
    return r;
  });

  app.get('/requests', async (req) => {
    const { status } = parse(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }), req.query);
    const u = req.user!;
    const mine = u.role === 'STUDENT' || u.role === 'LECTURER';
    return prisma.changeRequest.findMany({
      where: { ...(status ? { status } : {}), ...(mine ? { requesterId: u.id } : {}) },
      include,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  });

  app.post('/requests/:id/decide', { preHandler: [requireRole('ADMIN', 'MODULE_LEADER')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(decideBody, req.body);
    const r = await prisma.changeRequest.findUnique({ where: { id }, include: { ...include, requester: { select: { id: true, name: true, role: true, student: { select: { id: true, studentId: true, sectionId: true, section: { select: { name: true } } } } } } } });
    if (!r) throw notFound('Request not found');
    if (r.status !== 'PENDING') throw conflict(`Request already ${r.status}`);

    await prisma.$transaction(async (tx) => {
      if (body.decision === 'APPROVED') {
        if (r.kind === 'TEACHER_ABSENCE' && r.slot) {
          let kind: 'CANCELLED' | 'TEACHER_CHANGE' = 'CANCELLED';
          if (body.coverTeacherId) {
            const busy = await teacherConflicts(body.coverTeacherId, r.date, r.slot.startTime, r.slot.endTime, { excludeSlotId: r.slot.id });
            if (busy.length) throw conflict('The cover teacher is not free', { conflicts: busy.map((b) => `${b.startTime}–${b.endTime} ${b.title}`) });
            kind = 'TEACHER_CHANGE';
          }
          await tx.slotException.upsert({
            where: { slotId_date: { slotId: r.slot.id, date: r.date } },
            create: { slotId: r.slot.id, date: r.date, kind, teacherId: body.coverTeacherId ?? null, reason: `Teacher absence approved: ${r.reason}`, createdById: req.user!.id },
            update: { kind, teacherId: body.coverTeacherId ?? null, reason: `Teacher absence approved: ${r.reason}`, createdById: req.user!.id },
          });
          const students = await tx.user.findMany({ where: { student: { sectionId: r.slot.section.id, deletedAt: null } }, select: { id: true } });
          await notifyUsers(tx, students.map((s) => s.id), { type: 'timetable.exception', title: `Class ${kind === 'CANCELLED' ? 'cancelled' : 'covered'}: ${r.slot.moduleOffering.module.code} on ${r.date.toISOString().slice(0, 10)}`, body: kind === 'CANCELLED' ? r.reason : 'A cover teacher has been assigned.', payload: { slotId: r.slot.id } });
        }
        if (r.kind === 'SECTION_SWAP' && r.targetSectionId && r.requester.student) {
          await tx.student.update({ where: { id: r.requester.student.id }, data: { sectionId: r.targetSectionId } });
          await audit(tx, { ...actorOf(req), action: 'student.section_change', entityType: 'Student', entityId: r.requester.student.id, before: { sectionId: r.requester.student.sectionId }, after: { sectionId: r.targetSectionId }, reason: r.reason });
        }
      }
      await tx.changeRequest.update({ where: { id }, data: { status: body.decision, decidedById: req.user!.id, decidedAt: new Date(), decisionNote: body.note ?? null } });
      await audit(tx, { ...actorOf(req), action: `request.${body.decision.toLowerCase()}`, entityType: 'ChangeRequest', entityId: id, before: { status: 'PENDING' }, after: { status: body.decision, coverTeacherId: body.coverTeacherId ?? null }, reason: body.note ?? null });
      await notifyUsers(tx, [r.requesterId], { type: 'request.decided', title: `Your request was ${body.decision.toLowerCase()}`, body: body.note ?? (body.decision === 'APPROVED' ? 'Approved by the RTE office.' : 'Rejected by the RTE office.'), payload: { requestId: id } });
    });
    return prisma.changeRequest.findUnique({ where: { id }, include });
  });
}
