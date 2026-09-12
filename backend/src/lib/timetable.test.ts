import { describe, expect, it } from 'vitest';
import { DEFAULT_PERIODS, findClashes, generateTimetable, slotDate, weekOf } from './timetable';

const sections = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: String.fromCharCode(65 + i), size: 24 }));
const rooms = (n: number, cap = 30) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `LB-${101 + i}`, capacity: cap }));

describe('generateTimetable', () => {
  it('places 10 sections × 2 modules × 2 sessions with one teacher per module and no clashes', () => {
    const offerings = [
      { id: 'o1', code: 'CS4001', teacherId: 't1' },
      { id: 'o2', code: 'CS4002', teacherId: 't2' },
    ];
    const r = generateTimetable(sections(10), offerings, rooms(6));
    expect(r.unplaced).toEqual([]);
    expect(r.slots).toHaveLength(40);
    const withIds = r.slots.map((s, i) => ({ ...s, id: `slot${i}` }));
    expect(findClashes(withIds)).toEqual([]);
    // each teacher teaches 20 sessions per week, never two at once
    expect(withIds.filter((s) => s.teacherId === 't1')).toHaveLength(20);
  });

  it('spreads a section-module pair over different days when it can', () => {
    const r = generateTimetable(sections(1), [{ id: 'o1', code: 'CS4001', teacherId: 't1' }], rooms(1));
    const days = new Set(r.slots.map((s) => s.dayOfWeek));
    expect(days.size).toBe(2);
  });

  it('reports unplaced sessions when rooms are scarce', () => {
    // 10 sections need 40 sessions/week but one room offers only 25 periods
    const r = generateTimetable(sections(10), [{ id: 'o1', code: 'CS4001', teacherId: 't1' }, { id: 'o2', code: 'CS4002', teacherId: 't2' }], rooms(1));
    expect(r.slots.length).toBeLessThanOrEqual(25);
    expect(r.unplaced.reduce((n, u) => n + u.missing, 0)).toBe(40 - r.slots.length);
  });

  it('never puts a section in a room that is too small', () => {
    const r = generateTimetable(sections(2), [{ id: 'o1', code: 'CS4001', teacherId: 't1' }], [{ id: 'small', name: 'Lab', capacity: 10 }, ...rooms(1, 40)]);
    expect(r.slots.every((s) => s.venueId === 'r0')).toBe(true);
  });

  it('is deterministic', () => {
    const args = [sections(4), [{ id: 'o1', code: 'CS4001', teacherId: 't1' }], rooms(2), DEFAULT_PERIODS] as const;
    expect(generateTimetable(...args)).toEqual(generateTimetable(...args));
  });
});

describe('findClashes', () => {
  it('flags overlapping teacher, section and room use on the same day', () => {
    const a = { id: 'a', sectionId: 'sA', teacherId: 't1', venueId: 'r1', dayOfWeek: 1, startTime: '09:00', endTime: '10:30' };
    const b = { id: 'b', sectionId: 'sB', teacherId: 't1', venueId: 'r2', dayOfWeek: 1, startTime: '10:00', endTime: '11:30' };
    const c = { id: 'c', sectionId: 'sA', teacherId: 't2', venueId: 'r1', dayOfWeek: 1, startTime: '09:30', endTime: '10:00' };
    const d = { id: 'd', sectionId: 'sA', teacherId: 't1', venueId: 'r1', dayOfWeek: 2, startTime: '09:00', endTime: '10:30' };
    const clashes = findClashes([a, b, c, d]);
    expect(clashes.map((x) => `${x.kind}:${x.a}-${x.b}`).sort()).toEqual(['ROOM:a-c', 'SECTION:a-c', 'TEACHER:a-b']);
  });
});

describe('calendar maths', () => {
  it('maps week/day to a date from the semester Monday', () => {
    const start = new Date(Date.UTC(2026, 8, 14)); // Mon 14 Sep 2026
    expect(slotDate(start, 1, 1).toISOString().slice(0, 10)).toBe('2026-09-14');
    expect(slotDate(start, 1, 5).toISOString().slice(0, 10)).toBe('2026-09-18');
    expect(slotDate(start, 12, 3).toISOString().slice(0, 10)).toBe('2026-12-02');
    expect(weekOf(start, new Date(Date.UTC(2026, 11, 2)), 12)).toBe(12);
    expect(weekOf(start, new Date(Date.UTC(2026, 11, 9)), 12)).toBeNull(); // exam week
  });
});
