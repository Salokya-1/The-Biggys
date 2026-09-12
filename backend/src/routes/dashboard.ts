import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { allow } from '../plugins/auth';
import { capacityOf } from '../lib/seating';

const OVERDUE_DAYS = 3;
const OPEN: ('DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED')[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED'];

/** Leadership dashboard — only metrics with operational value, all computed live. */
export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: [allow('dashboard.read')] }, async () => {
    const now = new Date();
    const overdueBefore = new Date(now.getTime() - OVERDUE_DAYS * 86400e3);

    // ---------- result-processing funnel ----------
    const byStatus = await prisma.markSheet.groupBy({ by: ['status'], _count: { _all: true } });
    const funnel = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Record<string, number>;
    const overdue = await prisma.markSheet.findMany({
      where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] }, updatedAt: { lt: overdueBefore } },
      select: { id: true, status: true, updatedAt: true, moduleOffering: { select: { module: { select: { code: true } }, semester: { select: { number: true, intake: { select: { label: true } } } } } } },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    });

    // ---------- publication status of open sheets (missing marks per sheet) ----------
    const openSheets = await prisma.markSheet.findMany({
      where: { status: { in: OPEN } },
      select: {
        id: true,
        status: true,
        version: true,
        updatedAt: true,
        _count: { select: { marks: true } },
        moduleOffering: {
          select: {
            module: { select: { code: true, title: true } },
            lecturer: { select: { name: true } },
            semester: { select: { number: true, intake: { select: { label: true, programme: { select: { code: true } } } } } },
            _count: { select: { components: true, enrollments: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const publication = openSheets.map((s) => {
      const expected = s.moduleOffering._count.components * s.moduleOffering._count.enrollments;
      return {
        id: s.id,
        module: s.moduleOffering.module.code,
        title: s.moduleOffering.module.title,
        cohort: `${s.moduleOffering.semester.intake.programme.code} ${s.moduleOffering.semester.intake.label} S${s.moduleOffering.semester.number}`,
        lecturer: s.moduleOffering.lecturer?.name ?? null,
        status: s.status,
        version: s.version,
        marksEntered: s._count.marks,
        marksExpected: expected,
        missing: Math.max(0, expected - s._count.marks),
        updatedAt: s.updatedAt,
        overdue: s.status !== 'DRAFT' && s.updatedAt < overdueBefore,
      };
    });

    const batches = await prisma.importBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 20, select: { rowsTotal: true, rowsInvalid: true } });
    const importRows = batches.reduce((n, b) => n + b.rowsTotal, 0);
    const importErrorRate = importRows ? batches.reduce((n, b) => n + b.rowsInvalid, 0) / importRows : 0;

    // ---------- exam readiness ----------
    const sessions = await prisma.examSession.findMany({
      where: { date: { gte: new Date(now.getTime() - 86400e3) } },
      include: { venues: true, _count: { select: { seatAllocations: true } }, offerings: { select: { _count: { select: { enrollments: true } } } } },
      orderBy: { date: 'asc' },
    });
    const exams = sessions.map((s) => {
      const capacity = s.venues.reduce((n, v) => n + capacityOf({ id: v.id, name: v.name, rows: v.rows, cols: v.cols, disabledSeats: (v.disabledSeats as { row: number; col: number }[]) ?? [], adjacencyMode: v.adjacencyMode }), 0);
      const candidates = s.offerings.reduce((n, o) => n + o._count.enrollments, 0);
      // A full room is not a ready exam. Filling every seat and still leaving 315 candidates
      // standing used to read as "Seated" at 100% utilisation, which is the one case somebody has
      // to act on, so the shortfall is reported in its own right.
      const shortfall = Math.max(0, candidates - capacity);
      return {
        id: s.id,
        title: s.title,
        date: s.date,
        startTime: s.startTime,
        candidates,
        capacity,
        shortfall,
        seated: s._count.seatAllocations,
        utilisation: capacity ? Math.round((s._count.seatAllocations / capacity) * 100) : 0,
        ready: candidates > 0 && shortfall === 0 && s._count.seatAllocations >= candidates,
      };
    });

    // ---------- academic: pass rate per module, latest published offering vs previous ----------
    const published = await prisma.markSheet.findMany({
      where: { status: 'PUBLISHED', publishedAt: { lte: now } },
      select: {
        publishedAt: true,
        moduleOffering: { select: { id: true, module: { select: { code: true, title: true } }, semester: { select: { intake: { select: { label: true } } } } } },
        results: { select: { outcome: true, enrollment: { select: { attempt: true } } } },
      },
      orderBy: { publishedAt: 'desc' },
    });
    const perModule = new Map<string, { code: string; title: string; offerings: { intake: string; passRate: number; n: number; resits: number }[] }>();
    for (const s of published) {
      const code = s.moduleOffering.module.code;
      const first = s.results.filter((r) => r.enrollment.attempt === 1);
      const n = first.length;
      const passRate = n ? Math.round((first.filter((r) => r.outcome === 'PASS').length / n) * 100) : 0;
      const resits = s.results.filter((r) => r.enrollment.attempt > 1).length;
      if (!perModule.has(code)) perModule.set(code, { code, title: s.moduleOffering.module.title, offerings: [] });
      perModule.get(code)!.offerings.push({ intake: s.moduleOffering.semester.intake.label, passRate, n, resits });
    }
    const passRates = [...perModule.values()]
      .map((m) => ({ code: m.code, title: m.title, latest: m.offerings[0], previous: m.offerings[1] ?? null, delta: m.offerings[1] ? m.offerings[0].passRate - m.offerings[1].passRate : null }))
      .sort((a, b) => a.latest.passRate - b.latest.passRate);
    const resitVolume = await prisma.enrollment.count({ where: { isResit: true, deletedAt: null } });

    const atRisk = await prisma.student.findMany({
      where: { deletedAt: null, standing: { in: ['REVIEW', 'RESIT'] }, status: 'ACTIVE' },
      select: { id: true, studentId: true, name: true, standing: true, programme: { select: { code: true } }, intake: { select: { label: true } }, currentSemester: { select: { number: true } } },
      orderBy: [{ standing: 'desc' }, { studentId: 'asc' }],
    });

    // ---------- data quality ----------
    const [noSemester, withdrawnActiveLogin, duplicateNames, mismatchedIntake] = await Promise.all([
      prisma.student.findMany({ where: { deletedAt: null, currentSemesterId: null, status: 'ACTIVE' }, select: { id: true, studentId: true, name: true } }),
      prisma.student.count({ where: { deletedAt: null, status: 'WITHDRAWN', user: { isActive: true } } }),
      prisma.$queryRaw<{ name: string; n: number }[]>`SELECT "name", COUNT(*)::int AS n FROM "Student" WHERE "deletedAt" IS NULL GROUP BY "name" HAVING COUNT(*) > 1`,
      prisma.$queryRaw<{ id: string; studentId: string; name: string }[]>`SELECT s."id", s."studentId", s."name" FROM "Student" s JOIN "Intake" i ON i."id" = s."intakeId" WHERE s."deletedAt" IS NULL AND i."programmeId" <> s."programmeId"`,
    ]);
    const missingResults = await prisma.$queryRaw<{ code: string; missing: number }[]>`
      SELECT m."code", COUNT(*)::int AS missing
      FROM "Enrollment" e
      JOIN "ModuleOffering" o ON o."id" = e."moduleOfferingId"
      JOIN "Module" m ON m."id" = o."moduleId"
      JOIN "MarkSheet" ms ON ms."moduleOfferingId" = o."id" AND ms."status" = 'PUBLISHED'
      LEFT JOIN "Result" r ON r."enrollmentId" = e."id" AND r."markSheetId" = ms."id"
      WHERE e."deletedAt" IS NULL AND r."id" IS NULL
      GROUP BY m."code"`;

    // ---------- faculty workload (current semesters: running now, or starting within 3 weeks) ----------
    const soon = new Date(now.getTime() + 21 * 86400e3);
    const load = await prisma.user.findMany({
      where: { role: { in: ['LECTURER', 'MODULE_LEADER'] }, isActive: true },
      select: {
        id: true,
        name: true,
        role: true,
        lecturedOfferings: { where: { semester: { startDate: { lte: soon }, endDate: { gte: now } } }, select: { module: { select: { code: true, credits: true } }, _count: { select: { enrollments: true } } } },
        ledModules: { select: { code: true } },
      },
    });
    const workload = load
      .map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        offerings: u.lecturedOfferings.length,
        students: u.lecturedOfferings.reduce((n, o) => n + o._count.enrollments, 0),
        credits: u.lecturedOfferings.reduce((n, o) => n + o.module.credits, 0),
        modules: u.lecturedOfferings.map((o) => o.module.code),
        leads: u.ledModules.length,
      }))
      .sort((a, b) => b.students - a.students);

    const counts = {
      students: await prisma.student.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      programmes: await prisma.programme.count(),
      modules: await prisma.module.count(),
      openSheets: openSheets.length,
      publishedSheets: funnel.PUBLISHED ?? 0,
    };

    return {
      generatedAt: now,
      counts,
      funnel: { counts: funnel, overdueDays: OVERDUE_DAYS, overdue: overdue.map((o) => ({ id: o.id, status: o.status, module: o.moduleOffering.module.code, cohort: `${o.moduleOffering.semester.intake.label} S${o.moduleOffering.semester.number}`, since: o.updatedAt })) },
      publication,
      importErrorRate: Math.round(importErrorRate * 1000) / 10,
      exams,
      academic: { passRates, resitVolume, atRisk: { count: atRisk.length, review: atRisk.filter((s) => s.standing === 'REVIEW').length, students: atRisk.slice(0, 12) } },
      dataQuality: {
        missingResults,
        studentsWithoutSemester: noSemester,
        withdrawnWithActiveLogin: withdrawnActiveLogin,
        duplicateNames,
        mismatchedIntake,
      },
      workload,
    };
  });
}
