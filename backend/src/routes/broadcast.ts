import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import type { Role } from '@prisma/client';
import { allow } from '../plugins/auth';
import { notifyUsers } from '../lib/notify';

const AUDIENCE = ['EVERYONE', 'STUDENTS', 'STAFF', 'PROGRAMME'] as const;

const bodySchema = z.object({
  audience: z.enum(AUDIENCE),
  programmeId: z.string().optional(),
  title: z.string().min(3).max(120),
  body: z.string().min(3).max(2000),
});

/**
 * Announcements from the RTE office.
 *
 * One message, everybody who needs it. A change of exam hall an hour before the sitting, a strike
 * day, a system outage — the alternative is a mail merge nobody trusts and a notice board nobody
 * reads. The announcement is stored in its own right and also fanned out to a notification each,
 * so a recipient sees it wherever they already look and the office keeps a record of what went out.
 */
export async function broadcastRoutes(app: FastifyInstance) {
  /** Everyone the message would reach, before sending. Cheap enough to call as the form changes. */
  async function recipientsOf(audience: (typeof AUDIENCE)[number], programmeId?: string) {
    if (audience === 'PROGRAMME') {
      if (!programmeId) throw badRequest('Choose the programme this goes to');
      const students = await prisma.student.findMany({
        where: { programmeId, deletedAt: null, status: 'ACTIVE', userId: { not: null } },
        select: { userId: true },
      });
      return students.map((s) => s.userId!).filter(Boolean);
    }
    const where =
      audience === 'STUDENTS'
        ? { role: 'STUDENT' as Role, isActive: true }
        : audience === 'STAFF'
          ? { role: { in: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] as Role[] }, isActive: true }
          : { isActive: true };
    const users = await prisma.user.findMany({ where, select: { id: true } });
    return users.map((u) => u.id);
  }

  app.get('/broadcasts/audience-size', { preHandler: [allow('broadcast.send')] }, async (req) => {
    const q = parse(z.object({ audience: z.enum(AUDIENCE), programmeId: z.string().optional() }), req.query);
    const ids = await recipientsOf(q.audience, q.programmeId);
    return { count: ids.length };
  });

  app.get('/broadcasts', { preHandler: [allow('timetable.read')] }, async () => {
    const rows = await prisma.broadcast.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { sender: { select: { name: true } }, programme: { select: { code: true, name: true } } },
    });
    return rows.map((b) => ({
      id: b.id,
      title: b.title,
      body: b.body,
      audience: b.audience,
      programme: b.programme?.code ?? null,
      recipients: b.recipients,
      sender: b.sender.name,
      createdAt: b.createdAt,
    }));
  });

  app.post('/broadcasts', { preHandler: [allow('broadcast.send')] }, async (req, reply) => {
    const body = parse(bodySchema, req.body);
    const senderId = req.user!.id;
    const ids = await recipientsOf(body.audience, body.programmeId);
    if (ids.length === 0) throw badRequest('Nobody would receive that — check the audience');

    const broadcast = await prisma.$transaction(async (tx) => {
      const b = await tx.broadcast.create({
        data: {
          senderId,
          audience: body.audience,
          programmeId: body.audience === 'PROGRAMME' ? body.programmeId : null,
          title: body.title,
          body: body.body,
          recipients: ids.length,
        },
      });
      // Sent in batches: a single createMany of three thousand rows is a long transaction on a
      // small database, and a half-delivered announcement is worse than a slow one.
      for (let i = 0; i < ids.length; i += 500) {
        await notifyUsers(tx, ids.slice(i, i + 500), {
          type: 'broadcast',
          title: body.title,
          body: body.body,
          payload: { broadcastId: b.id },
        });
      }
      return b;
    });

    await audit(prisma, { ...actorOf(req), action: 'broadcast.sent', entityType: 'Broadcast', entityId: broadcast.id, after: { audience: body.audience, recipients: ids.length } });
    reply.code(201);
    return { id: broadcast.id, recipients: ids.length };
  });

  app.delete('/broadcasts/:id', { preHandler: [allow('broadcast.send')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    await prisma.broadcast.delete({ where: { id } });
    await audit(prisma, { ...actorOf(req), action: 'broadcast.deleted', entityType: 'Broadcast', entityId: id });
    return { ok: true };
  });
}
