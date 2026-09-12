import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow } from '../plugins/auth';

const programmeBody = z.object({
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(120),
  level: z.string().trim().min(1).max(40),
});
const intakeBody = z.object({ label: z.string().trim().min(2).max(40), startDate: z.coerce.date() });
const semesterBody = z.object({
  number: z.number().int().min(1).max(12),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

/** Programmes → intakes → semesters. Read: staff. Write: admin. */
export async function programmeRoutes(app: FastifyInstance) {
  app.get('/programmes', { preHandler: [allow('programme.read')] }, async () =>
    prisma.programme.findMany({
      orderBy: { code: 'asc' },
      include: {
        intakes: { orderBy: { startDate: 'desc' }, include: { semesters: { orderBy: { number: 'asc' } } } },
        _count: { select: { students: true, modules: true } },
      },
    }),
  );

  app.post('/programmes', { preHandler: [allow('programme.write')] }, async (req, reply) => {
    const body = parse(programmeBody, req.body);
    const programme = await prisma.programme.create({ data: body });
    await audit(prisma, { ...actorOf(req), action: 'programme.create', entityType: 'Programme', entityId: programme.id, after: programme });
    reply.code(201);
    return programme;
  });

  app.patch('/programmes/:id', { preHandler: [allow('programme.write')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(programmeBody.partial(), req.body);
    const before = await prisma.programme.findUnique({ where: { id } });
    if (!before) throw notFound('Programme not found');
    const after = await prisma.programme.update({ where: { id }, data: body });
    await audit(prisma, { ...actorOf(req), action: 'programme.update', entityType: 'Programme', entityId: id, before, after });
    return after;
  });

  app.post('/programmes/:id/intakes', { preHandler: [allow('programme.write')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(intakeBody, req.body);
    const programme = await prisma.programme.findUnique({ where: { id } });
    if (!programme) throw notFound('Programme not found');
    const intake = await prisma.intake.create({ data: { ...body, programmeId: id } });
    await audit(prisma, { ...actorOf(req), action: 'intake.create', entityType: 'Intake', entityId: intake.id, after: intake });
    reply.code(201);
    return intake;
  });

  app.get('/intakes', { preHandler: [allow('programme.read')] }, async (req) => {
    const { programmeId } = parse(z.object({ programmeId: z.string().optional() }), req.query);
    return prisma.intake.findMany({
      where: programmeId ? { programmeId } : undefined,
      include: { programme: { select: { id: true, code: true, name: true } }, semesters: { orderBy: { number: 'asc' } } },
      orderBy: [{ programme: { code: 'asc' } }, { startDate: 'desc' }],
    });
  });

  app.post('/intakes/:id/semesters', { preHandler: [allow('programme.write')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(semesterBody, req.body);
    if (body.endDate <= body.startDate) throw badRequest('endDate must be after startDate');
    const intake = await prisma.intake.findUnique({ where: { id } });
    if (!intake) throw notFound('Intake not found');
    const semester = await prisma.semester.create({ data: { ...body, intakeId: id } });
    await audit(prisma, { ...actorOf(req), action: 'semester.create', entityType: 'Semester', entityId: semester.id, after: semester });
    reply.code(201);
    return semester;
  });

  app.get('/semesters', { preHandler: [allow('programme.read')] }, async (req) => {
    const { intakeId } = parse(z.object({ intakeId: z.string().optional() }), req.query);
    return prisma.semester.findMany({
      where: intakeId ? { intakeId } : undefined,
      include: { intake: { include: { programme: { select: { id: true, code: true, name: true } } } } },
      orderBy: [{ intake: { startDate: 'desc' } }, { number: 'asc' }],
    });
  });
}
