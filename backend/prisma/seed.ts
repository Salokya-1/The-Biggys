/**
 * Demo seed — realistic, fictional, idempotent (truncates and rebuilds).
 *
 *   npm run seed          (or: npx prisma db seed / npm run db:reset)
 *
 * Produces: 2 programmes × 3 intakes (Sep 2024, Sep 2025, Sep 2026), 16 modules,
 * 120 students, two+ semesters of published history, a semester currently in the
 * result pipeline with a sheet in every state, resits, 3 venues, 2 exam sessions,
 * deliberate data-quality issues, notifications and demo accounts.
 * All names and numbers are invented. No real student data.
 */
import 'dotenv/config';
import { PrismaClient, type MarkSheetStatus, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { computeGrade, type ComponentSpec } from '../src/lib/grading';
import { generateSeating } from '../src/lib/seating';

const prisma = new PrismaClient();
export const DEMO_PASSWORD = 'Demo1234!';

// ---------- deterministic PRNG (mulberry32) so every seed run is identical ----------
let seedState = 20260912;
function rand(): number {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const gauss = (mean: number, sd: number) => {
  const u = 1 - rand();
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const FIRST = ['Aarav', 'Anisha', 'Bibek', 'Binita', 'Dipesh', 'Diya', 'Kiran', 'Kritika', 'Manish', 'Nisha', 'Prabin', 'Pratima', 'Rajan', 'Rojina', 'Sagar', 'Samiksha', 'Sandesh', 'Shristi', 'Sujan', 'Sunita', 'Utsav', 'Yashoda', 'Nabin', 'Pooja', 'Rohan', 'Sneha', 'Bishal', 'Aayush', 'Priya', 'Suman'];
const LAST = ['Shrestha', 'Karki', 'Rai', 'Gurung', 'Tamang', 'Thapa', 'Lama', 'Magar', 'Adhikari', 'Basnet', 'Bhattarai', 'Dahal', 'Ghimire', 'Joshi', 'KC', 'Khadka', 'Limbu', 'Maharjan', 'Pandey', 'Poudel', 'Regmi', 'Sharma', 'Subedi', 'Acharya'];

const date = (y: number, m: number, d: number, h = 9) => new Date(Date.UTC(y, m - 1, d, h - 5, 15)); // ~NPT

async function truncateAll() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "Notification", "AuditLog", "SeatAllocation", "ExamSession", "Venue", "ImportBatch",
      "Result", "Mark", "MarkSheet", "RefreshToken", "Enrollment", "AssessmentComponent", "ModuleOffering",
      "Module", "Student", "Semester", "Intake", "Programme", "GradingScheme", "User" CASCADE`);
}

async function main() {
  console.log('seed: truncating');
  await truncateAll();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ---------- users ----------
  const mkUser = (email: string, name: string, role: Role) => prisma.user.create({ data: { email, name, role, passwordHash } });
  const admin = await mkUser('admin@demo', 'Anita Shrestha', 'ADMIN');
  const leaderCS = await mkUser('leader@demo', 'Bikash Rai', 'MODULE_LEADER');
  const leaderCS2 = await mkUser('leader2@demo', 'Prakash Adhikari', 'MODULE_LEADER');
  const leaderBM = await mkUser('leader3@demo', 'Sarita Joshi', 'MODULE_LEADER');
  const lecturer = await mkUser('lecturer@demo', 'Chetna Gurung', 'LECTURER');
  const lecturers = [
    lecturer,
    await mkUser('lecturer2@demo', 'Ramesh Poudel', 'LECTURER'),
    await mkUser('lecturer3@demo', 'Sabina Tamang', 'LECTURER'),
    await mkUser('lecturer4@demo', 'Niraj Bhattarai', 'LECTURER'),
    await mkUser('lecturer5@demo', 'Kabita Regmi', 'LECTURER'),
  ];

  const scheme = await prisma.gradingScheme.create({
    data: {
      name: 'Default (assumed)',
      passMark: 40,
      resitCap: 40,
      isDefault: true,
      bands: [
        { grade: 'A', min: 70 },
        { grade: 'B', min: 60 },
        { grade: 'C', min: 50 },
        { grade: 'D', min: 40 },
        { grade: 'F', min: 0 },
      ],
    },
  });

  // ---------- programmes, intakes, semesters ----------
  const programmes = [
    { code: 'BSCCS', name: 'BSc (Hons) Computing', level: 'Undergraduate', idPrefix: '01' },
    { code: 'BIBM', name: 'BA (Hons) International Business Management', level: 'Undergraduate', idPrefix: '02' },
  ];
  // semester windows by number (academic year runs Sep–Jan, Feb–Jun)
  const semWindow = (startYear: number, n: number) => {
    const yearOffset = Math.floor((n - 1) / 2);
    const y = startYear + yearOffset;
    return n % 2 === 1 ? { start: date(y, 9, 15), end: date(y + 1, 1, 31) } : { start: date(y + 1, 2, 9), end: date(y + 1, 6, 26) };
  };
  // intake → number of semesters that exist so far (current semester is the last one)
  const intakes = [
    { label: 'Sep 2024', year: 2024, semesters: 5, published: 4, inPipeline: null as number | null },
    { label: 'Sep 2025', year: 2025, semesters: 3, published: 1, inPipeline: 2 },
    { label: 'Sep 2026', year: 2026, semesters: 1, published: 0, inPipeline: null },
  ];

  const modulesByProgramme: Record<string, { code: string; title: string; sem: number; leader: string; comps: ComponentSpec[] }[]> = {
    BSCCS: [
      { code: 'CS4001', title: 'Programming Fundamentals', sem: 1, leader: leaderCS.id, comps: cw60ex40() },
      { code: 'CS4002', title: 'Computer Systems', sem: 1, leader: leaderCS.id, comps: cw60ex40() },
      { code: 'CS4003', title: 'Database Systems', sem: 2, leader: leaderCS.id, comps: cw60ex40(35) },
      { code: 'CS4004', title: 'Web Development', sem: 2, leader: leaderCS.id, comps: three() },
      { code: 'CS5001', title: 'Software Engineering', sem: 3, leader: leaderCS2.id, comps: cw60ex40() },
      { code: 'CS5002', title: 'Computer Networks', sem: 3, leader: leaderCS2.id, comps: cw60ex40() },
      { code: 'CS5003', title: 'Artificial Intelligence', sem: 4, leader: leaderCS2.id, comps: three() },
      { code: 'CS5004', title: 'Cyber Security', sem: 4, leader: leaderCS2.id, comps: cw60ex40() },
    ],
    BIBM: [
      { code: 'BM4001', title: 'Principles of Management', sem: 1, leader: leaderBM.id, comps: cw60ex40() },
      { code: 'BM4002', title: 'Business Economics', sem: 1, leader: leaderBM.id, comps: cw60ex40() },
      { code: 'BM4003', title: 'Marketing Essentials', sem: 2, leader: leaderBM.id, comps: three() },
      { code: 'BM4004', title: 'Accounting for Managers', sem: 2, leader: leaderBM.id, comps: cw60ex40(35) },
      { code: 'BM5001', title: 'Organisational Behaviour', sem: 3, leader: leaderBM.id, comps: cw60ex40() },
      { code: 'BM5002', title: 'Operations Management', sem: 3, leader: leaderBM.id, comps: cw60ex40() },
      { code: 'BM5003', title: 'Strategic Management', sem: 4, leader: leaderBM.id, comps: three() },
      { code: 'BM5004', title: 'International Business', sem: 4, leader: leaderBM.id, comps: cw60ex40() },
    ],
  };
  function cw60ex40(examMin?: number): ComponentSpec[] {
    return [
      { id: '', name: 'Coursework', weight: 60, maxMark: 100 },
      { id: '', name: 'Exam', weight: 40, maxMark: 100, componentPassMark: examMin ?? null },
    ];
  }
  function three(): ComponentSpec[] {
    return [
      { id: '', name: 'Coursework 1', weight: 30, maxMark: 100 },
      { id: '', name: 'Coursework 2', weight: 30, maxMark: 100 },
      { id: '', name: 'Exam', weight: 40, maxMark: 50 },
    ];
  }

  // The hero-demo pipeline states for the Sep 2025 intake, semester 2.
  const pipelineState: Record<string, MarkSheetStatus | 'EMPTY_DRAFT'> = {
    CS4003: 'EMPTY_DRAFT', // lecturer@demo imports the CSV live
    CS4004: 'SUBMITTED', // waiting for leader@demo
    BM4003: 'UNDER_REVIEW',
    BM4004: 'APPROVED', // admin publishes live
  };
  // Lecturer assignment: lecturer@demo teaches CS4003 and CS4004 for the Sep 2025 intake, and CS4001 for Sep 2026.
  const lecturerFor = (code: string, intakeLabel: string) => {
    if ((code === 'CS4003' || code === 'CS4004') && intakeLabel === 'Sep 2025') return lecturer.id;
    if (code === 'CS4001' && intakeLabel === 'Sep 2026') return lecturer.id;
    return pick(lecturers.slice(1)).id;
  };

  let studentSeq = 0;
  const demoStudentEmails = ['student1@demo', 'student2@demo', 'student3@demo', 'student4@demo', 'student5@demo'];
  let demoIdx = 0;
  const usedNames = new Set<string>();
  const nextName = () => {
    let n = '';
    do n = `${pick(FIRST)} ${pick(LAST)}`;
    while (usedNames.has(n) && usedNames.size < FIRST.length * LAST.length - 5);
    usedNames.add(n);
    return n;
  };

  const allStudents: { id: string; studentId: string; name: string; userId: string | null; programme: string; intakeLabel: string }[] = [];
  const offeringsAll: { id: string; code: string; sem: number; intakeLabel: string; programme: string; comps: { id: string; name: string; weight: number; maxMark: number; componentPassMark: number | null }[]; moduleId: string; semesterId: string; lecturerId: string }[] = [];
  const auditRows: { actorId: string | null; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; reason?: string | null; createdAt: Date }[] = [];

  for (const p of programmes) {
    const programme = await prisma.programme.create({ data: { code: p.code, name: p.name, level: p.level } });
    const modules = new Map<string, { id: string; sem: number; comps: ComponentSpec[] }>();
    for (const m of modulesByProgramme[p.code]) {
      const mod = await prisma.module.create({ data: { code: m.code, title: m.title, credits: m.comps.length === 3 ? 20 : 15, semesterNumber: m.sem, programmeId: programme.id, moduleLeaderId: m.leader } });
      modules.set(m.code, { id: mod.id, sem: m.sem, comps: m.comps });
    }

    for (const it of intakes) {
      const intake = await prisma.intake.create({ data: { programmeId: programme.id, label: it.label, startDate: date(it.year, 9, 15) } });
      const semesters: { id: string; number: number; end: Date }[] = [];
      for (let n = 1; n <= it.semesters; n++) {
        const w = semWindow(it.year, n);
        const s = await prisma.semester.create({ data: { intakeId: intake.id, number: n, startDate: w.start, endDate: w.end } });
        semesters.push({ id: s.id, number: n, end: w.end });
      }
      const current = semesters[semesters.length - 1];

      // students: 20 per cohort
      const cohort: typeof allStudents = [];
      for (let i = 0; i < 20; i++) {
        studentSeq += 1;
        const name = nextName();
        const studentId = `${String(it.year).slice(2)}${p.idPrefix}${String(i + 1).padStart(4, '0')}`;
        // demo logins: first 5 students of Sep 2025 BSCCS; everyone else gets <id>@student.demo
        let email = `${studentId}@student.demo`;
        if (p.code === 'BSCCS' && it.label === 'Sep 2025' && demoIdx < demoStudentEmails.length) email = demoStudentEmails[demoIdx++];
        const displayName = email === 'student1@demo' ? 'Dipesh Karki' : name;
        const user = await prisma.user.create({ data: { email, name: displayName, role: 'STUDENT', passwordHash } });
        const s = await prisma.student.create({
          data: {
            studentId,
            name: displayName,
            email,
            programmeId: programme.id,
            intakeId: intake.id,
            currentSemesterId: current.id,
            userId: user.id,
            status: 'ACTIVE',
            specialNeedsSeating: rand() < 0.06,
          },
        });
        const rec = { id: s.id, studentId, name: displayName, userId: user.id, programme: p.code, intakeLabel: it.label };
        cohort.push(rec);
        allStudents.push(rec);
      }

      // offerings for every semester so far
      for (const sem of semesters) {
        for (const [code, m] of modules) {
          if (m.sem !== sem.number) continue;
          const lecturerId = lecturerFor(code, it.label);
          const offering = await prisma.moduleOffering.create({
            data: {
              moduleId: m.id,
              semesterId: sem.id,
              lecturerId,
              components: { create: m.comps.map((c, i) => ({ name: c.name, weight: c.weight, maxMark: c.maxMark, componentPassMark: c.componentPassMark ?? null, sortOrder: i })) },
            },
            include: { components: { orderBy: { sortOrder: 'asc' } } },
          });
          offeringsAll.push({ id: offering.id, code, sem: sem.number, intakeLabel: it.label, programme: p.code, comps: offering.components, moduleId: m.id, semesterId: sem.id, lecturerId });

          // enrol the cohort
          const enrollments: { id: string; studentId: string; attempt: number; isResit: boolean }[] = [];
          for (const st of cohort) {
            const e = await prisma.enrollment.create({ data: { studentId: st.id, moduleOfferingId: offering.id, attempt: 1, isResit: false } });
            enrollments.push({ id: e.id, studentId: st.id, attempt: 1, isResit: false });
          }

          // decide the sheet state for this offering
          let state: MarkSheetStatus | 'EMPTY_DRAFT' | 'NONE' = 'NONE';
          if (sem.number <= it.published) state = 'PUBLISHED';
          else if (it.inPipeline === sem.number) state = pipelineState[code] ?? 'DRAFT';
          if (state === 'NONE') continue;

          const specs: ComponentSpec[] = offering.components.map((c) => ({ id: c.id, name: c.name, weight: c.weight, maxMark: c.maxMark, componentPassMark: c.componentPassMark }));
          const sheetTimes = timeline(sem.end, state);
          const sheet = await prisma.markSheet.create({
            data: {
              moduleOfferingId: offering.id,
              status: state === 'EMPTY_DRAFT' ? 'DRAFT' : state,
              version: 1,
              gradingSchemeId: scheme.id,
              submittedById: sheetTimes.submittedAt ? lecturerId : null,
              submittedAt: sheetTimes.submittedAt,
              approvedById: sheetTimes.approvedAt ? modulesByProgramme[p.code].find((x) => x.code === code)!.leader : null,
              approvedAt: sheetTimes.approvedAt,
              publishedById: sheetTimes.publishedAt ? admin.id : null,
              publishedAt: sheetTimes.publishedAt,
              lockVersion: sheetTimes.lock,
              createdAt: sheetTimes.createdAt,
              updatedAt: sheetTimes.updatedAt,
            },
          });
          auditRows.push({ actorId: lecturerId, action: 'marksheet.create', entityType: 'MarkSheet', entityId: sheet.id, after: { version: 1 }, createdAt: sheetTimes.createdAt });
          if (state === 'EMPTY_DRAFT') continue;

          // marks: ability per student (stable across modules via a hash of the id)
          const cohortBias = it.label === 'Sep 2024' && code === 'CS4001' ? 22 : 0; // makes a "mean shift" flag on the next offering
          const rows: { enrollmentId: string; attempt: number; isResit: boolean; marks: { componentId: string; rawMark: number | null; isAbsent: boolean }[] }[] = [];
          for (const e of enrollments) {
            const ability = clamp(gauss(56 + cohortBias, 13), 12, 96);
            const marks = specs.map((c) => {
              if (rand() < 0.02) return { componentId: c.id, rawMark: null, isAbsent: true };
              const pctv = clamp(gauss(ability, 9), 0, 100);
              return { componentId: c.id, rawMark: Math.round((pctv / 100) * c.maxMark * 2) / 2, isAbsent: false };
            });
            rows.push({ enrollmentId: e.id, attempt: e.attempt, isResit: e.isResit, marks });
          }
          // data-quality issue: one published sheet with a student missing a mark (never validated because it was "migrated")
          if (state === 'PUBLISHED' && code === 'BM4002' && it.label === 'Sep 2025') rows[3].marks[1] = { componentId: specs[1].id, rawMark: null, isAbsent: false };

          await prisma.mark.createMany({ data: rows.flatMap((r) => r.marks.map((m) => ({ markSheetId: sheet.id, enrollmentId: r.enrollmentId, componentId: m.componentId, rawMark: m.rawMark, isAbsent: m.isAbsent }))) });
          auditRows.push({ actorId: lecturerId, action: 'import.commit', entityType: 'MarkSheet', entityId: sheet.id, after: { fileName: `${code}-${it.label.replace(' ', '')}.xlsx`, rowsCommitted: rows.length }, createdAt: new Date(sheetTimes.createdAt.getTime() + 3600e3) });

          // results for anything past DRAFT
          if (state !== 'DRAFT') {
            const results = rows
              .filter((r) => r.marks.every((m) => m.isAbsent || m.rawMark !== null))
              .map((r) => {
                const g = computeGrade({ components: specs, marks: r.marks, scheme: { passMark: 40, resitCap: 40, bands: scheme.bands as never }, attempt: r.attempt, isResit: r.isResit });
                return { enrollmentId: r.enrollmentId, markSheetId: sheet.id, markSheetVersion: 1, overallMark: g.overallMark, grade: g.grade, outcome: g.outcome, computedAt: sheetTimes.submittedAt ?? sheetTimes.createdAt };
              });
            await prisma.result.createMany({ data: results });
            if (sheetTimes.submittedAt) auditRows.push({ actorId: lecturerId, action: 'marksheet.submit', entityType: 'MarkSheet', entityId: sheet.id, before: { status: 'DRAFT' }, after: { status: 'SUBMITTED' }, createdAt: sheetTimes.submittedAt });
            if (sheetTimes.reviewAt) auditRows.push({ actorId: modulesByProgramme[p.code].find((x) => x.code === code)!.leader, action: 'marksheet.start_review', entityType: 'MarkSheet', entityId: sheet.id, before: { status: 'SUBMITTED' }, after: { status: 'UNDER_REVIEW' }, createdAt: sheetTimes.reviewAt });
            if (sheetTimes.approvedAt) auditRows.push({ actorId: modulesByProgramme[p.code].find((x) => x.code === code)!.leader, action: 'marksheet.approve', entityType: 'MarkSheet', entityId: sheet.id, before: { status: 'UNDER_REVIEW' }, after: { status: 'APPROVED' }, createdAt: sheetTimes.approvedAt });
            if (sheetTimes.publishedAt) auditRows.push({ actorId: admin.id, action: 'marksheet.publish', entityType: 'MarkSheet', entityId: sheet.id, before: { status: 'APPROVED' }, after: { status: 'PUBLISHED' }, createdAt: sheetTimes.publishedAt });

            // resits: for published sheets, RESIT outcomes get a second attempt, graded and published too
            if (state === 'PUBLISHED') {
              const resitters = results.filter((r) => r.outcome === 'RESIT');
              for (const r of resitters) {
                const orig = enrollments.find((e) => e.id === r.enrollmentId)!;
                const e2 = await prisma.enrollment.create({ data: { studentId: orig.studentId, moduleOfferingId: offering.id, attempt: 2, isResit: true } });
                const passesResit = rand() < 0.7;
                const marks = specs.map((c) => ({ componentId: c.id, rawMark: Math.round(((passesResit ? gauss(52, 6) : gauss(30, 6)) / 100) * c.maxMark * 2) / 2, isAbsent: false }));
                await prisma.mark.createMany({ data: marks.map((m) => ({ markSheetId: sheet.id, enrollmentId: e2.id, componentId: m.componentId, rawMark: clamp(m.rawMark, 0, specs.find((c) => c.id === m.componentId)!.maxMark), isAbsent: false })) });
                const g = computeGrade({ components: specs, marks: marks.map((m) => ({ ...m, rawMark: clamp(m.rawMark, 0, specs.find((c) => c.id === m.componentId)!.maxMark) })), scheme: { passMark: 40, resitCap: 40, bands: scheme.bands as never }, attempt: 2, isResit: true });
                await prisma.result.create({ data: { enrollmentId: e2.id, markSheetId: sheet.id, markSheetVersion: 1, overallMark: g.overallMark, grade: g.grade, outcome: g.outcome, computedAt: sheetTimes.publishedAt ?? new Date() } });
              }
            }
          }
        }
      }
    }
  }

  // ---------- a correction cycle: Sep 2024 CS5004 v1 published → correction requested → v2 draft ----------
  const corr = offeringsAll.find((o) => o.code === 'CS5004' && o.intakeLabel === 'Sep 2024')!;
  const v1 = await prisma.markSheet.findFirst({ where: { moduleOfferingId: corr.id, version: 1 }, include: { marks: true } });
  if (v1) {
    await prisma.markSheet.update({ where: { id: v1.id }, data: { status: 'CORRECTION_REQUESTED', lockVersion: { increment: 1 } } });
    const v2 = await prisma.markSheet.create({ data: { moduleOfferingId: corr.id, version: 2, status: 'DRAFT', gradingSchemeId: scheme.id } });
    await prisma.mark.createMany({ data: v1.marks.map((m) => ({ markSheetId: v2.id, enrollmentId: m.enrollmentId, componentId: m.componentId, rawMark: m.rawMark, isAbsent: m.isAbsent })) });
    auditRows.push({ actorId: admin.id, action: 'marksheet.request_correction', entityType: 'MarkSheet', entityId: v1.id, before: { status: 'PUBLISHED' }, after: { status: 'CORRECTION_REQUESTED' }, reason: 'Coursework mark for 24010007 transposed (57 entered as 75)', createdAt: date(2026, 9, 10, 14) });
    auditRows.push({ actorId: corr.lecturerId, action: 'marksheet.create', entityType: 'MarkSheet', entityId: v2.id, after: { version: 2, copiedFrom: v1.id }, createdAt: date(2026, 9, 10, 15) });
  }

  // ---------- standing from published results ----------
  for (const st of allStudents) {
    const results = await prisma.result.findMany({ where: { enrollment: { studentId: st.id }, markSheet: { status: 'PUBLISHED' } }, select: { outcome: true, enrollmentId: true, enrollment: { select: { moduleOfferingId: true, attempt: true } } } });
    const latestByOffering = new Map<string, { attempt: number; outcome: string }>();
    for (const r of results) {
      const cur = latestByOffering.get(r.enrollment.moduleOfferingId);
      if (!cur || r.enrollment.attempt > cur.attempt) latestByOffering.set(r.enrollment.moduleOfferingId, { attempt: r.enrollment.attempt, outcome: r.outcome });
    }
    const outcomes = [...latestByOffering.values()].map((x) => x.outcome);
    const resits = outcomes.filter((o) => o === 'RESIT').length;
    // Same rule as services/results.ts refreshStanding: any FAIL or 2+ modules outstanding → REVIEW.
    const standing = outcomes.includes('FAIL') || resits >= 2 ? 'REVIEW' : resits === 1 ? 'RESIT' : 'GOOD';
    await prisma.student.update({ where: { id: st.id }, data: { standing } });
  }

  // ---------- deliberate data-quality issues ----------
  const dq = allStudents.filter((s) => s.intakeLabel === 'Sep 2024' && s.programme === 'BIBM');
  await prisma.student.update({ where: { id: dq[0].id }, data: { currentSemesterId: null } }); // no current semester
  await prisma.student.update({ where: { id: dq[1].id }, data: { currentSemesterId: null, status: 'DEFERRED' } });
  const wrongIntake = await prisma.intake.findFirst({ where: { label: 'Sep 2025', programme: { code: 'BSCCS' } } });
  await prisma.student.update({ where: { id: dq[2].id }, data: { intakeId: wrongIntake!.id } }); // intake belongs to another programme
  await prisma.student.update({ where: { id: dq[3].id }, data: { status: 'WITHDRAWN' } });
  await prisma.student.update({ where: { id: dq[4].id }, data: { status: 'WITHDRAWN', deletedAt: date(2026, 3, 1) } });

  // ---------- venues & exam sessions ----------
  const lb101 = await prisma.venue.create({ data: { name: 'LB-101', building: 'London Block', rows: 8, cols: 10, adjacencyMode: 'ROW_AND_COLUMN', disabledSeats: [{ row: 1, col: 10 }, { row: 8, col: 1 }] } });
  const kumari = await prisma.venue.create({ data: { name: 'Kumari Hall', building: 'Main Block', rows: 12, cols: 14, adjacencyMode: 'ROW', disabledSeats: [{ row: 6, col: 7 }, { row: 6, col: 8 }, { row: 12, col: 14 }] } });
  const lab3 = await prisma.venue.create({ data: { name: 'Lab 3', building: 'London Block', rows: 5, cols: 8, adjacencyMode: 'ROW_AND_COLUMN', disabledSeats: [] } });

  const sem2Offerings = offeringsAll.filter((o) => o.intakeLabel === 'Sep 2025' && o.sem === 2);
  const s1Offerings = offeringsAll.filter((o) => o.intakeLabel === 'Sep 2026' && o.sem === 1 && ['CS4001', 'BM4001'].includes(o.code));
  await prisma.examSession.create({
    data: {
      title: 'Semester 2 Resit Exams — Databases & Marketing',
      date: date(2026, 9, 19),
      startTime: '09:00',
      durationMin: 120,
      seed: 7,
      offerings: { connect: sem2Offerings.filter((o) => ['CS4003', 'BM4003'].includes(o.code)).map((o) => ({ id: o.id })) },
      venues: { connect: [{ id: lb101.id }, { id: lab3.id }] },
    },
  });
  const midterm = await prisma.examSession.create({
    data: {
      title: 'Semester 1 Mid-term — Programming & Management (Sep 2026 intake)',
      date: date(2026, 10, 24),
      startTime: '13:00',
      durationMin: 90,
      seed: 3,
      offerings: { connect: s1Offerings.map((o) => ({ id: o.id })) },
      venues: { connect: [{ id: kumari.id }] },
    },
  });
  // The mid-term is already seated (the resit session is left pending for the live demo).
  {
    const enrolments = await prisma.enrollment.findMany({
      where: { moduleOfferingId: { in: s1Offerings.map((o) => o.id) }, deletedAt: null },
      include: { student: { select: { id: true, studentId: true, name: true, specialNeedsSeating: true } }, moduleOffering: { select: { module: { select: { code: true } } } } },
    });
    const seating = generateSeating(
      [{ id: kumari.id, name: kumari.name, rows: kumari.rows, cols: kumari.cols, disabledSeats: kumari.disabledSeats as { row: number; col: number }[], adjacencyMode: kumari.adjacencyMode }],
      enrolments.map((e) => ({ studentId: e.student.id, label: e.student.studentId, name: e.student.name, offeringId: e.moduleOfferingId, moduleCode: e.moduleOffering.module.code, specialNeeds: e.student.specialNeedsSeating })),
      3,
    );
    await prisma.seatAllocation.createMany({
      data: seating.allocations.map((a) => ({ examSessionId: midterm.id, venueId: a.venueId, studentId: a.studentId, moduleOfferingId: a.offeringId, row: a.row, col: a.col, seatLabel: a.seatLabel, runId: 'seed-run-1' })),
    });
    auditRows.push({ actorId: admin.id, action: 'seating.generate', entityType: 'ExamSession', entityId: midterm.id, after: { runId: 'seed-run-1', seed: 3, seated: seating.allocations.length, unseated: seating.unseated.length, violations: seating.violations.length }, createdAt: date(2026, 9, 8, 11) });
  }

  // ---------- audit log + notifications ----------
  await prisma.auditLog.createMany({ data: auditRows.map((a) => ({ ...a, before: a.before as never, after: a.after as never })) });
  const dipesh = allStudents.find((s) => s.name === 'Dipesh Karki')!;
  await prisma.notification.createMany({
    data: [
      { userId: dipesh.userId!, type: 'result.published', title: 'CS4002 result published', body: 'Your Computer Systems result is now available.', payload: { module: 'CS4002' }, createdAt: date(2026, 2, 20), readAt: date(2026, 2, 21) },
      { userId: dipesh.userId!, type: 'result.published', title: 'CS4001 result published', body: 'Your Programming Fundamentals result is now available.', payload: { module: 'CS4001' }, createdAt: date(2026, 2, 20) },
      { userId: leaderCS.id, type: 'marksheet.submitted', title: 'CS4004 marks submitted for review', body: 'Chetna Gurung submitted the CS4004 mark sheet (v1).', payload: { module: 'CS4004' }, createdAt: date(2026, 9, 11, 16) },
      { userId: admin.id, type: 'marksheet.approved', title: 'BM4004 approved — ready to publish', body: 'Sarita Joshi approved the BM4004 mark sheet.', payload: { module: 'BM4004' }, createdAt: date(2026, 9, 11, 17) },
    ],
  });

  const counts = {
    users: await prisma.user.count(),
    students: await prisma.student.count(),
    modules: await prisma.module.count(),
    offerings: await prisma.moduleOffering.count(),
    enrollments: await prisma.enrollment.count(),
    markSheets: await prisma.markSheet.count(),
    marks: await prisma.mark.count(),
    results: await prisma.result.count(),
    venues: await prisma.venue.count(),
    examSessions: await prisma.examSession.count(),
    audit: await prisma.auditLog.count(),
  };
  console.log('seed: done', counts);
  console.log(`demo accounts: admin@demo, leader@demo, lecturer@demo, student1@demo … student5@demo (password ${DEMO_PASSWORD})`);
}

/** Plausible timestamps for a sheet in a given state, relative to the semester end. */
function timeline(semEnd: Date, state: MarkSheetStatus | 'EMPTY_DRAFT') {
  const day = 86400e3;
  const createdAt = new Date(semEnd.getTime() + 3 * day);
  const submittedAt = new Date(semEnd.getTime() + 12 * day);
  const reviewAt = new Date(semEnd.getTime() + 14 * day);
  const approvedAt = new Date(semEnd.getTime() + 16 * day);
  const publishedAt = new Date(semEnd.getTime() + 21 * day);
  const t = { createdAt, submittedAt: null as Date | null, reviewAt: null as Date | null, approvedAt: null as Date | null, publishedAt: null as Date | null, lock: 1, updatedAt: createdAt };
  const order: MarkSheetStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED'];
  const idx = state === 'EMPTY_DRAFT' ? 0 : order.indexOf(state === 'CORRECTION_REQUESTED' ? 'PUBLISHED' : state);
  if (idx >= 1) (t.submittedAt = submittedAt), (t.lock = 2), (t.updatedAt = submittedAt);
  if (idx >= 2) (t.reviewAt = reviewAt), (t.lock = 3), (t.updatedAt = reviewAt);
  if (idx >= 3) (t.approvedAt = approvedAt), (t.lock = 4), (t.updatedAt = approvedAt);
  if (idx >= 4) (t.publishedAt = publishedAt), (t.lock = 5), (t.updatedAt = publishedAt);
  return t;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
