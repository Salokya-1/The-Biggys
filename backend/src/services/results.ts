import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { computeGrade, type ComponentSpec, type GradeResult, type SchemeSpec } from '../lib/grading';
import { computeFlags, componentStats, type Flag, type FlagRow, type PreviousStats } from '../lib/flags';
import { notFound } from '../lib/errors';

type Db = PrismaClient | Prisma.TransactionClient;

export const DEFAULT_SCHEME: SchemeSpec = {
  passMark: 40,
  resitCap: 40,
  bands: [
    { grade: 'A', min: 70 },
    { grade: 'B', min: 60 },
    { grade: 'C', min: 50 },
    { grade: 'D', min: 40 },
    { grade: 'F', min: 0 },
  ],
};

const sheetInclude = {
  gradingScheme: true,
  submittedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  publishedBy: { select: { id: true, name: true } },
  moduleOffering: {
    include: {
      module: { select: { id: true, code: true, title: true, credits: true, moduleLeaderId: true, programmeId: true } },
      semester: { select: { id: true, number: true, intake: { select: { id: true, label: true } } } },
      lecturer: { select: { id: true, name: true } },
      components: { orderBy: { sortOrder: 'asc' as const } },
      enrollments: {
        where: { deletedAt: null },
        include: { student: { select: { id: true, studentId: true, name: true, userId: true } } },
        orderBy: { student: { studentId: 'asc' as const } },
      },
    },
  },
  marks: true,
  results: true,
} satisfies Prisma.MarkSheetInclude;

export type SheetContext = Prisma.MarkSheetGetPayload<{ include: typeof sheetInclude }>;

export async function loadSheet(db: Db, id: string): Promise<SheetContext> {
  const sheet = await db.markSheet.findUnique({ where: { id }, include: sheetInclude });
  if (!sheet) throw notFound('Mark sheet not found');
  return sheet;
}

export function schemeOf(sheet: SheetContext): SchemeSpec {
  const s = sheet.gradingScheme;
  if (!s) return DEFAULT_SCHEME;
  return { passMark: s.passMark, resitCap: s.resitCap, bands: s.bands as unknown as SchemeSpec['bands'] };
}

export function componentSpecs(sheet: SheetContext): ComponentSpec[] {
  return sheet.moduleOffering.components.map((c) => ({
    id: c.id,
    name: c.name,
    weight: c.weight,
    maxMark: c.maxMark,
    componentPassMark: c.componentPassMark,
  }));
}

export interface SheetRow {
  enrollmentId: string;
  student: { id: string; studentId: string; name: string };
  attempt: number;
  isResit: boolean;
  marks: Record<string, { rawMark: number | null; isAbsent: boolean; note: string | null }>;
  complete: boolean; // every component has a mark or is absent
  computed: GradeResult | null; // live grade preview (null until at least one mark exists)
  stored: { overallMark: number; grade: string; outcome: string; computedAt: Date } | null;
}

export function buildRows(sheet: SheetContext): SheetRow[] {
  const specs = componentSpecs(sheet);
  const scheme = schemeOf(sheet);
  const marksByEnrollment = new Map<string, typeof sheet.marks>();
  for (const m of sheet.marks) {
    if (!marksByEnrollment.has(m.enrollmentId)) marksByEnrollment.set(m.enrollmentId, []);
    marksByEnrollment.get(m.enrollmentId)!.push(m);
  }
  const resultsByEnrollment = new Map(sheet.results.map((r) => [r.enrollmentId, r]));

  return sheet.moduleOffering.enrollments.map((e) => {
    const marks: SheetRow['marks'] = {};
    for (const c of specs) {
      const m = marksByEnrollment.get(e.id)?.find((x) => x.componentId === c.id);
      marks[c.id] = { rawMark: m?.rawMark == null ? null : Number(m.rawMark), isAbsent: m?.isAbsent ?? false, note: m?.note ?? null };
    }
    const complete = specs.every((c) => marks[c.id].isAbsent || marks[c.id].rawMark !== null);
    const anyMark = specs.some((c) => marks[c.id].isAbsent || marks[c.id].rawMark !== null);
    let computed: GradeResult | null = null;
    if (anyMark) {
      try {
        computed = computeGrade({
          components: specs,
          marks: specs.map((c) => ({ componentId: c.id, rawMark: marks[c.id].rawMark, isAbsent: marks[c.id].isAbsent })),
          scheme,
          attempt: e.attempt,
          isResit: e.isResit,
        });
      } catch {
        computed = null;
      }
    }
    const r = resultsByEnrollment.get(e.id);
    return {
      enrollmentId: e.id,
      student: { id: e.student.id, studentId: e.student.studentId, name: e.student.name },
      attempt: e.attempt,
      isResit: e.isResit,
      marks,
      complete,
      computed,
      stored: r ? { overallMark: Number(r.overallMark), grade: r.grade, outcome: r.outcome, computedAt: r.computedAt } : null,
    };
  });
}

