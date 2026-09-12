import { describe, expect, it } from 'vitest';
import { examSlots, generateExamSchedule } from './exam-schedule';

const start = new Date(Date.UTC(2026, 11, 7)); // Mon 7 Dec 2026
const end = new Date(Date.UTC(2026, 11, 21));
const venues = [
  { id: 'hall', name: 'Kumari Hall', capacity: 165, examHall: true },
  { id: 'aud', name: 'Auditorium', capacity: 240, examHall: true },
  { id: 'lb101', name: 'LB-101', capacity: 78, examHall: false },
  { id: 'lab3', name: 'Lab 3', capacity: 40, examHall: false },
];
const teachers = [
  { id: 't1', name: 'Chetna' },
  { id: 't2', name: 'Ramesh' },
  { id: 't3', name: 'Sabina' },
  { id: 't4', name: 'Niraj' },
];

describe('examSlots', () => {
  it('yields two weekday slots a day across the window', () => {
    const slots = examSlots(start, end);
    expect(slots).toHaveLength(20);
    expect(slots[0].date.toISOString().slice(0, 10)).toBe('2026-12-07');
    expect(slots.every((s) => ![0, 6].includes(s.date.getUTCDay()))).toBe(true);
  });
});

describe('generateExamSchedule', () => {
  it('gives every offering one exam, never two exams of one semester in the same slot', () => {
    const offerings = [
      { id: 'o1', code: 'CS4001', semesterId: 'semA', candidates: 240, teacherId: 't1' },
      { id: 'o2', code: 'CS4002', semesterId: 'semA', candidates: 240, teacherId: 't2' },
      { id: 'o3', code: 'BM4001', semesterId: 'semB', candidates: 24, teacherId: 't3' },
      { id: 'o4', code: 'BM4002', semesterId: 'semB', candidates: 24, teacherId: 't4' },
    ];
    const r = generateExamSchedule(offerings, venues, teachers, examSlots(start, end));
    expect(r.unscheduled).toEqual([]);
    expect(r.sessions).toHaveLength(4);
    const bySlot = new Map<string, string[]>();
    for (const s of r.sessions) {
      const k = `${s.date.toISOString()} ${s.startTime}`;
      bySlot.set(k, [...(bySlot.get(k) ?? []), s.semesterId]);
    }
    for (const sems of bySlot.values()) expect(new Set(sems).size).toBe(sems.length);
  });

  it('covers candidates with venue capacity and assigns a non-teaching invigilator per venue', () => {
    const r = generateExamSchedule([{ id: 'o1', code: 'CS4001', semesterId: 'semA', candidates: 300, teacherId: 't1' }], venues, teachers, examSlots(start, end));
    const s = r.sessions[0];
    const cap = s.venueIds.reduce((n, id) => n + venues.find((v) => v.id === id)!.capacity, 0);
    expect(cap).toBeGreaterThanOrEqual(300);
    expect(s.invigilators).toHaveLength(s.venueIds.length);
    expect(s.invigilators.every((i) => i.userId !== 't1')).toBe(true);
    expect(new Set(s.invigilators.map((i) => i.userId)).size).toBe(s.invigilators.length);
  });

  it('never double-books a venue or an invigilator in one slot', () => {
    const offerings = Array.from({ length: 12 }, (_, i) => ({ id: `o${i}`, code: `M${i}`, semesterId: `sem${i}`, candidates: 60, teacherId: null }));
    const r = generateExamSchedule(offerings, venues, teachers, examSlots(start, end));
    const use = new Map<string, Set<string>>();
    for (const s of r.sessions) {
      const k = `${s.date.toISOString()} ${s.startTime}`;
      const set = use.get(k) ?? new Set();
      for (const v of s.venueIds) {
        expect(set.has(`v:${v}`)).toBe(false);
        set.add(`v:${v}`);
      }
      for (const i of s.invigilators) {
        expect(set.has(`t:${i.userId}`)).toBe(false);
        set.add(`t:${i.userId}`);
      }
      use.set(k, set);
    }
  });

  it('reports what cannot be scheduled instead of failing', () => {
    const r = generateExamSchedule([{ id: 'o1', code: 'HUGE', semesterId: 'x', candidates: 1000, teacherId: null }, { id: 'o2', code: 'EMPTY', semesterId: 'y', candidates: 0, teacherId: null }], venues, teachers, examSlots(start, end));
    expect(r.sessions).toEqual([]);
    expect(r.unscheduled.map((u) => u.offeringId).sort()).toEqual(['o1', 'o2']);
  });
});
