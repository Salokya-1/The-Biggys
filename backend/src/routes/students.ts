import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { idParam, paged, pagination, parse } from '../lib/validation';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow, requireRole, STAFF } from '../plugins/auth';

const listQuery = pagination.extend({
  q: z.string().trim().max(80).optional(),
  programmeId: z.string().optional(),
  intakeId: z.string().optional(),
  semesterNumber: z.coerce.number().int().min(1).max(12).optional(),
  status: z.enum(['ACTIVE', 'DEFERRED', 'WITHDRAWN', 'GRADUATED']).optional(),
  standing: z.enum(['GOOD', 'RESIT', 'REVIEW']).optional(),
});

const studentBody = z.object({
  studentId: z.string().trim().min(3).max(20),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().regex(/^\S+@\S+$/, 'Invalid email').optional().nullable(),
  programmeId: z.string().min(1),
  intakeId: z.string().min(1),
  currentSemesterId: z.string().min(1).nullable().optional(),
  status: z.enum(['ACTIVE', 'DEFERRED', 'WITHDRAWN', 'GRADUATED']).optional(),
  standing: z.enum(['GOOD', 'RESIT', 'REVIEW']).optional(),
  specialNeedsSeating: z.boolean().optional(),
  createLogin: z.boolean().optional(),
  password: z.string().min(8).max(72).optional(),
});

const studentSummary = {
  id: true,
  studentId: true,
  name: true,
  email: true,
  status: true,
  standing: true,
  specialNeedsSeating: true,
  programme: { select: { id: true, code: true, name: true } },
  intake: { select: { id: true, label: true } },
  currentSemester: { select: { id: true, number: true } },
} satisfies Prisma.StudentSelect;

/** Full academic profile. Students see only PUBLISHED results (filtered in the query). */
async function loadProfile(id: string, viewer: FastifyRequest['user']) {
  const forStudent = viewer?.role === 'STUDENT';
  const now = new Date();
  const student = await prisma.student.findFirst({
    where: { id, deletedAt: null },
    include: {
      programme: { select: { id: true, code: true, name: true, level: true } },
      intake: { select: { id: true, label: true, startDate: true } },
      currentSemester: { select: { id: true, number: true, startDate: true, endDate: true } },
      user: { select: { email: true, isActive: true } },
      enrollments: {
        where: { deletedAt: null },
        include: {
          moduleOffering: {
            include: {
              module: { select: { id: true, code: true, title: true, credits: true, semesterNumber: true } },
              semester: { select: { id: true, number: true, intake: { select: { label: true } } } },
              lecturer: { select: { name: true } },
            },
          },
          results: {
            where: forStudent ? { markSheet: { status: 'PUBLISHED', publishedAt: { lte: now } } } : undefined,
            orderBy: { markSheetVersion: 'desc' },
            take: 1,
            include: { markSheet: { select: { status: true, version: true, publishedAt: true } } },
          },
        },
        orderBy: [{ moduleOffering: { semester: { number: 'asc' } } }, { attempt: 'asc' }],
      },
    },
  });
  if (!student) throw notFound('Student not found');

  type Row = (typeof student.enrollments)[number];
  const rowOf = (e: Row) => {
    const r = e.results[0];
    return {
      enrollmentId: e.id,
      module: e.moduleOffering.module,
      offeringId: e.moduleOffering.id,
      lecturer: e.moduleOffering.lecturer?.name ?? null,
      semesterNumber: e.moduleOffering.semester.number,
      attempt: e.attempt,
      isResit: e.isResit,
      result: r
        ? {
            overallMark: Number(r.overallMark),
            grade: r.grade,
            outcome: r.outcome,
            version: r.markSheetVersion,
            status: r.markSheet.status,
            publishedAt: r.markSheet.publishedAt,
          }
        : null,
    };
  };

  const bySemester = new Map<number, ReturnType<typeof rowOf>[]>();
  for (const e of student.enrollments) {
    const n = e.moduleOffering.semester.number;
    if (!bySemester.has(n)) bySemester.set(n, []);
    bySemester.get(n)!.push(rowOf(e));
  }
  const semesters = [...bySemester.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, modules]) => ({
      number,
      modules,
      summary: {
        modules: modules.length,
        passed: modules.filter((m) => m.result?.outcome === 'PASS').length,
        failed: modules.filter((m) => m.result?.outcome === 'FAIL').length,
        resit: modules.filter((m) => m.result?.outcome === 'RESIT').length,
        pending: modules.filter((m) => !m.result).length,
      },
    }));

  const all = semesters.flatMap((s) => s.modules);
  const { enrollments: _drop, user, ...rest } = student;
  return {
    student: { ...rest, login: user ? { email: user.email, isActive: user.isActive } : null },
    semesters,
    resits: all.filter((m) => m.isResit),
    stats: {
      modulesTaken: all.length,
      passed: all.filter((m) => m.result?.outcome === 'PASS').length,
      failed: all.filter((m) => m.result?.outcome === 'FAIL').length,
      resits: all.filter((m) => m.isResit).length,
      pending: all.filter((m) => !m.result).length,
    },
  };
}