/** Pre-submit checks. Errors block submission; warnings do not. */
export function validateForSubmit(sheet: SheetContext, rows: SheetRow[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const specs = componentSpecs(sheet);
  const totalWeight = specs.reduce((s, c) => s + c.weight, 0);
  if (specs.length === 0) errors.push('No assessment components are configured for this offering');
  else if (totalWeight !== 100) errors.push(`Component weights sum to ${totalWeight}, not 100`);
  if (rows.length === 0) errors.push('No students are enrolled on this offering');

  for (const r of rows) {
    for (const c of specs) {
      const m = r.marks[c.id];
      if (!m.isAbsent && m.rawMark === null) errors.push(`${r.student.studentId} ${r.student.name}: ${c.name} has no mark and is not marked absent`);
      else if (m.rawMark !== null && (m.rawMark < 0 || m.rawMark > c.maxMark)) errors.push(`${r.student.studentId}: ${c.name} mark ${m.rawMark} is outside 0–${c.maxMark}`);
    }
    if (specs.every((c) => r.marks[c.id].isAbsent)) warnings.push(`${r.student.studentId} ${r.student.name}: absent from every component (will be DEFERRED)`);
  }
  return { errors, warnings };
}

/** Mean/σ of each component (as % of max) on the most recent PUBLISHED sheet of the same module. */
export async function previousOfferingStats(db: Db, sheet: SheetContext): Promise<PreviousStats | undefined> {
  const prev = await db.markSheet.findFirst({
    where: {
      status: 'PUBLISHED',
      moduleOffering: { moduleId: sheet.moduleOffering.module.id, id: { not: sheet.moduleOfferingId } },
    },
    orderBy: { publishedAt: 'desc' },
    include: { marks: true, moduleOffering: { include: { components: true } } },
  });
  if (!prev) return undefined;
  const out: PreviousStats = {};
  for (const c of prev.moduleOffering.components) {
    const values = prev.marks.filter((m) => m.componentId === c.id && !m.isAbsent && m.rawMark !== null).map((m) => (Number(m.rawMark) / c.maxMark) * 100);
    if (values.length === 0) continue;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    out[c.name] = { mean: Math.round(mean * 10) / 10, sd: Math.round(sd * 10) / 10, n: values.length };
  }
  return out;
}

/** Each student's average overall mark across their PUBLISHED results (excluding this sheet). */
export async function historicalAverages(db: Db, sheet: SheetContext): Promise<Map<string, number>> {
  const studentIds = sheet.moduleOffering.enrollments.map((e) => e.studentId);
  const results = await db.result.findMany({
    where: { markSheetId: { not: sheet.id }, markSheet: { status: 'PUBLISHED' }, enrollment: { studentId: { in: studentIds } } },
    select: { overallMark: true, enrollment: { select: { studentId: true } } },
  });
  const acc = new Map<string, { sum: number; n: number }>();
  for (const r of results) {
    const a = acc.get(r.enrollment.studentId) ?? { sum: 0, n: 0 };
    a.sum += Number(r.overallMark);
    a.n += 1;
    acc.set(r.enrollment.studentId, a);
  }
  return new Map([...acc.entries()].map(([k, v]) => [k, v.sum / v.n]));
}

export async function flagsFor(db: Db, sheet: SheetContext, rows: SheetRow[]): Promise<{ flags: Flag[]; stats: ReturnType<typeof componentStats> }> {
  const specs = componentSpecs(sheet).map((c) => ({ id: c.id, name: c.name, maxMark: c.maxMark }));
  const [prev, hist] = await Promise.all([previousOfferingStats(db, sheet), historicalAverages(db, sheet)]);
  const flagRows: FlagRow[] = rows.map((r) => ({
    enrollmentId: r.enrollmentId,
    studentId: r.student.studentId,
    name: r.student.name,
    marks: specs.map((c) => ({ componentId: c.id, rawMark: r.marks[c.id].rawMark, isAbsent: r.marks[c.id].isAbsent })),
    overallMark: r.computed?.overallMark,
    historicalAverage: hist.get(r.student.id) ?? null,
  }));
  return { flags: computeFlags(specs, flagRows, prev), stats: componentStats(specs, flagRows) };
}

/** Replace the stored Result snapshot for this sheet version (rows are immutable once written; we delete+insert). */
export async function storeResults(tx: Db, sheet: SheetContext, rows: SheetRow[]) {
  await tx.result.deleteMany({ where: { markSheetId: sheet.id } });
  const data = rows
    .filter((r) => r.computed)
    .map((r) => ({
      enrollmentId: r.enrollmentId,
      markSheetId: sheet.id,
      markSheetVersion: sheet.version,
      overallMark: r.computed!.overallMark,
      grade: r.computed!.grade,
      outcome: r.computed!.outcome,
    }));
  if (data.length) await tx.result.createMany({ data });
  return data.length;
}

/**
 * Standing rule (assumption, configurable later): latest published outcome per module offering;
 * any FAIL or RESIT outstanding on 2+ modules → REVIEW; one RESIT → RESIT; else GOOD.
 */
export async function refreshStanding(tx: Db, studentIds: string[]) {
  for (const studentId of studentIds) {
    const results = await tx.result.findMany({
      where: { enrollment: { studentId }, markSheet: { status: 'PUBLISHED' } },
      select: { outcome: true, markSheetVersion: true, enrollment: { select: { moduleOfferingId: true, attempt: true } } },
      orderBy: [{ enrollment: { attempt: 'desc' } }, { markSheetVersion: 'desc' }],
    });
    const latest = new Map<string, string>();
    for (const r of results) if (!latest.has(r.enrollment.moduleOfferingId)) latest.set(r.enrollment.moduleOfferingId, r.outcome);
    const outcomes = [...latest.values()];
    const resits = outcomes.filter((o) => o === 'RESIT').length;
    const standing = outcomes.includes('FAIL') || resits >= 2 ? 'REVIEW' : resits === 1 ? 'RESIT' : 'GOOD';
    await tx.student.update({ where: { id: studentId }, data: { standing } });
  }
}

export { prisma };
