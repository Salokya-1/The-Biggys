import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { idParam, paged, pagination, parse } from '../lib/validation';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow, invalidatePermissions } from '../plugins/auth';
import { ACTIONS, effectiveActions, isAction, parseOverrides, roleHas } from '../lib/actions';
import { notifyUsers } from '../lib/notify';

const roleEnum = z.enum(['ADMIN', 'MODULE_LEADER', 'LECTURER', 'STUDENT']);
const createBody = z.object({
  email: z.string().trim().regex(/^\S+@\S+$/, 'Invalid email').max(120),
  name: z.string().trim().min(2).max(120),
  role: roleEnum,
  password: z.string().min(8).max(72).optional(),
  isActive: z.boolean().default(true),
  permissions: z.object({ grant: z.array(z.string()).max(60).optional(), revoke: z.array(z.string()).max(60).optional() }).optional(),
  // when role = STUDENT, optionally create the student record at the same time
  student: z
    .object({
      studentId: z.string().trim().min(3).max(20),
      programmeId: z.string().min(1),
      intakeId: z.string().min(1),
      sectionId: z.string().min(1).optional(),
      currentSemesterId: z.string().min(1).optional(),
      specialNeedsSeating: z.boolean().optional(),
    })
    .optional(),
});
const updateBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().regex(/^\S+@\S+$/).max(120).optional(),
  role: roleEnum.optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(72).optional(),
  permissions: z.object({ grant: z.array(z.string()).max(60).optional(), revoke: z.array(z.string()).max(60).optional() }).nullable().optional(),
});

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  permissions: true,
  lockedUntil: true,
  createdAt: true,
  student: { select: { id: true, studentId: true, section: { select: { name: true } }, intake: { select: { label: true, programme: { select: { code: true } } } } } },
  _count: { select: { ledModules: true, lecturedOfferings: true, invigilations: true, taughtSlots: true } },
} satisfies Prisma.UserSelect;

type Row = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/** Shape a user for the admin screen: role defaults plus the explicit overrides, resolved. */
function shape(u: Row) {
  const overrides = parseOverrides(u.permissions);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    lockedUntil: u.lockedUntil,
    createdAt: u.createdAt,
    student: u.student,
    workload: { modulesLed: u._count.ledModules, offerings: u._count.lecturedOfferings, classes: u._count.taughtSlots, invigilations: u._count.invigilations },
    overrides: overrides ?? { grant: [], revoke: [] },
    actions: effectiveActions(u.role, overrides),
  };
}