export async function studentRoutes(app: FastifyInstance) {
  app.get('/students', { preHandler: [allow('student.read')] }, async (req) => {
    const q = parse(listQuery, req.query);
    const where: Prisma.StudentWhereInput = {
      deletedAt: null,
      ...(q.programmeId ? { programmeId: q.programmeId } : {}),
      ...(q.intakeId ? { intakeId: q.intakeId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.standing ? { standing: q.standing } : {}),
      ...(q.semesterNumber ? { currentSemester: { number: q.semesterNumber } } : {}),
      ...(q.q
        ? {
            OR: [
              { studentId: { contains: q.q, mode: 'insensitive' } },
              { name: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items] = await prisma.$transaction([
      prisma.student.count({ where }),
      prisma.student.findMany({
        where,
        select: studentSummary,
        orderBy: { studentId: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return paged(items, total, q.page, q.pageSize);
  });

  app.get('/students/me', { preHandler: [requireRole('STUDENT')] }, async (req) => {
    const sid = req.user!.studentId;
    if (!sid) throw notFound('No student record is linked to this account');
    return loadProfile(sid, req.user);
  });

  app.get('/students/:id', { preHandler: [requireRole(...STAFF, 'STUDENT')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const u = req.user!;
    if (u.role === 'STUDENT' && u.studentId !== id) throw forbidden('Students can only view their own record');
    return loadProfile(id, u);
  });

  app.post('/students', { preHandler: [allow('student.write')] }, async (req, reply) => {
    const body = parse(studentBody, req.body);
    const { createLogin, password, ...data } = body;
    if (createLogin && !data.email) throw badRequest('email is required to create a login');
    const intake = await prisma.intake.findUnique({ where: { id: data.intakeId } });
    if (!intake || intake.programmeId !== data.programmeId) throw badRequest('intake does not belong to programme');

    const student = await prisma.$transaction(async (tx) => {
      let userId: string | undefined;
      // Link an existing, unlinked STUDENT login with the same email (e.g. seeded accounts).
      if (data.email) {
        const existing = await tx.user.findFirst({
          where: { email: data.email.toLowerCase(), role: 'STUDENT', student: null },
          select: { id: true },
        });
        if (existing) userId = existing.id;
      }
      if (createLogin && !userId) {
        const user = await tx.user.create({
          data: {
            email: data.email!.toLowerCase(),
            name: data.name,
            role: 'STUDENT',
            passwordHash: await bcrypt.hash(password ?? 'Student123!', 10),
          },
        });
        userId = user.id;
      }
      const s = await tx.student.create({
        data: { ...data, email: data.email ?? null, currentSemesterId: data.currentSemesterId ?? null, userId },
        select: studentSummary,
      });
      await audit(tx, { ...actorOf(req), action: 'student.create', entityType: 'Student', entityId: s.id, after: s });
      return s;
    });
    reply.code(201);
    return student;
  });

  app.patch('/students/:id', { preHandler: [allow('student.write')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(studentBody.omit({ createLogin: true, password: true }).partial(), req.body);
    const before = await prisma.student.findFirst({ where: { id, deletedAt: null }, select: studentSummary });
    if (!before) throw notFound('Student not found');
    const after = await prisma.student.update({ where: { id }, data: body, select: studentSummary });
    await audit(prisma, { ...actorOf(req), action: 'student.update', entityType: 'Student', entityId: id, before, after });
    return after;
  });

  app.delete('/students/:id', { preHandler: [allow('student.write')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body ?? {});
    const before = await prisma.student.findFirst({ where: { id, deletedAt: null }, select: studentSummary });
    if (!before) throw notFound('Student not found');
    await prisma.$transaction(async (tx) => {
      await tx.student.update({ where: { id }, data: { deletedAt: new Date() } });
      if (before.email) await tx.user.updateMany({ where: { student: { id } }, data: { isActive: false } });
      await audit(tx, { ...actorOf(req), action: 'student.soft_delete', entityType: 'Student', entityId: id, before, reason });
    });
    return { ok: true };
  });
}
