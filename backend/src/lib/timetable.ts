/**
 * Weekly timetable generator — pure and deterministic.
 *
 * One constant weekly routine is produced for a semester and repeated for the teaching weeks.
 * Every (section × module offering) needs `sessionsPerWeek` periods. A period can be used only
 * if the section, the teacher and the room are all free, and the same section/module pair is
 * spread over different days where possible. Unplaceable sessions are reported, never dropped
 * silently.
 */

export interface TtSection {
  id: string;
  name: string;
  size: number;
}

export interface TtOffering {
  id: string;
  code: string;
  teacherId: string;
  sessionsPerWeek?: number;
}

export interface TtRoom {
  id: string;
  name: string;
  capacity: number;
}

export interface Period {
  dayOfWeek: number; // 1 = Monday … 5 = Friday
  startTime: string;
  endTime: string;
}

export interface TtSlot {
  sectionId: string;
  offeringId: string;
  teacherId: string;
  venueId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface TtResult {
  slots: TtSlot[];
  unplaced: { sectionId: string; offeringId: string; missing: number }[];
}

export const DEFAULT_PERIODS: Period[] = [1, 2, 3, 4, 5].flatMap((day) => [
  { dayOfWeek: day, startTime: '08:00', endTime: '09:30' },
  { dayOfWeek: day, startTime: '09:45', endTime: '11:15' },
  { dayOfWeek: day, startTime: '11:30', endTime: '13:00' },
  { dayOfWeek: day, startTime: '14:00', endTime: '15:30' },
  { dayOfWeek: day, startTime: '15:45', endTime: '17:15' },
]);

export const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

const key = (p: Period) => `${p.dayOfWeek}:${p.startTime}`;

/** Bookings that already exist (e.g. another semester running in the same weeks) and must be respected. */
export interface ExistingBooking {
  teacherId: string;
  venueId: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export function generateTimetable(sections: TtSection[], offerings: TtOffering[], rooms: TtRoom[], periods: Period[] = DEFAULT_PERIODS, existing: ExistingBooking[] = []): TtResult {
  const teacherBusy = new Map<string, Set<string>>(); // teacherId -> period keys
  const sectionBusy = new Map<string, Set<string>>();
  const roomBusy = new Map<string, Set<string>>(); // period key -> room ids
  const slots: TtSlot[] = [];
  const unplaced: TtResult['unplaced'] = [];
  const busy = (m: Map<string, Set<string>>, k: string) => m.get(k) ?? m.set(k, new Set()).get(k)!;

  // Pre-book teachers and rooms used by concurrent timetables in any period they overlap.
  for (const b of existing) {
    for (const p of periods) {
      if (p.dayOfWeek !== b.dayOfWeek || !overlaps(p.startTime, p.endTime, b.startTime, b.endTime)) continue;
      busy(teacherBusy, b.teacherId).add(key(p));
      if (b.venueId) busy(roomBusy, key(p)).add(b.venueId);
    }
  }

  const orderedRooms = [...rooms].sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name)); // smallest fitting room first
  const orderedSections = [...sections].sort((a, b) => a.name.localeCompare(b.name));
  const orderedOfferings = [...offerings].sort((a, b) => a.code.localeCompare(b.code));

  // Rotate the starting period per section so sections do not all pile onto Monday 08:00.
  orderedSections.forEach((section, si) => {
    orderedOfferings.forEach((offering, oi) => {
      const need = offering.sessionsPerWeek ?? 2;
      const usedDays = new Set<number>();
      let placed = 0;
      const start = (si * 3 + oi * 7) % periods.length;
      // two passes: first insisting on distinct days, then relaxing that
      for (const distinctDays of [true, false]) {
        for (let i = 0; i < periods.length && placed < need; i++) {
          const p = periods[(start + i) % periods.length];
          const k = key(p);
          if (distinctDays && usedDays.has(p.dayOfWeek)) continue;
          if (busy(sectionBusy, section.id).has(k)) continue;
          if (busy(teacherBusy, offering.teacherId).has(k)) continue;
          const taken = busy(roomBusy, k);
          const room = orderedRooms.find((r) => r.capacity >= section.size && !taken.has(r.id));
          if (!room) continue;
          slots.push({ sectionId: section.id, offeringId: offering.id, teacherId: offering.teacherId, venueId: room.id, dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime });
          busy(sectionBusy, section.id).add(k);
          busy(teacherBusy, offering.teacherId).add(k);
          taken.add(room.id);
          usedDays.add(p.dayOfWeek);
          placed++;
        }
      }
      if (placed < need) unplaced.push({ sectionId: section.id, offeringId: offering.id, missing: need - placed });
    });
  });

  return { slots: slots.sort((a, b) => a.dayOfWeek - b.dayOfWeek || toMinutes(a.startTime) - toMinutes(b.startTime) || a.sectionId.localeCompare(b.sectionId)), unplaced };
}

export interface Clash {
  kind: 'TEACHER' | 'SECTION' | 'ROOM';
  key: string; // teacherId / sectionId / venueId
  a: string; // slot ids or labels
  b: string;
  dayOfWeek: number;
  time: string;
}

/** Detect overlapping slots on the same day for the same teacher, section or room. */
export function findClashes<T extends { id: string; sectionId: string; teacherId: string; venueId: string | null; dayOfWeek: number; startTime: string; endTime: string }>(slots: T[]): Clash[] {
  const out: Clash[] = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      if (a.dayOfWeek !== b.dayOfWeek || !overlaps(a.startTime, a.endTime, b.startTime, b.endTime)) continue;
      const time = `${a.startTime}–${a.endTime}`;
      if (a.teacherId === b.teacherId) out.push({ kind: 'TEACHER', key: a.teacherId, a: a.id, b: b.id, dayOfWeek: a.dayOfWeek, time });
      if (a.sectionId === b.sectionId) out.push({ kind: 'SECTION', key: a.sectionId, a: a.id, b: b.id, dayOfWeek: a.dayOfWeek, time });
      if (a.venueId && a.venueId === b.venueId) out.push({ kind: 'ROOM', key: a.venueId, a: a.id, b: b.id, dayOfWeek: a.dayOfWeek, time });
    }
  }
  return out;
}

/** Concrete calendar date of a weekly slot in week `week` (1-based) of a semester starting on `semesterStart`. */
export function slotDate(semesterStart: Date, week: number, dayOfWeek: number): Date {
  const start = new Date(semesterStart);
  // normalise the semester start to its Monday
  const offsetToMonday = (start.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - offsetToMonday));
  return new Date(monday.getTime() + ((week - 1) * 7 + (dayOfWeek - 1)) * 86400e3);
}

/** Week number (1-based) of a date within a semester, or null when outside the teaching weeks. */
export function weekOf(semesterStart: Date, date: Date, teachingWeeks: number): number | null {
  const monday = slotDate(semesterStart, 1, 1);
  const diff = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - monday.getTime()) / 86400e3);
  if (diff < 0) return null;
  const week = Math.floor(diff / 7) + 1;
  return week <= teachingWeeks ? week : null;
}
