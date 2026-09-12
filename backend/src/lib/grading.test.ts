import { describe, expect, it } from 'vitest';
import { computeGrade, computeOverall, gradeFor, type ComponentSpec, type SchemeSpec } from './grading';

const components: ComponentSpec[] = [
  { id: 'cw', name: 'Coursework', weight: 60, maxMark: 100 },
  { id: 'ex', name: 'Exam', weight: 40, maxMark: 50 },
];
const scheme: SchemeSpec = {
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
const marks = (cw: number | null, ex: number | null, absent: string[] = []) => [
  { componentId: 'cw', rawMark: cw, isAbsent: absent.includes('cw') },
  { componentId: 'ex', rawMark: ex, isAbsent: absent.includes('ex') },
];

describe('computeOverall', () => {
  it('weights marks by component weight and maxMark', () => {
    // 80/100*60 + 25/50*40 = 48 + 20 = 68
    expect(computeOverall(components, marks(80, 25))).toBe(68);
  });
  it('treats absent or missing components as zero', () => {
    expect(computeOverall(components, marks(80, null))).toBe(48);
    expect(computeOverall(components, marks(80, 50, ['ex']))).toBe(48);
  });
  it('rejects weights that do not sum to 100', () => {
    expect(() => computeOverall([{ id: 'x', name: 'X', weight: 90, maxMark: 100 }], [])).toThrow(/sum to 100/);
  });
  it('rejects out-of-range marks', () => {
    expect(() => computeOverall(components, marks(105, 10))).toThrow(/outside/);
    expect(() => computeOverall(components, marks(10, -1))).toThrow(/outside/);
  });
});

describe('gradeFor', () => {
  it('picks the highest band whose minimum is met', () => {
    expect(gradeFor(70, scheme.bands)).toBe('A');
    expect(gradeFor(69.99, scheme.bands)).toBe('B');
    expect(gradeFor(40, scheme.bands)).toBe('D');
    expect(gradeFor(0, scheme.bands)).toBe('F');
  });
});

describe('computeGrade', () => {
  it('passes a first attempt above the pass mark', () => {
    const r = computeGrade({ components, marks: marks(80, 25), scheme, attempt: 1, isResit: false });
    expect(r).toMatchObject({ overallMark: 68, grade: 'B', outcome: 'PASS' });
  });
  it('offers a resit on a first-attempt fail', () => {
    const r = computeGrade({ components, marks: marks(30, 10), scheme, attempt: 1, isResit: false });
    expect(r.overallMark).toBe(26);
    expect(r.outcome).toBe('RESIT');
    expect(r.reasons.join(' ')).toMatch(/below pass mark/);
  });
  it('fails on the final attempt', () => {
    const r = computeGrade({ components, marks: marks(30, 10), scheme, attempt: 3, isResit: true });
    expect(r.outcome).toBe('FAIL');
  });
  it('caps a passed resit at the resit cap', () => {
    const r = computeGrade({ components, marks: marks(90, 45), scheme, attempt: 2, isResit: true });
    expect(r.uncappedMark).toBe(90);
    expect(r.overallMark).toBe(40);
    expect(r.grade).toBe('D');
    expect(r.outcome).toBe('PASS');
  });
  it('does not cap a failed resit', () => {
    const r = computeGrade({ components, marks: marks(20, 10), scheme, attempt: 2, isResit: true });
    expect(r.overallMark).toBe(20);
    expect(r.outcome).toBe('RESIT');
  });
  it('enforces a component minimum even when the overall passes', () => {
    const withMin: ComponentSpec[] = [components[0], { ...components[1], componentPassMark: 20 }];
    const r = computeGrade({ components: withMin, marks: marks(100, 15), scheme, attempt: 1, isResit: false });
    expect(r.uncappedMark).toBe(72);
    expect(r.outcome).toBe('RESIT');
    expect(r.reasons[0]).toMatch(/Exam below component pass mark/);
  });
  it('defers a student absent from everything', () => {
    const r = computeGrade({ components, marks: marks(null, null, ['cw', 'ex']), scheme, attempt: 1, isResit: false });
    expect(r.outcome).toBe('DEFERRED');
    expect(r.overallMark).toBe(0);
  });
  it('is deterministic', () => {
    const a = computeGrade({ components, marks: marks(55, 30), scheme, attempt: 1, isResit: false });
    const b = computeGrade({ components, marks: marks(55, 30), scheme, attempt: 1, isResit: false });
    expect(a).toEqual(b);
  });
});
