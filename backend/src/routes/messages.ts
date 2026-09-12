import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest, notFound } from '../lib/errors';
import { allow } from '../plugins/auth';
import { notifyUsers } from '../lib/notify';

/**
 * Messaging, kept deliberately small.
 *
 * The need is "the RTE office finds a person and says something to them", and a student replying.
 * That is a flat table of messages between two user ids: no rooms, no presence, no sockets, no
 * typing indicators. A conversation is just the messages between you and one other person, and
 * the unread badge is a count. It costs one indexed query to open and one row to send, which is
 * what makes it usable on a free instance and on a phone with two bars of signal.
 */
export async function messageRoutes(app: FastifyInstance) {
  /** Find somebody to write to. Students are searchable by their institutional ID too. */
  app.get('/messages/people', { preHandler: [allow('message.use')] }, async (req) => {
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(60) }), req.query);
    const me = req.user!;
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: me.id },
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { student: { studentId: { contains: q, mode: 'insensitive' } } },
        ],
      },
      select: { id: true, name: true, role: true, student: { select: { studentId: true, programme: { select: { code: true } } } } },
      orderBy: { name: 'asc' },
      take: 20,
    });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      studentId: u.student?.studentId ?? null,
      programme: u.student?.programme.code ?? null,
    }));
  });

  /** Everyone you have a thread with, newest first, with the unread count on each. */
  app.get('/messages/threads', { preHandler: [allow('message.use')] }, async (req) => {
    const me = req.user!;
    const rows = await prisma.directMessage.findMany({
      where: { OR: [{ fromId: me.id }, { toId: me.id }] },
      orderBy: { createdAt: 'desc' },
      take: 400,
      select: {
        id: true,
        body: true,
        createdAt: true,
        readAt: true,
        fromId: true,
        toId: true,
        from: { select: { id: true, name: true, role: true } },
        to: { select: { id: true, name: true, role: true } },
      },
    });
    const threads = new Map<string, { id: string; name: string; role: string; last: string; at: Date; unread: number }>();
    for (const m of rows) {
      const other = m.fromId === me.id ? m.to : m.from;
      const cur = threads.get(other.id) ?? { id: other.id, name: other.name, role: other.role, last: m.body, at: m.createdAt, unread: 0 };
      if (m.toId === me.id && !m.readAt) cur.unread += 1;
      threads.set(other.id, cur);
    }
    return [...threads.values()];
  });

  app.get('/messages/unread-count', { preHandler: [allow('message.use')] }, async (req) => {
    const me = req.user!;
    return { count: await prisma.directMessage.count({ where: { toId: me.id, readAt: null } }) };
  });

  /** One thread. Opening it marks their side read. */
  app.get('/messages/with/:id', { preHandler: [allow('message.use')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const me = req.user!;
    const other = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, role: true } });
    if (!other) throw notFound('That person no longer has an account');

    const messages = await prisma.directMessage.findMany({
      where: { OR: [{ fromId: me.id, toId: id }, { fromId: id, toId: me.id }] },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, body: true, createdAt: true, fromId: true },
    });
    await prisma.directMessage.updateMany({ where: { fromId: id, toId: me.id, readAt: null }, data: { readAt: new Date() } });

    return { person: other, messages: messages.map((m) => ({ ...m, mine: m.fromId === me.id })) };
  });

  app.post('/messages', { preHandler: [allow('message.use')] }, async (req, reply) => {
    const body = parse(z.object({ toId: z.string(), body: z.string().trim().min(1).max(2000) }), req.body);
    const me = req.user!;
    if (body.toId === me.id) throw badRequest('You cannot message yourself');
    const to = await prisma.user.findUnique({ where: { id: body.toId }, select: { id: true, isActive: true } });
    if (!to || !to.isActive) throw notFound('That person no longer has an account');

    const msg = await prisma.directMessage.create({ data: { fromId: me.id, toId: body.toId, body: body.body } });
    await notifyUsers(prisma, [body.toId], {
      type: 'message',
      title: `Message from ${me.name}`,
      body: body.body.slice(0, 140),
      payload: { fromId: me.id },
    });
    reply.code(201);
    return { id: msg.id, createdAt: msg.createdAt };
  });
}
