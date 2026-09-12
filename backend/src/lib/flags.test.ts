import { describe, expect, it } from 'vitest';
import { computeFlags, type FlagRow } from './flags';

const components = [
  { id: 'cw', name: 'Coursework', maxMark: 100 },
  { id: 'ex', name: 'Exam', maxMark: 100 },
];
const row = (i: number, cw: number | null, ex: number | null, extra: Partial<FlagRow> = {}): FlagRow => ({
  enrollmentId: `e${i}`,
  studentId: `2301${String(i).padStart(4, '0')}`,
  name: `Student ${i}`,
  marks: [
    { componentId: 'cw', rawMark: cw, isAbsent: false },
    { componentId: 'ex', rawMark: ex, isAbsent: false },
  ],
  ...extra,
});

describe('computeFlags', () => {
  it('is quiet on a normal-looking cohort', () => {
    const rows = [row(1, 45, 50), row(2, 62, 58), row(3, 71, 65), row(4, 38, 44), row(5, 55, 60), row(6, 80, 72)];
    expect(computeFlags(components, rows).filter((f) => f.level === 'warning')).toEqual([]);
  });

  it('flags suspiciously uniform marks', () => {
    const rows = [row(1, 60, 50), row(2, 61, 58), row(3, 60, 65), row(4, 60, 44), row(5, 61, 60)];
    const f = computeFlags(components, rows);
    expect(f.some((x) => x.componentId === 'cw' && /uniform/.test(x.message))).toBe(true);
  });

  it('flags identical marks for 30%+ of the cohort', () => {
    const rows = [row(1, 40, 50), row(2, 40, 58), row(3, 40, 65), row(4, 70, 44), row(5, 55, 60), row(6, 80, 72), row(7, 20, 30), row(8, 90, 10)];
    const f = computeFlags(components, rows);
    expect(f.some((x) => /identical mark 40/.test(x.message))).toBe(true);
  });

  it('flags a mean shift of more than 15 points versus the previous offering', () => {
    const rows = [row(1, 70, 50), row(2, 72, 58), row(3, 80, 65), row(4, 65, 44), row(5, 75, 60), row(6, 90, 72)];
    const f = computeFlags(components, rows, { Coursework: { mean: 50, sd: 10, n: 40 } });
    expect(f.some((x) => x.componentId === 'cw' && /up \d+(\.\d+)? points on the previous offering/.test(x.message))).toBe(true);
  });

  it('flags a component far from the student\'s other components', () => {
    const rows = [row(1, 95, 20), row(2, 62, 58), row(3, 71, 65), row(4, 38, 44), row(5, 55, 60)];
    const f = computeFlags(components, rows);
    const rowFlags = f.filter((x) => x.scope === 'row' && x.enrollmentId === 'e1');
    expect(rowFlags.length).toBeGreaterThan(0);
  });

  it('flags a big deviation from the student\'s published average', () => {
    const rows = [row(1, 20, 25, { overallMark: 22, historicalAverage: 68 })];
    const f = computeFlags(components, rows);
    expect(f.some((x) => /below their published average/.test(x.message))).toBe(true);
  });

  it('reports missing marks as info, not warning', () => {
    const rows = [row(1, null, 50), row(2, 62, 58)];
    const f = computeFlags(components, rows);
    expect(f).toContainEqual(expect.objectContaining({ level: 'info', componentId: 'cw' }));
  });
});
