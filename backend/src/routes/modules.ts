import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow } from '../plugins/auth';

const moduleBody = z.object({
  code: z.string().trim().min(2).max(20),
  title: z.string().trim().min(2).max(160),
  credits: z.number().int().positive().max(120),
  semesterNumber: z.number().int().min(1).max(12),
  programmeId: z.string().min(1),
  moduleLeaderId: z.string().min(1).nullable().optional(),
});

const componentBody = z.object({
  name: z.string().trim().min(1).max(60),
  weight: z.number().int().min(0).max(100),
  maxMark: z.number().int().positive().max(1000),
  componentPassMark: z.number().int().min(0).nullable().optional(),
});

const offeringBody = z.object({
  moduleId: z.string().min(1),
  semesterId: z.string().min(1),
  lecturerId: z.string().min(1).nullable().optional(),
  components: z.array(componentBody).optional(),
});

const enrolBody = z.object({
  studentIds: z.array(z.string().min(1)).min(1).max(500),
  isResit: z.boolean().default(false),
});

function assertWeights(components: { weight: number; maxMark: number; componentPassMark?: number | null }[]) {
  const total = components.reduce((s, c) => s + c.weight, 0);
  if (total !== 100) throw badRequest(`Component weights must sum to 100 (got ${total})`);
  for (const c of components) {
    if (c.componentPassMark != null && c.componentPassMark > c.maxMark) {
      throw badRequest('componentPassMark cannot exceed maxMark');
    }
  }
}

/** Scope filter: lecturers see offerings they teach, module leaders those they lead (or teach). */
export function offeringScope(req: FastifyRequest): Prisma.ModuleOfferingWhereInput | undefined {
  const u = req.user!;
  if (u.role === 'ADMIN') return undefined;
  if (u.role === 'LECTURER') return { lecturerId: u.id };
  if (u.role === 'MODULE_LEADER') return { OR: [{ lecturerId: u.id }, { module: { moduleLeaderId: u.id } }] };
  return { id: '__none__' };
}

