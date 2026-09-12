import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_GAP_MIN,
  EARLY_PERIODS,
  STANDARD_PERIODS,
  breaksGapRule,
  findClashes,
  findGapViolations,
  generateTimetable,
  periodsForSemester,
  slotDate,
  suggestSlots,
  toMinutes,
  weekOf,
} from './timetable';

const sections = (n: number, extra: Partial<{ latestEnd: string; periods: typeof STANDARD_PERIODS }> = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: String.fromCharCode(65 + i), size: 24, ...extra }));
const rooms = (n: number, cap = 30) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `LB-${101 + i}`, capacity: cap }));
const withIds = <T,>(slots: T[]) => slots.map((s, i) => ({ ...s, id: `slot${i}` }));

describe('generateTimetable', () => {
  it('places 10 sections × 2 modules × 2 sessions with no clashes', () => {
    const offerings = [
      { id: 'o1', code: 'CS4001', teacherId: 't1' },
      { id: 'o2', code: 'CC4051', teacherId: 't2' },
    ];
    const r = generateTimetable(sections(10), offerings, rooms(6));
    expect(r.unplaced).toEqual([]);
    expect(r.slots).toHaveLength(40);
    expect(findClashes(withIds(r.slots))).toEqual([]);
    expect(r.slots.filter((s) => s.teacherId === 't1')).toHaveLength(20);
  });

  it('never leaves a section a gap longer than two hours', () => {
    const offerings = Array.from({ length: 4 }, (_, i) => ({ id: `o${i}`, code: `M${i}`, teacherId: `t${i}` }));
    const r = generateTimetable(sections(4), offerings, rooms(5));
    expect(r.unplaced).toEqual([]);
    expect(r.gapViolations).toEqual([]);
    expect(findGapViolations(r.slots)).toEqual([]);
  });

  it('finishes final-year groups by 10:00', () => {
    const finalYear = sections(2, { latestEnd: '10:00', periods: EARLY_PERIODS });
    const offerings = Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, code: `M${i}`, teacherId: `t${i}` }));
    const r = generateTimetable(finalYear, offerings, rooms(4));
    expect(r.unplaced).toEqual([]);
    expect(r.slots).toHaveLength(20);
    expect(r.slots.every((s) => toMinutes(s.endTime) <= toMinutes('10:00'))).toBe(true);
    expect(r.gapViolations).toEqual([]);
  });

  it('picks the early grid for semesters 5 and 6 only', () => {
    expect(periodsForSemester(1)).toBe(STANDARD_PERIODS);
    expect(periodsForSemester(4)).toBe(STANDARD_PERIODS);
    expect(periodsForSemester(5)).toBe(EARLY_PERIODS);
    expect(periodsForSemester(6)).toBe(EARLY_PERIODS);
  });

  it('respects bookings made by another semester, including overlapping grids', () => {
    // an early-grid class 08:30–10:00 blocks the standard 08:00–09:30 block for the same teacher
    const existing = [{ teacherId: 't1', venueId: 'r0', dayOfWeek: 1, startTime: '08:30', endTime: '10:00' }];
    const r = generateTimetable(sections(1), [{ id: 'o1', code: 'CS4001', teacherId: 't1' }], rooms(1), undefined, existing);
    expect(r.slots.some((s) => s.dayOfWeek === 1 && s.startTime === '08:00')).toBe(false);
    expect(findClashes(withIds([...r.slots, { ...existing[0], sectionId: 'other', offeringId: 'x' }]))).toEqual([]);
  });

  it('reports unplaced sessions with a reason when rooms are scarce', () => {
    const r = generateTimetable(sections(10), [{ id: 'o1', code: 'A', teacherId: 't1' }, { id: 'o2', code: 'B', teacherId: 't2' }], rooms(1));
    expect(r.slots.length).toBeLessThanOrEqual(25);
    const missing = r.unplaced.reduce((n, u) => n + u.missing, 0);
    expect(missing).toBe(40 - r.slots.length);
    expect(r.unplaced[0].reason).toMatch(/room|gap|period/);
  });

  it('never puts a section in a room that is too small', () => {
    const r = generateTimetable(sections(2), [{ id: 'o1', code: 'A', teacherId: 't1' }], [{ id: 'small', name: 'Lab', capacity: 10 }, ...rooms(1, 40)]);
    expect(r.slots.every((s) => s.venueId === 'r0')).toBe(true);
  });

  it('is deterministic', () => {
    const args = [sections(4), [{ id: 'o1', code: 'A', teacherId: 't1' }], rooms(2)] as const;
    expect(generateTimetable(...args)).toEqual(generateTimetable(...args));
  });
});

