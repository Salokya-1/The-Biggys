import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_GAP_MIN,
  EARLY_PERIODS,
  STANDARD_PERIODS,
  TEACHING_DAYS,
  daysFor,
  sessionsFor,
  yearOfSemester,
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
/** A campus: one hall for the cohort lectures plus `n` teaching rooms for the applied hours. */
const campus = (n: number, hallCap = 400, cap = 30) => [
  { id: 'hall', name: 'Hall - 01', capacity: hallCap, roomType: 'HALL' as const },
  ...Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `TR0${i + 1}`, capacity: cap, roomType: (i % 2 ? 'LAB' : 'SEMINAR_ROOM') as 'LAB' | 'SEMINAR_ROOM' })),
];
const withIds = <T,>(slots: T[]) => slots.map((s, i) => ({ ...s, id: `slot${i}` }));

describe('generateTimetable', () => {
  it('places 10 sections × 2 modules × 2 sessions with no clashes', () => {
    const offerings = [
      { id: 'o1', code: 'CS4001', teacherId: 't1' },
      { id: 'o2', code: 'CC4051', teacherId: 't2' },
    ];
    // Two modules: each gives the whole cohort one lecture and every group one applied hour.
    const r = generateTimetable(sections(10), offerings, campus(10));
    expect(r.unplaced).toEqual([]);
    expect(r.slots).toHaveLength(2 + 20);
    expect(findClashes(withIds(r.slots))).toEqual([]);
    expect(r.slots.filter((s) => s.kind === 'LECTURE')).toHaveLength(2);
    expect(r.slots.find((s) => s.kind === 'LECTURE')!.groupIds).toHaveLength(10);
  });

  it('never leaves a section a gap longer than two hours', () => {
    const offerings = Array.from({ length: 4 }, (_, i) => ({ id: `o${i}`, code: `M${i}`, teacherId: `t${i}` }));
    const r = generateTimetable(sections(4), offerings, campus(8));
    expect(r.unplaced).toEqual([]);
    expect(r.gapViolations).toEqual([]);
  });

  it('finishes final-year groups by 10:00', () => {
    const finalYear = sections(2, { latestEnd: '10:00', periods: EARLY_PERIODS });
    const offerings = Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, code: `M${i}`, teacherId: `t${i}` }));
    const r = generateTimetable(finalYear, offerings, campus(8));
    expect(r.unplaced).toEqual([]);
    expect(r.slots).toHaveLength(5 + 10); // five cohort lectures, plus one applied hour per group
    expect(r.slots.every((s) => toMinutes(s.endTime) <= toMinutes('10:00'))).toBe(true);
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
    // One small room: no hall for the cohort lectures, and 20 applied hours chasing one room.
    const r = generateTimetable(sections(10), [{ id: 'o1', code: 'A', teacherId: 't1' }, { id: 'o2', code: 'B', teacherId: 't2' }], rooms(1));
    const missing = r.unplaced.reduce((n, u) => n + u.missing, 0);
    expect(missing).toBe(22 - r.slots.length);
    expect(r.unplaced.some((u) => /big enough|room|gap|period/.test(u.reason))).toBe(true);
  });

  it('never puts a section in a room that is too small', () => {
    const r = generateTimetable(sections(2), [{ id: 'o1', code: 'A', teacherId: 't1' }], [{ id: 'small', name: 'Lab', capacity: 10 }, ...rooms(1, 400)]);
    expect(r.slots.every((s) => s.venueId === 'r0')).toBe(true);
  });

  it('gives a lecture a hall, a tutorial a seminar room and a workshop a lab', () => {
    const r = generateTimetable(sections(1), [{ id: 'o1', code: 'A', teacherId: 't1', credits: 30 }], campus(4));
    const room = (kind: string) => r.slots.find((s) => s.kind === kind)!.venueId;
    expect(room('LECTURE')).toBe('hall');
    expect(r.slots.find((s) => s.kind === 'WORKSHOP')!.venueId).toMatch(/^r[13]$/); // the LAB rooms
    expect(r.slots.find((s) => s.kind === 'TUTORIAL')!.venueId).toMatch(/^r[02]$/); // the SEMINAR rooms
  });

  it('runs each kind for the length the live allocation sheet uses', () => {
    const r = generateTimetable(sections(1), [{ id: 'o1', code: 'A', teacherId: 't1', credits: 30 }], campus(4));
    const mins = (kind: string) => { const s = r.slots.find((x) => x.kind === kind)!; return toMinutes(s.endTime) - toMinutes(s.startTime); };
    expect(mins('LECTURE')).toBe(90);
    expect(mins('TUTORIAL')).toBe(60);
    expect(mins('WORKSHOP')).toBe(120);
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

describe('class kinds and the year day pattern', () => {
  it('gives a 15-credit module a lecture plus one applied hour, and a 30-credit module all three', () => {
    expect(sessionsFor(15, 0)).toEqual(['LECTURE', 'TUTORIAL']);
    expect(sessionsFor(15, 1)).toEqual(['LECTURE', 'WORKSHOP']);
    expect(sessionsFor(30, 0)).toEqual(['LECTURE', 'TUTORIAL', 'WORKSHOP']);
  });

  it('keeps each year on its own days for each kind', () => {
    // Sunday is 7 and Saturday is never a teaching day.
    expect(daysFor(1, 'LECTURE')).toEqual([7, 1]);
    expect(daysFor(2, 'LECTURE')).toEqual([2, 3]);
    expect(daysFor(3, 'LECTURE')).toEqual([4, 5]);
    expect(daysFor(1, 'WORKSHOP')).toEqual([4, 5]);
    expect(daysFor(3, 'TUTORIAL')).toEqual([7, 1]);
    expect(TEACHING_DAYS).not.toContain(6);
  });

  it('maps semesters to years', () => {
    expect([1, 2, 3, 4, 5, 6].map(yearOfSemester)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('places every session on its year’s days when there is room', () => {
    const r = generateTimetable(
      [{ id: 's1', name: 'A', size: 20, year: 2 }],
      [{ id: 'o1', code: 'A', teacherId: 't1', credits: 30 }],
      rooms(3),
    );
    expect(r.unplaced).toEqual([]);
    const byKind = Object.fromEntries(r.slots.map((s) => [s.kind, s.dayOfWeek]));
    expect(daysFor(2, 'LECTURE')).toContain(byKind.LECTURE);
    expect(daysFor(2, 'TUTORIAL')).toContain(byKind.TUTORIAL);
    expect(daysFor(2, 'WORKSHOP')).toContain(byKind.WORKSHOP);
  });

  it('shares a module’s sections between its two teachers', () => {
    const r = generateTimetable(
      Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, name: String.fromCharCode(65 + i), size: 20, year: 1 })),
      [{ id: 'o1', code: 'A', teacherId: 'ta', teacherIds: ['ta', 'tb'], credits: 15 }],
      rooms(4),
    );
    const perTeacher = new Map<string, Set<string>>();
    for (const s of r.slots) perTeacher.set(s.teacherId, (perTeacher.get(s.teacherId) ?? new Set()).add(s.sectionId));
    expect([...perTeacher.keys()].sort()).toEqual(['ta', 'tb']);
    // two sections each, and a teacher keeps the same sections for every kind
    expect([...perTeacher.values()].map((v) => v.size)).toEqual([2, 2]);
  });
});
