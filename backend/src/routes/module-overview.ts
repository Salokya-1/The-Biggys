import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { notFound } from '../lib/errors';
import { allow } from '../plugins/auth';
import { CLASS_KIND_LABEL, type ClassKind } from '../lib/timetable';

const DAY_NAME: Record<number, string> = { 7: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };

/** Lecturers and module leaders only see what they teach or lead; admins see everything. */
function offeringScope(req: FastifyRequest) {
  const u = req.user!;
  if (u.role === 'LECTURER') return { OR: [{ lecturerId: u.id }, { coLecturerId: u.id }] };
  if (u.role === 'MODULE_LEADER') return { OR: [{ lecturerId: u.id }, { coLecturerId: u.id }, { module: { moduleLeaderId: u.id } }] };
  return undefined;
}

const overviewInclude = {
  module: { select: { id: true, code: true, title: true, credits: true, moduleLeader: { select: { name: true } } } },
  semester: { select: { id: true, number: true, term: true, startDate: true, endDate: true, intake: { select: { label: true, programme: { select: { code: true, name: true } } } } } },
  lecturer: { select: { id: true, name: true, email: true } },
  coLecturer: { select: { id: true, name: true, email: true } },
  components: { orderBy: { sortOrder: 'asc' as const } },
  markSheets: { orderBy: { version: 'desc' as const }, select: { id: true, version: true, status: true, publishedAt: true, updatedAt: true } },
  slots: {
    include: { section: { select: { id: true, name: true } }, venue: { select: { name: true } }, teacher: { select: { id: true, name: true } } },
    orderBy: [{ dayOfWeek: 'asc' as const }, { startTime: 'asc' as const }],
  },
  enrollments: {
    where: { deletedAt: null },
    include: {
      student: { select: { id: true, studentId: true, name: true, email: true, status: true, standing: true, section: { select: { id: true, name: true } } } },
      marks: { select: { componentId: true, rawMark: true, isAbsent: true, markSheet: { select: { version: true, status: true } } } },
      results: { orderBy: { markSheetVersion: 'desc' as const }, take: 1, select: { grade: true, outcome: true, overallMark: true, markSheet: { select: { status: true, version: true } } } },
    },
    orderBy: [{ student: { section: { name: 'asc' as const } } }, { student: { studentId: 'asc' as const } }],
  },
};

type Offering = NonNullable<Awaited<ReturnType<typeof loadOffering>>>;

