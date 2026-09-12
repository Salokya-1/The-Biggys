import { describe, expect, it } from 'vitest';
import { capacityOf, generateSeating, seatLabel, type SeatStudent, type SeatVenue } from './seating';

const venue = (over: Partial<SeatVenue> = {}): SeatVenue => ({
  id: 'v1',
  name: 'LB-101',
  rows: 5,
  cols: 6,
  disabledSeats: [],
  adjacencyMode: 'ROW_AND_COLUMN',
  ...over,
});
const cohort = (offeringId: string, code: string, n: number, special: number[] = []): SeatStudent[] =>
  Array.from({ length: n }, (_, i) => ({
    studentId: `${offeringId}-${i}`,
    label: `${code}${String(i).padStart(3, '0')}`,
    name: `Student ${code} ${i}`,
    offeringId,
    moduleCode: code,
    specialNeeds: special.includes(i),
  }));

describe('seatLabel', () => {
  it('uses letters for rows and numbers for columns', () => {
    expect(seatLabel(1, 1)).toBe('A1');
    expect(seatLabel(2, 12)).toBe('B12');
    expect(seatLabel(27, 3)).toBe('AA3');
  });
});

describe('generateSeating', () => {
  it('seats one large single-module cohort with no unseated students', () => {
    const r = generateSeating([venue({ rows: 10, cols: 10 })], cohort('m1', 'CS', 95), 1);
    expect(r.allocations).toHaveLength(95);
    expect(r.unseated).toHaveLength(0);
    expect(r.violations).toHaveLength(0);
    expect(new Set(r.allocations.map((a) => a.seatLabel)).size).toBe(95); // unique seats
  });

  it('keeps two unequal modules apart when they share a venue', () => {
    // 5×6 = 30 seats; at most 15 of one module can be mutually non-adjacent
    const students = [...cohort('m1', 'CS', 14), ...cohort('m2', 'BM', 10)];
    const r = generateSeating([venue({ rows: 5, cols: 6 })], students, 3);
    expect(r.unseated).toHaveLength(0);
    expect(r.allocations).toHaveLength(24);
    expect(r.violations).toEqual([]);
  });

  it('reports violations honestly when a module is too big to separate', () => {
    const students = [...cohort('m1', 'CS', 20), ...cohort('m2', 'BM', 10)];
    const r = generateSeating([venue({ rows: 5, cols: 6 })], students, 3);
    expect(r.unseated).toHaveLength(0); // capacity wins
    expect(r.allocations).toHaveLength(30);
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.venues[0].violations).toBe(r.violations.length);
  });

  it('never uses disabled seats', () => {
    const v = venue({ rows: 3, cols: 4, disabledSeats: [{ row: 1, col: 1 }, { row: 3, col: 4 }] });
    expect(capacityOf(v)).toBe(10);
    const r = generateSeating([v], cohort('m1', 'CS', 10), 1);
    expect(r.allocations).toHaveLength(10);
    expect(r.allocations.some((a) => (a.row === 1 && a.col === 1) || (a.row === 3 && a.col === 4))).toBe(false);
  });

  it('returns an explicit unseated list when capacity is insufficient', () => {
    const r = generateSeating([venue({ rows: 2, cols: 5 })], [...cohort('m1', 'CS', 8), ...cohort('m2', 'BM', 6)], 1);
    expect(r.allocations).toHaveLength(10);
    expect(r.unseated).toHaveLength(4);
    expect(r.venues[0].used).toBe(10);
  });

  it('places special-needs students in the front row or on an aisle', () => {
    const students = [...cohort('m1', 'CS', 20, [4, 9]), ...cohort('m2', 'BM', 8, [2])];
    const v = venue({ rows: 5, cols: 6 });
    const r = generateSeating([v], students, 5);
    for (const s of students.filter((x) => x.specialNeeds)) {
      const a = r.allocations.find((x) => x.studentId === s.studentId)!;
      expect(a).toBeDefined();
      expect(a.row === 1 || a.col === 1 || a.col === v.cols).toBe(true);
    }
  });

  it('spreads modules across multiple venues, largest first, without violations', () => {
    const venues = [venue({ id: 'small', name: 'Lab 3', rows: 3, cols: 4 }), venue({ id: 'big', name: 'Kumari', rows: 6, cols: 8, adjacencyMode: 'ROW' })];
    const students = [...cohort('m1', 'CS', 30), ...cohort('m2', 'BM', 22)];
    const r = generateSeating(venues, students, 11);
    expect(r.unseated).toHaveLength(0);
    expect(r.venues[0].name).toBe('Kumari');
    // ROW mode 6×8 = 48 seats: at most 24 of one module can be kept apart, so 24 CS + 22 BM here, 6 CS in the lab
    expect(r.venues[0].used).toBe(46);
    expect(r.venues[0].byOffering).toEqual({ m1: 24, m2: 22 });
    expect(r.venues[1].used).toBe(6);
    expect(r.allocations).toHaveLength(52);
    expect(r.violations).toEqual([]);
  });

  it('is deterministic for a seed and changes with the seed', () => {
    const students = [...cohort('m1', 'CS', 15), ...cohort('m2', 'BM', 12)];
    const a = generateSeating([venue()], students, 42);
    const b = generateSeating([venue()], students, 42);
    const c = generateSeating([venue()], students, 43);
    expect(a).toEqual(b);
    expect(a.allocations.map((x) => x.studentId).join()).not.toBe(c.allocations.map((x) => x.studentId).join());
  });
});
