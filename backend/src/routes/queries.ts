import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow } from '../plugins/auth';
import { can } from '../lib/actions';
import { notifyRole, notifyUsers } from '../lib/notify';

/** The things people actually write in about, so the office can sort its queue. */
export const QUERY_CATEGORIES = ['Results', 'Timetable', 'Exams', 'Fees', 'Enrolment', 'Attendance', 'Something else'] as const;

/**
 * Queries — questions that need an answer rather than a decision.
 *
 * A change request asks for something to be approved or refused. "When does the resit window
 * open?" is not that, and putting it through the same queue buries the requests that need acting
 * on. A query is raised, answered by the office, and closed by whoever asked.
 */
export async function queryRoutes(app: FastifyInstance) {
  app.get('/queries/categories', { preHandler: [allow('query.raise')] }, async () => QUERY_CATEGORIES);

  /** Mine if I can only raise them; everything if I answer them. */
  app.get('/queries', { preHandler: [allow('query.raise')] }, async (req) => {
    const q = parse(z.object({ status: z.enum(['OPEN', 'ANSWERED', 'CLOSED']).optional(), mine: z.coerce.boolean().optional() }), req.query);
    const me = req.user!;
    const canAnswer = can(req.user!.role, 'query.answer', req.permissions);
    const rows = await prisma.queryTicket.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(canAnswer && !q.mine ? {} : { raisedById: me.id }),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: {
        raisedBy: { select: { id: true, name: true, role: true, student: { select: { studentId: true } } } },
        answeredBy: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      subject: r.subject,
      body: r.body,
      status: r.status,
      answer: r.answer,
      answeredBy: r.answeredBy?.name ?? null,
      answeredAt: r.answeredAt,
      createdAt: r.createdAt,
      raisedBy: r.raisedBy.name,
      raisedByRole: r.raisedBy.role,
      raisedByStudentId: r.raisedBy.student?.studentId ?? null,
      canAnswer,
      mine: r.raisedById === me.id,
    }));
  });

  app.post('/queries', { preHandler: [allow('query.raise')] }, async (req, reply) => {
    const body = parse(
      z.object({
        category: z.enum(QUERY_CATEGORIES),
        subject: z.string().trim().min(3).max(140),
        body: z.string().trim().min(3).max(2000),
      }),
      req.body,
    );
    const me = req.user!;
    const ticket = await prisma.queryTicket.create({ data: { ...body, raisedById: me.id } });
    await notifyRole(prisma, 'ADMIN', {
      type: 'query.raised',
      title: `Query: ${body.subject}`,
      body: `${me.name} asked about ${body.category.toLowerCase()}.`,
      payload: { queryId: ticket.id },
    });
    await audit(prisma, { ...actorOf(req), action: 'query.raised', entityType: 'QueryTicket', entityId: ticket.id, after: { category: body.category } });
    reply.code(201);
    return { id: ticket.id };
  });

  app.post('/queries/:id/answer', { preHandler: [allow('query.answer')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { answer } = parse(z.object({ answer: z.string().trim().min(2).max(2000) }), req.body);
    const me = req.user!;
    const existing = await prisma.queryTicket.findUnique({ where: { id }, select: { raisedById: true, subject: true } });
    if (!existing) throw notFound('That query no longer exists');

    await prisma.queryTicket.update({
      where: { id },
      data: { answer, answeredById: me.id, answeredAt: new Date(), status: 'ANSWERED' },
    });
    await notifyUsers(prisma, [existing.raisedById], {
      type: 'query.answered',
      title: `Answered: ${existing.subject}`,
      body: answer.slice(0, 160),
      payload: { queryId: id },
    });
    await audit(prisma, { ...actorOf(req), action: 'query.answered', entityType: 'QueryTicket', entityId: id });
    return { ok: true };
  });

  app.post('/queries/:id/close', { preHandler: [allow('query.raise')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const me = req.user!;
    const existing = await prisma.queryTicket.findUnique({ where: { id }, select: { raisedById: true } });
    if (!existing) throw notFound('That query no longer exists');
    // Whoever asked decides when they have their answer; the office can close it too.
    if (existing.raisedById !== me.id && !can(req.user!.role, 'query.answer', req.permissions)) throw notFound('That query no longer exists');
    await prisma.queryTicket.update({ where: { id }, data: { status: 'CLOSED' } });
    return { ok: true };
  });
}