export async function moduleRoutes(app: FastifyInstance) {
  app.get('/modules', { preHandler: [allow('module.read')] }, async (req) => {
    const { programmeId } = parse(z.object({ programmeId: z.string().optional() }), req.query);
    return prisma.module.findMany({
      where: programmeId ? { programmeId } : undefined,
      include: {
        programme: { select: { id: true, code: true, name: true } },
        moduleLeader: { select: { id: true, name: true, email: true } },
        _count: { select: { offerings: true } },
      },
      orderBy: [{ programme: { code: 'asc' } }, { semesterNumber: 'asc' }, { code: 'asc' }],
    });
  });

  app.post('/modules', { preHandler: [allow('module.write')] }, async (req, reply) => {
    const body = parse(moduleBody, req.body);
    const mod = await prisma.module.create({ data: body });
    await audit(prisma, { ...actorOf(req), action: 'module.create', entityType: 'Module', entityId: mod.id, after: mod });
    reply.code(201);
    return mod;
  });

  app.patch('/modules/:id', { preHandler: [allow('module.write')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(moduleBody.partial(), req.body);
    const before = await prisma.module.findUnique({ where: { id } });
    if (!before) throw notFound('Module not found');
    const after = await prisma.module.update({ where: { id }, data: body });
    await audit(prisma, { ...actorOf(req), action: 'module.update', entityType: 'Module', entityId: id, before, after });
    return after;
  });

  app.get('/offerings', { preHandler: [allow('module.read')] }, async (req) => {
    const q = parse(
      z.object({
        semesterId: z.string().optional(),
        moduleId: z.string().optional(),
        programmeId: z.string().optional(),
        mine: z.coerce.boolean().optional(),
      }),
      req.query,
    );
    const scope = q.mine ? { OR: [{ lecturerId: req.user!.id }, { module: { moduleLeaderId: req.user!.id } }] } : offeringScope(req);
    return prisma.moduleOffering.findMany({
      where: {
        AND: [
          scope ?? {},
          q.semesterId ? { semesterId: q.semesterId } : {},
          q.moduleId ? { moduleId: q.moduleId } : {},
          q.programmeId ? { module: { programmeId: q.programmeId } } : {},
        ],
      },
      include: {
        module: { select: { id: true, code: true, title: true, credits: true, semesterNumber: true, programme: { select: { code: true } }, moduleLeader: { select: { id: true, name: true } } } },
        semester: { select: { id: true, number: true, intake: { select: { label: true, programme: { select: { code: true } } } } } },
        lecturer: { select: { id: true, name: true } },
        components: { orderBy: { sortOrder: 'asc' } },
        markSheets: { orderBy: { version: 'desc' }, take: 1, select: { id: true, status: true, version: true, publishedAt: true } },
        _count: { select: { enrollments: true } },
      },
      orderBy: [{ semester: { intake: { startDate: 'desc' } } }, { semester: { number: 'asc' } }, { module: { code: 'asc' } }],
    });
  });

  app.get('/offerings/:id', { preHandler: [allow('module.read')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const offering = await prisma.moduleOffering.findFirst({
      where: { AND: [{ id }, offeringScope(req) ?? {}] },
      include: {
        module: { include: { programme: { select: { id: true, code: true, name: true } }, moduleLeader: { select: { id: true, name: true } } } },
        semester: { include: { intake: { select: { id: true, label: true } } } },
        lecturer: { select: { id: true, name: true, email: true } },
        components: { orderBy: { sortOrder: 'asc' } },
        enrollments: {
          where: { deletedAt: null },
          include: { student: { select: { id: true, studentId: true, name: true, status: true } } },
          orderBy: { student: { studentId: 'asc' } },
        },
        markSheets: { orderBy: { version: 'desc' }, select: { id: true, status: true, version: true, publishedAt: true, updatedAt: true } },
      },
    });
    if (!offering) throw notFound('Module offering not found');
    return offering;
  });

  app.post('/offerings', { preHandler: [allow('module.write')] }, async (req, reply) => {
    const body = parse(offeringBody, req.body);
    if (body.components) assertWeights(body.components);
    const offering = await prisma.moduleOffering.create({
      data: {
        moduleId: body.moduleId,
        semesterId: body.semesterId,
        lecturerId: body.lecturerId ?? null,
        components: body.components
          ? { create: body.components.map((c, i) => ({ ...c, componentPassMark: c.componentPassMark ?? null, sortOrder: i })) }
          : undefined,
      },
      include: { components: true },
    });
    await audit(prisma, { ...actorOf(req), action: 'offering.create', entityType: 'ModuleOffering', entityId: offering.id, after: offering });
    reply.code(201);
    return offering;
  });

  app.put('/offerings/:id/components', { preHandler: [allow('module.read')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const components = parse(z.array(componentBody).min(1).max(20), req.body);
    assertWeights(components);
    const offering = await prisma.moduleOffering.findUnique({
      where: { id },
      include: { module: true, components: true, markSheets: { select: { id: true, status: true } } },
    });
    if (!offering) throw notFound('Module offering not found');
    const u = req.user!;
    const isLeader = offering.module.moduleLeaderId === u.id;
    if (u.role !== 'ADMIN' && !(u.role === 'MODULE_LEADER' && isLeader)) {
      throw forbidden('Only the RTE admin or the module leader can change assessment components');
    }
    const marks = await prisma.mark.count({ where: { markSheet: { moduleOfferingId: id } } });
    if (marks > 0) throw conflict('Components are locked once marks exist for this offering');

    const updated = await prisma.$transaction(async (tx) => {
      await tx.assessmentComponent.deleteMany({ where: { moduleOfferingId: id } });
      await tx.assessmentComponent.createMany({
        data: components.map((c, i) => ({ ...c, componentPassMark: c.componentPassMark ?? null, moduleOfferingId: id, sortOrder: i })),
      });
      await audit(tx, { ...actorOf(req), action: 'offering.components.replace', entityType: 'ModuleOffering', entityId: id, before: offering.components, after: components });
      return tx.assessmentComponent.findMany({ where: { moduleOfferingId: id }, orderBy: { sortOrder: 'asc' } });
    });
    return updated;
  });


  /** Class list for a module offering: everyone enrolled, grouped by section, with their timetable. */
  app.get('/offerings/:id/class-list', { preHandler: [allow('module.read')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const offering = await prisma.moduleOffering.findFirst({
      where: { AND: [{ id }, offeringScope(req) ?? {}] },
      include: {
        module: { select: { code: true, title: true, credits: true, moduleLeader: { select: { name: true } } } },
        semester: { select: { number: true, term: true, intake: { select: { label: true, programme: { select: { code: true, name: true } } } } } },
        lecturer: { select: { id: true, name: true, email: true } },
        components: { orderBy: { sortOrder: 'asc' } },
        enrollments: {
          where: { deletedAt: null },
          include: {
            student: {
              select: {
                id: true, studentId: true, name: true, email: true, status: true, standing: true, specialNeedsSeating: true,
                section: { select: { id: true, name: true } },
              },
            },
            results: { orderBy: { markSheetVersion: 'desc' }, take: 1, select: { grade: true, outcome: true, overallMark: true, markSheet: { select: { status: true } } } },
          },
          orderBy: { student: { studentId: 'asc' } },
        },
        slots: { include: { section: { select: { id: true, name: true } }, venue: { select: { name: true } }, teacher: { select: { name: true } } }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
      },
    });
    if (!offering) throw notFound('Module offering not found');

    const rows = offering.enrollments.map((e) => ({
      enrollmentId: e.id,
      studentId: e.student.studentId,
      name: e.student.name,
      email: e.student.email,
      section: e.student.section?.name ?? null,
      sectionId: e.student.section?.id ?? null,
      status: e.student.status,
      standing: e.student.standing,
      specialNeedsSeating: e.student.specialNeedsSeating,
      attempt: e.attempt,
      isResit: e.isResit,
      result: e.results[0] ? { grade: e.results[0].grade, outcome: e.results[0].outcome, overallMark: Number(e.results[0].overallMark), published: e.results[0].markSheet.status === 'PUBLISHED' } : null,
      studentRecordId: e.student.id,
    }));
    const bySection = [...new Set(rows.map((r) => r.section ?? 'Unassigned'))].sort().map((name) => ({
      section: name,
      students: rows.filter((r) => (r.section ?? 'Unassigned') === name),
      classes: offering.slots.filter((s) => s.section.name === name).map((s) => ({ dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, venue: s.venue?.name ?? null, teacher: s.teacher.name })),
    }));
    return {
      offering: {
        id: offering.id,
        module: offering.module,
        semester: offering.semester,
        lecturer: offering.lecturer,
        components: offering.components,
      },
      total: rows.length,
      resits: rows.filter((r) => r.isResit).length,
      specialNeeds: rows.filter((r) => r.specialNeedsSeating).length,
      sections: bySection,
      students: rows,
    };
  });

  /** The same list as a spreadsheet the module leader can print or mark up. */
  app.get('/offerings/:id/class-list.csv', { preHandler: [allow('module.read')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const offering = await prisma.moduleOffering.findFirst({
      where: { AND: [{ id }, offeringScope(req) ?? {}] },
      include: {
        module: { select: { code: true, title: true } },
        semester: { select: { number: true, intake: { select: { label: true, programme: { select: { code: true } } } } } },
        enrollments: {
          where: { deletedAt: null },
          include: { student: { select: { studentId: true, name: true, email: true, status: true, section: { select: { name: true } } } } },
          orderBy: [{ student: { section: { name: 'asc' } } }, { student: { studentId: 'asc' } }],
        },
      },
    });
    if (!offering) throw notFound('Module offering not found');
    const esc = (s: string) => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
    const header = ['Student ID', 'Name', 'Section', 'Email', 'Status', 'Attempt', 'Resit'].join(',');
    const lines = offering.enrollments.map((e) =>
      [e.student.studentId, e.student.name, e.student.section?.name ?? '', e.student.email ?? '', e.student.status, String(e.attempt), e.isResit ? 'yes' : 'no'].map(esc).join(','),
    );
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="' + offering.module.code + '-class-list.csv"');
    return [header, ...lines].join('\r\n') + '\r\n';
  });

  app.post('/offerings/:id/enrollments', { preHandler: [allow('student.write')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(enrolBody, req.body);
    const offering = await prisma.moduleOffering.findUnique({ where: { id }, select: { id: true, moduleId: true } });
    if (!offering) throw notFound('Module offering not found');

    const created: string[] = [];
    const skipped: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const studentId of body.studentIds) {
        const exists = await tx.enrollment.findFirst({ where: { studentId, moduleOfferingId: id, deletedAt: null } });
        if (exists) {
          skipped.push(studentId);
          continue;
        }
        const previous = await tx.enrollment.count({ where: { studentId, moduleOffering: { moduleId: offering.moduleId } } });
        if (previous >= 3) throw conflict(`Student ${studentId} has already used 3 attempts at this module`);
        const e = await tx.enrollment.create({
          data: { studentId, moduleOfferingId: id, attempt: previous + 1, isResit: body.isResit || previous > 0 },
        });
        created.push(e.id);
      }
      await audit(tx, { ...actorOf(req), action: 'enrollment.bulk_create', entityType: 'ModuleOffering', entityId: id, after: { created: created.length, skipped } });
    });
    reply.code(201);
    return { created: created.length, skipped };
  });
}