/** User administration: create staff and students, change roles, and toggle any single capability. */
export async function adminUserRoutes(app: FastifyInstance) {
  /** The full capability catalogue plus the role defaults, so the UI can render the switch board. */
  app.get('/admin/actions', { preHandler: [allow('users.manage')] }, async () => ({
    actions: ACTIONS.map((a) => ({ key: a.key, label: a.label, group: a.group, roles: a.roles })),
    groups: [...new Set(ACTIONS.map((a) => a.group))],
    roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER', 'STUDENT'],
    defaults: Object.fromEntries((['ADMIN', 'MODULE_LEADER', 'LECTURER', 'STUDENT'] as const).map((r) => [r, ACTIONS.filter((a) => (a.roles as readonly string[]).includes(r)).map((a) => a.key)])),
  }));

  app.get('/admin/users', { preHandler: [allow('users.manage')] }, async (req) => {
    const q = parse(pagination.extend({ q: z.string().trim().max(80).optional(), role: roleEnum.optional(), isActive: z.coerce.boolean().optional() }), req.query);
    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.isActive === undefined ? {} : { isActive: q.isActive }),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [total, items] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, select: userSelect, orderBy: [{ role: 'asc' }, { name: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return paged(items.map(shape), total, q.page, q.pageSize);
  });

  app.post('/admin/users', { preHandler: [allow('users.manage')] }, async (req, reply) => {
    const body = parse(createBody, req.body);
    const email = body.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) throw conflict('A user with that email already exists');
    if (body.role === 'STUDENT' && body.student) {
      const intake = await prisma.intake.findUnique({ where: { id: body.student.intakeId } });
      if (!intake || intake.programmeId !== body.student.programmeId) throw badRequest('The intake does not belong to that programme');
    }
    const password = body.password ?? 'Welcome123!';
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: body.name,
          role: body.role,
          isActive: body.isActive,
          passwordHash: await bcrypt.hash(password, 10),
          permissions: (parseOverrides(body.permissions) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
        select: userSelect,
      });
      if (body.role === 'STUDENT' && body.student) {
        await tx.student.create({
          data: {
            ...body.student,
            name: body.name,
            email,
            userId: user.id,
            specialNeedsSeating: body.student.specialNeedsSeating ?? false,
          },
        });
      }
      await audit(tx, { ...actorOf(req), action: 'user.create', entityType: 'User', entityId: user.id, after: { email, role: body.role, permissions: body.permissions ?? null, student: body.student ?? null } });
      return user;
    });
    await notifyUsers(prisma, [created.id], { type: 'account.created', title: 'Your RTE account is ready', body: `Signed in as ${email} with the role ${body.role.replace('_', ' ').toLowerCase()}.`, payload: {} });
    reply.code(201);
    return { ...shape(await prisma.user.findUniqueOrThrow({ where: { id: created.id }, select: userSelect })), temporaryPassword: body.password ? undefined : password };
  });

  app.patch('/admin/users/:id', { preHandler: [allow('users.manage')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(updateBody, req.body);
    const before = await prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!before) throw notFound('User not found');
    if (id === req.user!.id && (body.role || body.isActive === false)) throw badRequest('You cannot change your own role or deactivate yourself');
    if (before.role === 'ADMIN' && body.role && body.role !== 'ADMIN') {
      const admins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (admins <= 1) throw conflict('This is the last active administrator');
    }
    const data: Prisma.UserUpdateInput = {};
    if (body.name) data.name = body.name;
    if (body.email) data.email = body.email.toLowerCase();
    if (body.role) data.role = body.role;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.password) data.passwordHash = await bcrypt.hash(body.password, 10);
    if (body.permissions !== undefined) data.permissions = (parseOverrides(body.permissions) ?? Prisma.JsonNull) as Prisma.InputJsonValue;

    const after = await prisma.user.update({ where: { id }, data, select: userSelect });
    invalidatePermissions(id);
    await audit(prisma, {
      ...actorOf(req),
      action: 'user.update',
      entityType: 'User',
      entityId: id,
      before: { role: before.role, isActive: before.isActive, permissions: before.permissions },
      after: { role: after.role, isActive: after.isActive, permissions: after.permissions, passwordChanged: !!body.password },
    });
    return shape(after);
  });

  /** Flip one capability for one user; the role stays as it is. */
  app.post('/admin/users/:id/permissions', { preHandler: [allow('users.manage')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { action, allowed } = parse(z.object({ action: z.string(), allowed: z.boolean() }), req.body);
    if (!isAction(action)) throw badRequest(`Unknown capability: ${action}`);
    const user = await prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!user) throw notFound('User not found');
    if (id === req.user!.id && action === 'users.manage' && !allowed) throw badRequest('You cannot remove your own user-management permission');

    const current = parseOverrides(user.permissions) ?? {};
    const grant = new Set(current.grant ?? []);
    const revoke = new Set(current.revoke ?? []);
    grant.delete(action);
    revoke.delete(action);
    // Only store an override when it differs from what the role already gives.
    if (allowed !== roleHas(user.role, action)) (allowed ? grant : revoke).add(action);
    const next = grant.size || revoke.size ? { grant: [...grant], revoke: [...revoke] } : null;

    const after = await prisma.user.update({ where: { id }, data: { permissions: (next ?? Prisma.JsonNull) as Prisma.InputJsonValue }, select: userSelect });
    invalidatePermissions(id);
    await audit(prisma, { ...actorOf(req), action: allowed ? 'user.permission.grant' : 'user.permission.revoke', entityType: 'User', entityId: id, before: current, after: next, reason: action });
    await notifyUsers(prisma, [id], { type: 'account.permissions', title: 'Your permissions changed', body: `${allowed ? 'Granted' : 'Removed'}: ${ACTIONS.find((a) => a.key === action)?.label ?? action}.`, payload: { action, allowed } });
    return shape(after);
  });

  app.post('/admin/users/:id/reset-password', { preHandler: [allow('users.manage')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!user) throw notFound('User not found');
    const password = `Rte${Math.random().toString(36).slice(2, 8)}!`;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10), failedLogins: 0, lockedUntil: null } });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, { ...actorOf(req), action: 'user.password_reset', entityType: 'User', entityId: id });
    });
    return { email: user.email, temporaryPassword: password };
  });

  app.delete('/admin/users/:id', { preHandler: [allow('users.manage')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    if (id === req.user!.id) throw badRequest('You cannot deactivate yourself');
    const user = await prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
    if (!user) throw notFound('User not found');
    if (user.role === 'ADMIN') {
      const admins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (admins <= 1) throw conflict('This is the last active administrator');
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive: false } });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, { ...actorOf(req), action: 'user.deactivate', entityType: 'User', entityId: id, before: { isActive: true } });
    });
    invalidatePermissions(id);
    return { ok: true };
  });

  void forbidden;
}