async function loadOffering(req: FastifyRequest, id: string) {
  const scope = offeringScope(req);
  return prisma.moduleOffering.findFirst({ where: { AND: [{ id }, scope ?? {}] }, include: overviewInclude });
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/** Everything the overview and the Excel report both need, computed once. */
function summarise(o: Offering) {
  const rows = o.enrollments.map((e) => {
    const r = e.results[0];
    // A student's mark for a component is the one from the newest sheet that carries it.
    const byComponent = new Map<string, { rawMark: number | null; isAbsent: boolean; version: number }>();
    for (const m of e.marks) {
      const cur = byComponent.get(m.componentId);
      if (!cur || m.markSheet.version > cur.version) byComponent.set(m.componentId, { rawMark: num(m.rawMark), isAbsent: m.isAbsent, version: m.markSheet.version });
    }
    return {
      studentRecordId: e.student.id,
      studentId: e.student.studentId,
      name: e.student.name,
      email: e.student.email,
      section: e.student.section?.name ?? null,
      status: e.student.status,
      standing: e.student.standing,
      attempt: e.attempt,
      isResit: e.isResit,
      marks: Object.fromEntries([...byComponent].map(([k, v]) => [k, { rawMark: v.rawMark, isAbsent: v.isAbsent }])),
      overallMark: r ? num(r.overallMark) : null,
      grade: r?.grade ?? null,
      outcome: r?.outcome ?? null,
      published: r?.markSheet.status === 'PUBLISHED',
    };
  });

  const withResult = rows.filter((r) => r.outcome);
  const marksOnly = withResult.map((r) => r.overallMark).filter((n): n is number => n !== null);
  const count = (o: string) => withResult.filter((r) => r.outcome === o).length;

  const gradeOrder = ['A', 'B', 'C', 'D', 'F'];
  const grades = gradeOrder.map((g) => ({ grade: g, students: withResult.filter((r) => (r.grade ?? '').toUpperCase().startsWith(g)).length }));

  // 10-point bands, the shape a moderation meeting expects to see.
  const bands = Array.from({ length: 10 }, (_, i) => ({
    band: `${i * 10}–${i * 10 + 9}`,
    from: i * 10,
    students: marksOnly.filter((m) => m >= i * 10 && m < i * 10 + 10 + (i === 9 ? 1 : 0)).length,
  }));

  const bySection = [...new Set(rows.map((r) => r.section ?? '—'))].sort().map((name) => {
    const list = rows.filter((r) => (r.section ?? '—') === name);
    const done = list.filter((r) => r.outcome);
    const ms = done.map((r) => r.overallMark).filter((n): n is number => n !== null);
    return {
      section: name,
      students: list.length,
      passed: done.filter((r) => r.outcome === 'PASS').length,
      failed: done.filter((r) => r.outcome === 'FAIL').length,
      resits: done.filter((r) => r.outcome === 'RESIT').length,
      average: mean(ms),
    };
  });

  const components = o.components.map((c) => {
    const vals = rows.map((r) => r.marks[c.id]).filter((m) => m && !m.isAbsent && m.rawMark !== null).map((m) => (m!.rawMark! / c.maxMark) * 100);
    return { id: c.id, name: c.name, weight: c.weight, maxMark: c.maxMark, averagePercent: mean(vals), marked: vals.length, absent: rows.filter((r) => r.marks[c.id]?.isAbsent).length };
  });

  const classes = o.slots.map((s) => ({
    id: s.id,
    kind: s.kind as ClassKind,
    kindLabel: CLASS_KIND_LABEL[s.kind as ClassKind],
    section: s.section.name,
    day: DAY_NAME[s.dayOfWeek] ?? String(s.dayOfWeek),
    dayOfWeek: s.dayOfWeek,
    startTime: s.startTime,
    endTime: s.endTime,
    venue: s.venue?.name ?? null,
    teacher: s.teacher.name,
  }));

  const passed = count('PASS');
  return {
    rows,
    stats: {
      enrolled: rows.length,
      sections: bySection.length,
      resitEnrolments: rows.filter((r) => r.isResit).length,
      withResult: withResult.length,
      awaiting: rows.length - withResult.length,
      passed,
      failed: count('FAIL'),
      resits: count('RESIT'),
      deferred: count('DEFERRED'),
      passRate: withResult.length ? Math.round((passed / withResult.length) * 1000) / 10 : null,
      average: mean(marksOnly),
      highest: marksOnly.length ? Math.max(...marksOnly) : null,
      lowest: marksOnly.length ? Math.min(...marksOnly) : null,
      published: rows.filter((r) => r.published).length,
    },
    grades,
    bands,
    bySection,
    components,
    classes,
    teachers: [o.lecturer, o.coLecturer].filter((t): t is NonNullable<typeof t> => Boolean(t)),
  };
}

/**
 * Module overview: the numbers a module leader is asked for in a board meeting — who is on the
 * module, how the cohort performed, where the marks sit, and which classes run each week — plus
 * the same thing as a workbook, because that is what actually gets emailed around.
 */
export async function moduleOverviewRoutes(app: FastifyInstance) {
  app.get('/offerings/:id/overview', { preHandler: [allow('module.read')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const o = await loadOffering(req, id);
    if (!o) throw notFound('Module offering not found');
    const s = summarise(o);
    return {
      offering: {
        id: o.id,
        module: o.module,
        semester: { number: o.semester.number, term: o.semester.term, startDate: o.semester.startDate, endDate: o.semester.endDate },
        intake: o.semester.intake.label,
        programme: o.semester.intake.programme,
        teachers: s.teachers,
        moduleLeader: o.module.moduleLeader?.name ?? null,
        markSheets: o.markSheets,
      },
      stats: s.stats,
      grades: s.grades,
      bands: s.bands,
      bySection: s.bySection,
      components: s.components,
      classes: s.classes,
      students: s.rows,
    };
  });

  app.get('/offerings/:id/report.xlsx', { preHandler: [allow('module.read')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const o = await loadOffering(req, id);
    if (!o) throw notFound('Module offering not found');
    const s = summarise(o);
    const title = `${o.module.code} ${o.module.title}`;
    const context = `${o.semester.intake.programme.code} ${o.semester.intake.label} · Semester ${o.semester.number}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'RTE Management System';
    wb.created = new Date();

    // --- Summary -------------------------------------------------------------
    const sum = wb.addWorksheet('Summary');
    sum.columns = [{ width: 28 }, { width: 42 }];
    const head = (text: string) => {
      const r = sum.addRow([text, '']);
      r.font = { bold: true, size: 12 };
      return r;
    };
    head(title);
    sum.addRow([context, '']);
    sum.addRow(['Credits', o.module.credits]);
    sum.addRow(['Module leader', o.module.moduleLeader?.name ?? '—']);
    sum.addRow(['Teachers', s.teachers.map((t) => t.name).join(', ') || '—']);
    sum.addRow([]);
    head('Cohort');
    for (const [k, v] of [
      ['Students enrolled', s.stats.enrolled],
      ['Sections', s.stats.sections],
      ['Resit enrolments', s.stats.resitEnrolments],
      ['Results recorded', s.stats.withResult],
      ['Awaiting a result', s.stats.awaiting],
      ['Passed', s.stats.passed],
      ['Failed', s.stats.failed],
      ['Resits', s.stats.resits],
      ['Deferred', s.stats.deferred],
      ['Pass rate (%)', s.stats.passRate ?? '—'],
      ['Average mark', s.stats.average ?? '—'],
      ['Highest', s.stats.highest ?? '—'],
      ['Lowest', s.stats.lowest ?? '—'],
    ] as [string, unknown][]) {
      sum.addRow([k, v]);
    }
    sum.addRow([]);
    head('By section');
    sum.addRow(['Section', 'Students', 'Passed', 'Failed', 'Resits', 'Average']).font = { bold: true };
    for (const b of s.bySection) sum.addRow([b.section, b.students, b.passed, b.failed, b.resits, b.average ?? '—']);
    sum.addRow([]);
    head('Assessment components');
    sum.addRow(['Component', 'Weight %', 'Max mark', 'Average %', 'Marked', 'Absent']).font = { bold: true };
    for (const c of s.components) sum.addRow([c.name, c.weight, c.maxMark, c.averagePercent ?? '—', c.marked, c.absent]);

    // --- Students ------------------------------------------------------------
    const ws = wb.addWorksheet('Students');
    ws.columns = [
      { header: 'Student ID', key: 'sid', width: 14 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Section', key: 'section', width: 10 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Attempt', key: 'attempt', width: 9 },
      ...o.components.map((c) => ({ header: `${c.name} (/${c.maxMark})`, key: c.id, width: 18 })),
      { header: 'Overall', key: 'overall', width: 10 },
      { header: 'Grade', key: 'grade', width: 8 },
      { header: 'Outcome', key: 'outcome', width: 11 },
      { header: 'Published', key: 'published', width: 11 },
    ];
    for (const r of s.rows) {
      const line: Record<string, unknown> = {
        sid: r.studentId,
        name: r.name,
        section: r.section ?? '—',
        email: r.email ?? '',
        status: r.status,
        attempt: r.isResit ? `${r.attempt} (resit)` : r.attempt,
        overall: r.overallMark ?? '',
        grade: r.grade ?? '',
        outcome: r.outcome ?? 'Awaiting',
        published: r.published ? 'Yes' : 'No',
      };
      for (const c of o.components) {
        const m = r.marks[c.id];
        line[c.id] = !m ? '' : m.isAbsent ? 'ABS' : (m.rawMark ?? '');
      }
      ws.addRow(line);
    }
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };

    // --- Marks distribution, with a real chart-friendly table ------------------
    const dist = wb.addWorksheet('Distribution');
    dist.columns = [{ header: 'Band', width: 12 }, { header: 'Students', width: 12 }];
    for (const b of s.bands) dist.addRow([b.band, b.students]);
    dist.addRow([]);
    dist.addRow(['Grade', 'Students']).font = { bold: true };
    for (const g of s.grades) dist.addRow([g.grade, g.students]);
    dist.getRow(1).font = { bold: true };

    // --- Weekly classes -------------------------------------------------------
    const cls = wb.addWorksheet('Classes');
    cls.columns = [
      { header: 'Kind', width: 12 },
      { header: 'Section', width: 10 },
      { header: 'Day', width: 12 },
      { header: 'Start', width: 8 },
      { header: 'End', width: 8 },
      { header: 'Room', width: 12 },
      { header: 'Teacher', width: 24 },
    ];
    for (const c of s.classes) cls.addRow([c.kindLabel, c.section, c.day, c.startTime, c.endTime, c.venue ?? '—', c.teacher]);
    cls.getRow(1).font = { bold: true };

    const buf = await wb.xlsx.writeBuffer();
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition', `attachment; filename="${o.module.code}-${o.semester.intake.label.replace(/\s+/g, '')}-report.xlsx"`);
    return Buffer.from(buf);
  });
}
