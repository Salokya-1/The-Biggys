import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { parse } from '../lib/validation';
import { badRequest } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow } from '../plugins/auth';
import { examSlots, generateExamSchedule } from '../lib/exam-schedule';
import { capacityOf } from '../lib/seating';
import { notifyUsers } from '../lib/notify';

const week = 7 * 86400e3;

/** Students whose latest published outcome on an offering of the academic year is RESIT and who have no later attempt. */
async function retakeCandidates(startYear: number) {
  const from = new Date(Date.UTC(startYear, 8, 1));
  const to = new Date(Date.UTC(startYear + 1, 7, 31));
  const results = await prisma.result.findMany({
    where: { markSheet: { status: 'PUBLISHED', moduleOffering: { semester: { term: { not: 'SUMMER' }, startDate: { gte: from, lte: to } } } } },
    include: { enrollment: { include: { student: { select: { id: true, studentId: true, name: true, intakeId: true, userId: true, deletedAt: true } }, moduleOffering: { include: { module: { select: { id: true, code: true, title: true } }, semester: { select: { intakeId: true, number: true } }, components: true } } } } },
    orderBy: [{ enrollment: { attempt: 'desc' } }, { markSheetVersion: 'desc' }],
  });
  const latest = new Map<string, (typeof results)[number]>();
  for (const r of results) {
    const k = `${r.enrollment.studentId}:${r.enrollment.moduleOfferingId}`;
    if (!latest.has(k)) latest.set(k, r);
  }
  return [...latest.values()].filter((r) => r.outcome === 'RESIT' && !r.enrollment.student.deletedAt && r.enrollment.attempt < 3);
}

