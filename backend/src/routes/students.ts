import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
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
  sectionId: z.string().min(1).nullable().optional(),
  createLogin: z.boolean().optional(),
  password: z.string().min(8).max(72).optional(),
  /** Put them in the emptiest group and enrol them on the semester's modules. */
  autoEnroll: z.boolean().optional(),
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

  /**
   * Everything the enrolment form needs to fill itself in: the next free institutional ID, the
   * group with the most room, and the semester the intake is currently in.
   *
   * Typing an ID by hand is how two students end up sharing one, and picking a group by hand is
   * how one ends up with twenty-six people in a room of twenty.
   */
  app.get('/students/enrolment-defaults', { preHandler: [allow('student.write')] }, async (req) => {
    const q = parse(z.object({ programmeId: z.string(), intakeId: z.string() }), req.query);
    const intake = await prisma.intake.findUnique({
      where: { id: q.intakeId },
      include: {
        programme: { select: { id: true, code: true } },
        sections: { select: { id: true, name: true, _count: { select: { students: true } } } },
        semesters: { orderBy: { number: 'desc' }, take: 1, select: { id: true, number: true, term: true } },
      },
    });
    if (!intake || intake.programmeId !== q.programmeId) throw badRequest('That intake does not belong to that programme');

    // Institutional IDs run <intake year, two digits><programme prefix><serial>, the same shape the
    // seeded records use, so a new enrolment sorts alongside its cohort.
    const last = await prisma.student.findFirst({
      where: { intakeId: q.intakeId },
      orderBy: { studentId: 'desc' },
      select: { studentId: true },
    });
    const nextSerial = last ? String(Number(last.studentId.slice(-4)) + 1).padStart(4, '0') : '0001';
    const stem = last ? last.studentId.slice(0, -4) : `${String(intake.startDate.getUTCFullYear()).slice(2)}${intake.programme.code.slice(-2)}`;

    const sections = intake.sections
      .map((s) => ({ id: s.id, name: s.name, students: s._count.students }))
      .sort((a, b) => a.students - b.students || a.name.localeCompare(b.name));

    return {
      studentId: `${stem}${nextSerial}`,
      suggestedSectionId: sections[0]?.id ?? null,
      sections,
      currentSemester: intake.semesters[0] ?? null,
    };
  });

  app.post('/students', { preHandler: [allow('student.write')] }, async (req, reply) => {
    const body = parse(studentBody, req.body);
    const { createLogin, password, autoEnroll, ...data } = body;
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
      // A new enrolment that is not in a group and not on any module is a name in a list, so the
      // whole placement happens here rather than as three more forms somebody has to remember.
      let sectionId = data.sectionId ?? null;
      let semesterId = data.currentSemesterId ?? null;
      if (autoEnroll) {
        const sections = await tx.section.findMany({
          where: { intakeId: data.intakeId },
          select: { id: true, name: true, _count: { select: { students: true } } },
        });
        if (!sectionId && sections.length) {
          sectionId = [...sections].sort((a, b) => a._count.students - b._count.students || a.name.localeCompare(b.name))[0].id;
        }
        if (!semesterId) {
          const sem = await tx.semester.findFirst({ where: { intakeId: data.intakeId }, orderBy: { number: 'desc' }, select: { id: true } });
          semesterId = sem?.id ?? null;
        }
      }

      const s = await tx.student.create({
        data: { ...data, email: data.email ?? null, sectionId, currentSemesterId: semesterId, userId },
        select: studentSummary,
      });

      let enrolled = 0;
      if (autoEnroll && semesterId) {
        const offerings = await tx.moduleOffering.findMany({ where: { semesterId }, select: { id: true } });
        if (offerings.length) {
          const res = await tx.enrollment.createMany({
            data: offerings.map((o) => ({ studentId: s.id, moduleOfferingId: o.id })),
            skipDuplicates: true,
          });
          enrolled = res.count;
        }
      }

      await audit(tx, { ...actorOf(req), action: 'student.create', entityType: 'Student', entityId: s.id, after: { ...s, enrolled } });
      return { ...s, enrolledModules: enrolled };
    });
    reply.code(201);
    return student;
  });

  /**
   * Everything on one student, as a workbook.
   *
   * A profile screen answers "how is this person doing"; a spreadsheet answers the questions
   * nobody anticipated — a scholarship panel sorting by credits, a visa letter needing every
   * module and grade, an appeal that turns on one component. Four sheets rather than one, because
   * a single flat export makes each of those a filtering exercise.
   */
  app.get('/students/:id/export.xlsx', { preHandler: [requireRole(...STAFF, 'STUDENT')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const u = req.user!;
    if (u.role === 'STUDENT' && u.studentId !== id) throw forbidden('Students can only export their own record');
    const p = await loadProfile(id, u);
    const s = p.student;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'KramIQ · RTE Management System';
    wb.created = new Date();

    const info = wb.addWorksheet('Student');
    info.columns = [{ width: 26 }, { width: 56 }];
    const pair = (k: string, v: string | number | null | undefined) => {
      const row = info.addRow([k, v ?? '—']);
      row.getCell(1).font = { bold: true };
    };
    pair('Name', s.name);
    pair('Student ID', s.studentId);
    pair('Email', s.email ?? s.login?.email ?? null);
    pair('Programme', `${s.programme.code} — ${s.programme.name}`);
    pair('Level', s.programme.level);
    pair('Intake', s.intake.label);
    pair('Current semester', s.currentSemester ? `Semester ${s.currentSemester.number}` : 'Not in a semester');
    pair('Status', s.status);
    pair('Standing', s.standing);
    pair('Modules taken', p.stats.modulesTaken);
    pair('Passed', p.stats.passed);
    pair('Failed', p.stats.failed);
    pair('Resits', p.stats.resits);
    pair('Awaiting publication', p.stats.pending);
    pair('Exported', new Date().toISOString());

    const res = wb.addWorksheet('Results');
    res.columns = [
      { header: 'Semester', key: 'sem', width: 10 },
      { header: 'Module code', key: 'code', width: 14 },
      { header: 'Module', key: 'title', width: 44 },
      { header: 'Credits', key: 'credits', width: 9 },
      { header: 'Attempt', key: 'attempt', width: 9 },
      { header: 'Resit', key: 'resit', width: 7 },
      { header: 'Lecturer', key: 'lecturer', width: 26 },
      { header: 'Mark', key: 'mark', width: 8 },
      { header: 'Grade', key: 'grade', width: 8 },
      { header: 'Outcome', key: 'outcome', width: 14 },
    ];
    for (const sem of p.semesters) {
      for (const m of sem.modules) {
        res.addRow({
          sem: sem.number,
          code: m.module.code,
          title: m.module.title,
          credits: m.module.credits,
          attempt: m.attempt,
          resit: m.isResit ? 'Yes' : '',
          lecturer: m.lecturer ?? '—',
          mark: m.result ? m.result.overallMark : null,
          grade: m.result?.grade ?? '',
          outcome: m.result ? m.result.outcome : 'Awaiting publication',
        });
      }
    }
    res.getRow(1).font = { bold: true };

    const comp = wb.addWorksheet('Components');
    comp.columns = [
      { header: 'Module code', key: 'code', width: 14 },
      { header: 'Component', key: 'name', width: 30 },
      { header: 'Weight %', key: 'weight', width: 10 },
      { header: 'Out of', key: 'max', width: 9 },
      { header: 'Mark', key: 'mark', width: 8 },
      { header: 'Absent', key: 'absent', width: 8 },
    ];
    const marks = await prisma.mark.findMany({
      where: { enrollment: { studentId: id }, markSheet: { status: 'PUBLISHED' } },
      select: {
        rawMark: true,
        isAbsent: true,
        component: { select: { name: true, weight: true, maxMark: true } },
        enrollment: { select: { moduleOffering: { select: { module: { select: { code: true } } } } } },
      },
    });
    for (const m of marks) {
      comp.addRow({
        code: m.enrollment.moduleOffering.module.code,
        name: m.component.name,
        weight: m.component.weight,
        max: m.component.maxMark,
        mark: m.rawMark === null ? null : Number(m.rawMark),
        absent: m.isAbsent ? 'Yes' : '',
      });
    }
    comp.getRow(1).font = { bold: true };

    const att = wb.addWorksheet('Attendance');
    att.columns = [
      { header: 'Module code', key: 'code', width: 14 },
      { header: 'Classes held', key: 'held', width: 13 },
      { header: 'Attended', key: 'attended', width: 11 },
      { header: 'Rate %', key: 'rate', width: 9 },
    ];
    const attendance = await prisma.attendanceRecord.findMany({
      where: { studentId: id },
      select: { status: true, offering: { select: { module: { select: { code: true } } } } },
    });
    const byModule = new Map<string, { held: number; attended: number }>();
    for (const a of attendance) {
      const code = a.offering.module.code;
      const cur = byModule.get(code) ?? { held: 0, attended: 0 };
      cur.held += 1;
      if (a.status !== 'ABSENT') cur.attended += 1;
      byModule.set(code, cur);
    }
    for (const [code, v] of byModule) att.addRow({ code, held: v.held, attended: v.attended, rate: Math.round((v.attended / v.held) * 100) });
    att.getRow(1).font = { bold: true };

    const buf = await wb.xlsx.writeBuffer();
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition', `attachment; filename="${s.studentId}-academic-record.xlsx"`);
    return Buffer.from(buf);
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