describe('breaksGapRule / findGapViolations', () => {
  it('allows a compact day and rejects a long hole', () => {
    const day = [{ dayOfWeek: 1, startTime: '08:00', endTime: '09:30' }];
    expect(breaksGapRule(day, { dayOfWeek: 1, startTime: '09:45', endTime: '11:15' })).toBe(false);
    expect(breaksGapRule(day, { dayOfWeek: 1, startTime: '11:30', endTime: '13:00' })).toBe(false); // exactly 2 h
    expect(breaksGapRule(day, { dayOfWeek: 1, startTime: '14:00', endTime: '15:30' })).toBe(true); // 4.5 h
    expect(breaksGapRule(day, { dayOfWeek: 2, startTime: '15:45', endTime: '17:15' })).toBe(false); // other day
  });

  it('lists the offending gap', () => {
    const v = findGapViolations([
      { sectionId: 'A', dayOfWeek: 1, startTime: '08:00', endTime: '09:30' },
      { sectionId: 'A', dayOfWeek: 1, startTime: '15:45', endTime: '17:15' },
    ]);
    expect(v).toEqual([{ sectionId: 'A', dayOfWeek: 1, after: '09:30', before: '15:45', gapMinutes: 375 }]);
    expect(DEFAULT_MAX_GAP_MIN).toBe(120);
  });
});

describe('suggestSlots', () => {
  it('offers free periods, preferring compact days and the current room', () => {
    const existing = [
      { teacherId: 't1', venueId: 'r0', sectionId: 's0', dayOfWeek: 1, startTime: '08:00', endTime: '09:30' },
      { teacherId: 't9', venueId: 'r1', sectionId: 'other', dayOfWeek: 1, startTime: '09:45', endTime: '11:15' },
    ];
    const out = suggestSlots({ periods: STANDARD_PERIODS, section: { id: 's0', size: 24 }, teacherId: 't1', currentVenueId: 'r0', rooms: rooms(3), existing });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toMatchObject({ dayOfWeek: 1, startTime: '09:45', createsGap: false, keepsRoom: true });
    expect(out.every((c) => !(c.dayOfWeek === 1 && c.startTime === '08:00'))).toBe(true); // section already busy
  });

  it('honours the final-year cut-off', () => {
    const out = suggestSlots({ periods: EARLY_PERIODS, section: { id: 's0', size: 24, latestEnd: '10:00' }, teacherId: 't1', rooms: rooms(2), existing: [] });
    expect(out.every((c) => toMinutes(c.endTime) <= toMinutes('10:00'))).toBe(true);
  });

  it('returns nothing when every room is taken', () => {
    const busy = STANDARD_PERIODS.map((p) => ({ teacherId: 'x', venueId: 'r0', dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime }));
    expect(suggestSlots({ periods: STANDARD_PERIODS, section: { id: 's0', size: 24 }, teacherId: 't1', rooms: rooms(1), existing: busy })).toEqual([]);
  });
});

describe('findClashes', () => {
  it('flags overlapping teacher, section and room use on the same day', () => {
    const a = { id: 'a', sectionId: 'sA', teacherId: 't1', venueId: 'r1', dayOfWeek: 1, startTime: '09:00', endTime: '10:30' };
    const b = { id: 'b', sectionId: 'sB', teacherId: 't1', venueId: 'r2', dayOfWeek: 1, startTime: '10:00', endTime: '11:30' };
    const c = { id: 'c', sectionId: 'sA', teacherId: 't2', venueId: 'r1', dayOfWeek: 1, startTime: '09:30', endTime: '10:00' };
    const d = { id: 'd', sectionId: 'sA', teacherId: 't1', venueId: 'r1', dayOfWeek: 2, startTime: '09:00', endTime: '10:30' };
    expect(findClashes([a, b, c, d]).map((x) => `${x.kind}:${x.a}-${x.b}`).sort()).toEqual(['ROOM:a-c', 'SECTION:a-c', 'TEACHER:a-b']);
  });
});

describe('calendar maths', () => {
  it('maps week/day to a date from the semester Monday', () => {
    const start = new Date(Date.UTC(2026, 8, 14));
    expect(slotDate(start, 1, 1).toISOString().slice(0, 10)).toBe('2026-09-14');
    expect(slotDate(start, 12, 3).toISOString().slice(0, 10)).toBe('2026-12-02');
    expect(weekOf(start, new Date(Date.UTC(2026, 11, 2)), 12)).toBe(12);
    expect(weekOf(start, new Date(Date.UTC(2026, 11, 9)), 12)).toBeNull();
  });
});