/** Summer retake generation: summer semester per intake, offerings for failed modules, resit enrolments, resit exams. */
export async function retakeRoutes(app: FastifyInstance) {
  app.get('/retakes', { preHandler: [allow('module.read')] }, async (req) => {
    const { year } = parse(z.object({ year: z.coerce.number().int().min(2020).max(2100).default(new Date().getUTCFullYear() - (new Date().getUTCMonth() < 8 ? 1 : 0)) }), req.query);
    const candidates = await retakeCandidates(year);
    const byModule = new Map<string, { code: string; title: string; students: { studentId: string; name: string; attempt: number }[] }>();
    for (const c of candidates) {
      const m = c.enrollment.moduleOffering.module;
      if (!byModule.has(m.id)) byModule.set(m.id, { code: m.code, title: m.title, students: [] });
      byModule.get(m.id)!.students.push({ studentId: c.enrollment.student.studentId, name: c.enrollment.student.name, attempt: c.enrollment.attempt + 1 });
    }
    const summers = await prisma.semester.findMany({
      where: { term: 'SUMMER', startDate: { gte: new Date(Date.UTC(year + 1, 0, 1)), lte: new Date(Date.UTC(year + 1, 11, 31)) } },
      include: { intake: { select: { label: true, programme: { select: { code: true } } } }, offerings: { include: { module: { select: { code: true, title: true } }, _count: { select: { enrollments: true } } } }, examSessions: { select: { id: true, title: true, date: true, startTime: true } } },
    });
    return { year, candidates: [...byModule.values()].sort((a, b) => a.code.localeCompare(b.code)), totalStudents: new Set(candidates.map((c) => c.enrollment.studentId)).size, summers };
  });

  app.post('/retakes/generate', { preHandler: [allow('seating.generate')] }, async (req) => {
    const { year } = parse(z.object({ year: z.number().int().min(2020).max(2100) }), req.body);
    const candidates = await retakeCandidates(year);
    if (candidates.length === 0) throw badRequest('No students with outstanding resits for that academic year');

    // group by intake → module
    const byIntake = new Map<string, Map<string, typeof candidates>>();
    for (const c of candidates) {
      const ik = c.enrollment.student.intakeId;
      const mk = c.enrollment.moduleOffering.module.id;
      if (!byIntake.has(ik)) byIntake.set(ik, new Map());
      const m = byIntake.get(ik)!;
      if (!m.has(mk)) m.set(mk, []);
      m.get(mk)!.push(c);
    }
    const summerStart = new Date(Date.UTC(year + 1, 6, 6)); // first Monday-ish of July
    const examStart = new Date(summerStart.getTime() + 6 * week);
    const examEnd = new Date(examStart.getTime() + 2 * week);
    const venues = await prisma.venue.findMany();
    const teachers = await prisma.user.findMany({ where: { role: { in: ['LECTURER', 'MODULE_LEADER'] }, isActive: true }, select: { id: true, name: true } });

    const summary: { intake: string; semesterId: string; offerings: number; enrolments: number; exams: number; unscheduled: number }[] = [];
    for (const [intakeId, modules] of byIntake) {
      const intake = await prisma.intake.findUnique({ where: { id: intakeId }, include: { semesters: { orderBy: { number: 'desc' }, take: 1 }, programme: { select: { code: true } } } });
      if (!intake) continue;
      let summer = await prisma.semester.findFirst({ where: { intakeId, term: 'SUMMER', startDate: summerStart } });
      if (!summer) {
        summer = await prisma.semester.create({ data: { intakeId, number: (intake.semesters[0]?.number ?? 0) + 1, term: 'SUMMER', startDate: summerStart, endDate: examEnd, teachingWeeks: 6, examStart, examEnd } });
      }
      let enrolments = 0;
      const offeringRows: { id: string; code: string; candidates: number; teacherId: string | null }[] = [];
      for (const [moduleId, rows] of modules) {
        const source = rows[0].enrollment.moduleOffering;
        let offering = await prisma.moduleOffering.findUnique({ where: { moduleId_semesterId: { moduleId, semesterId: summer.id } } });
        if (!offering) {
          offering = await prisma.moduleOffering.create({
            data: { moduleId, semesterId: summer.id, lecturerId: source.lecturerId, components: { create: source.components.map((c) => ({ name: c.name, weight: c.weight, maxMark: c.maxMark, componentPassMark: c.componentPassMark, sortOrder: c.sortOrder })) } },
          });
        }
        for (const r of rows) {
          const exists = await prisma.enrollment.findFirst({ where: { studentId: r.enrollment.studentId, moduleOfferingId: offering.id } });
          if (exists) continue;
          await prisma.enrollment.create({ data: { studentId: r.enrollment.studentId, moduleOfferingId: offering.id, attempt: r.enrollment.attempt + 1, isResit: true } });
          enrolments++;
        }
        const n = await prisma.enrollment.count({ where: { moduleOfferingId: offering.id, deletedAt: null } });
        offeringRows.push({ id: offering.id, code: source.module.code, candidates: n, teacherId: source.lecturerId });
      }
      // resit exams in the summer exam window
      const existing = await prisma.examSession.count({ where: { semesterId: summer.id, kind: 'RESIT' } });
      let exams = 0;
      let unscheduled = 0;
      if (existing === 0) {
        const sched = generateExamSchedule(
          offeringRows.map((o) => ({ ...o, semesterId: summer!.id })),
          venues.map((v) => ({ id: v.id, name: v.name, capacity: capacityOf({ id: v.id, name: v.name, rows: v.rows, cols: v.cols, disabledSeats: (v.disabledSeats as { row: number; col: number }[]) ?? [], adjacencyMode: v.adjacencyMode }), examHall: !v.isClassroom })),
          teachers,
          examSlots(examStart, examEnd),
        );
        for (const s of sched.sessions) {
          const off = offeringRows.find((o) => o.id === s.offeringIds[0])!;
          await prisma.examSession.create({
            data: { title: `Summer resit — ${off.code} (${intake.programme.code} ${intake.label})`, kind: 'RESIT', seatingMode: 'MIXED', semesterId: summer.id, date: s.date, startTime: s.startTime, durationMin: s.durationMin, generatedBy: 'manual', offerings: { connect: [{ id: off.id }] }, venues: { connect: s.venueIds.map((id) => ({ id })) }, invigilators: { create: s.invigilators.map((i) => ({ venueId: i.venueId, userId: i.userId })) } },
          });
          exams++;
        }
        unscheduled = sched.unscheduled.length;
      }
      const studentUsers = [...new Set([...modules.values()].flat().map((r) => r.enrollment.student.userId).filter((x): x is string => !!x))];
      await notifyUsers(prisma, studentUsers, { type: 'retake.enrolled', title: 'Summer retake enrolment', body: `You have been enrolled on summer retakes (${summerStart.toISOString().slice(0, 10)} – ${examEnd.toISOString().slice(0, 10)}). Check your results and exam seats.`, payload: { semesterId: summer.id } });
      summary.push({ intake: `${intake.programme.code} ${intake.label}`, semesterId: summer.id, offerings: offeringRows.length, enrolments, exams, unscheduled });
    }
    await audit(prisma, { ...actorOf(req), action: 'retakes.generate', entityType: 'AcademicYear', entityId: String(year), after: summary });
    return { year, summerStart, examStart, examEnd, intakes: summary };
  });
}
