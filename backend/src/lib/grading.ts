/**
 * Grade calculation — a pure, deterministic function of marks + scheme.
 * No database access here so it can be unit-tested with fixtures.
 */

export interface ComponentSpec {
  id: string;
  name: string;
  weight: number; // percentage, all components sum to 100
  maxMark: number;
  componentPassMark?: number | null; // optional minimum on this component
}

export interface ComponentMark {
  componentId: string;
  rawMark: number | null;
  isAbsent: boolean;
}

export interface GradeBand {
  grade: string;
  min: number;
}

export interface SchemeSpec {
  passMark: number; // overall pass threshold (default 40 — assumption)
  resitCap: number; // max overall mark awarded on a resit attempt (default 40 — assumption)
  bands: GradeBand[];
}

export type Outcome = 'PASS' | 'FAIL' | 'RESIT' | 'DEFERRED';

export interface GradeResult {
  overallMark: number; // after resit cap, rounded to 2 dp
  uncappedMark: number;
  grade: string;
  outcome: Outcome;
  reasons: string[]; // plain-English explanation, shown to reviewers
}

const MAX_ATTEMPTS = 3;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function assertWeightsSumTo100(components: ComponentSpec[]): void {
  const total = components.reduce((s, c) => s + c.weight, 0);
  if (total !== 100) throw new Error(`Component weights must sum to 100 (got ${total})`);
}

/** Weighted overall: Σ(rawMark / maxMark × weight). Absent or missing components score 0. */
export function computeOverall(components: ComponentSpec[], marks: ComponentMark[]): number {
  assertWeightsSumTo100(components);
  const byId = new Map(marks.map((m) => [m.componentId, m]));
  let overall = 0;
  for (const c of components) {
    const m = byId.get(c.id);
    if (!m || m.isAbsent || m.rawMark === null) continue;
    if (m.rawMark < 0 || m.rawMark > c.maxMark) {
      throw new Error(`Mark ${m.rawMark} for ${c.name} is outside 0–${c.maxMark}`);
    }
    overall += (m.rawMark / c.maxMark) * c.weight;
  }
  return round2(overall);
}

export function gradeFor(mark: number, bands: GradeBand[]): string {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  for (const b of sorted) if (mark >= b.min) return b.grade;
  return sorted[sorted.length - 1]?.grade ?? 'F';
}

export interface GradeInput {
  components: ComponentSpec[];
  marks: ComponentMark[];
  scheme: SchemeSpec;
  attempt: number; // 1, 2 or 3
  isResit: boolean;
}

export function computeGrade(input: GradeInput): GradeResult {
  const { components, marks, scheme, attempt, isResit } = input;
  const reasons: string[] = [];
  const byId = new Map(marks.map((m) => [m.componentId, m]));

  const allAbsent = components.every((c) => {
    const m = byId.get(c.id);
    return !m || m.isAbsent;
  });
  if (allAbsent) {
    return { overallMark: 0, uncappedMark: 0, grade: gradeFor(0, scheme.bands), outcome: 'DEFERRED', reasons: ['Absent from every component'] };
  }

  const uncapped = computeOverall(components, marks);

  // Component minimums (e.g. "must score 35% in the exam").
  const failedComponents = components.filter((c) => {
    if (c.componentPassMark == null) return false;
    const m = byId.get(c.id);
    const raw = !m || m.isAbsent || m.rawMark === null ? 0 : m.rawMark;
    return raw < c.componentPassMark;
  });
  for (const c of failedComponents) reasons.push(`${c.name} below component pass mark ${c.componentPassMark}/${c.maxMark}`);

  const passedOverall = uncapped >= scheme.passMark;
  if (!passedOverall) reasons.push(`Overall ${uncapped} below pass mark ${scheme.passMark}`);

  const passed = passedOverall && failedComponents.length === 0;
  let overall = uncapped;
  if (passed && isResit && overall > scheme.resitCap) {
    overall = scheme.resitCap;
    reasons.push(`Resit attempt: mark capped at ${scheme.resitCap}`);
  }

  let outcome: Outcome;
  if (passed) outcome = 'PASS';
  else if (attempt < MAX_ATTEMPTS) {
    outcome = 'RESIT';
    reasons.push(`Attempt ${attempt} of ${MAX_ATTEMPTS}: resit offered`);
  } else {
    outcome = 'FAIL';
    reasons.push(`Final attempt (${MAX_ATTEMPTS}) used: fail`);
  }

  return { overallMark: round2(overall), uncappedMark: uncapped, grade: gradeFor(overall, scheme.bands), outcome, reasons };
}
