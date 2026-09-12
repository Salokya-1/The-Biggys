/**
 * Weekly timetable generator — pure and deterministic.
 *
 * One constant weekly routine is produced for a semester and repeated for the teaching weeks.
 * Every (section × module offering) needs `sessionsPerWeek` periods. A period can be used only
 * if the section, the teacher and the room are all free, and only if it respects the section's
 * constraints: final-year groups finish by 10:00, and nobody gets a gap longer than two hours
 * between classes on the same day. Unplaceable sessions are reported, never dropped silently.
 */

export interface Period {
  dayOfWeek: number; // 1 = Monday … 5 = Friday
  startTime: string;
  endTime: string;
}

export interface SectionConstraints {
  /** Classes must finish by this time (final-year groups: "10:00"). */
  latestEnd?: string;
  /** Longest allowed gap between two classes on the same day, in minutes. */
  maxGapMinutes?: number;
}

export interface TtSection extends SectionConstraints {
  id: string;
  name: string;
  size: number;
  /** Period grid for this section; defaults to STANDARD_PERIODS. */
  periods?: Period[];
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
  unplaced: { sectionId: string; offeringId: string; missing: number; reason: string }[];
  gapViolations: GapViolation[];
}

const grid = (times: [string, string][]): Period[] =>
  [1, 2, 3, 4, 5].flatMap((day) => times.map(([startTime, endTime]) => ({ dayOfWeek: day, startTime, endTime })));

/** Standard day: five 90-minute blocks from 08:00 to 17:15. */
export const STANDARD_PERIODS: Period[] = grid([
  ['08:00', '09:30'],
  ['09:45', '11:15'],
  ['11:30', '13:00'],
  ['14:00', '15:30'],
  ['15:45', '17:15'],
]);

/** Final-year day: three 60-minute blocks so the group is always finished by 10:00. */
export const EARLY_PERIODS: Period[] = grid([
  ['07:00', '08:00'],
  ['08:00', '09:00'],
  ['09:00', '10:00'],
]);

export const DEFAULT_PERIODS = STANDARD_PERIODS;
export const DEFAULT_MAX_GAP_MIN = 120;
/** Semesters 5 and 6 are the final year at Islington's three-year degrees. */
export const isFinalYearSemester = (semesterNumber: number) => semesterNumber >= 5;
export const periodsForSemester = (semesterNumber: number) => (isFinalYearSemester(semesterNumber) ? EARLY_PERIODS : STANDARD_PERIODS);

export const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

interface Interval {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

class Booking {
  private byKey = new Map<string, Interval[]>();
  add(key: string, i: Interval) {
    const list = this.byKey.get(key) ?? [];
    list.push(i);
    this.byKey.set(key, list);
  }
  get(key: string): Interval[] {
    return this.byKey.get(key) ?? [];
  }
  busy(key: string, p: Interval): boolean {
    return this.get(key).some((i) => i.dayOfWeek === p.dayOfWeek && overlaps(i.startTime, i.endTime, p.startTime, p.endTime));
  }
}

/** Would adding `p` leave the section with a gap longer than `maxGap` on that day? */
export function breaksGapRule(dayIntervals: Interval[], p: Interval, maxGap = DEFAULT_MAX_GAP_MIN): boolean {
  const day = [...dayIntervals.filter((i) => i.dayOfWeek === p.dayOfWeek), p].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  for (let i = 1; i < day.length; i++) {
    if (toMinutes(day[i].startTime) - toMinutes(day[i - 1].endTime) > maxGap) return true;
  }
  return false;
}

export interface GapViolation {
  sectionId: string;
  dayOfWeek: number;
  after: string;
  before: string;
  gapMinutes: number;
}

/** Gaps longer than `maxGap` in a finished timetable, per section and day. */
export function findGapViolations<T extends { sectionId: string; dayOfWeek: number; startTime: string; endTime: string }>(slots: T[], maxGap = DEFAULT_MAX_GAP_MIN): GapViolation[] {
  const out: GapViolation[] = [];
  const bySectionDay = new Map<string, T[]>();
  for (const s of slots) {
    const k = `${s.sectionId}:${s.dayOfWeek}`;
    bySectionDay.set(k, [...(bySectionDay.get(k) ?? []), s]);
  }
  for (const [k, list] of bySectionDay) {
    const [sectionId, day] = k.split(':');
    const sorted = [...list].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    for (let i = 1; i < sorted.length; i++) {
      const gap = toMinutes(sorted[i].startTime) - toMinutes(sorted[i - 1].endTime);
      if (gap > maxGap) out.push({ sectionId, dayOfWeek: Number(day), after: sorted[i - 1].endTime, before: sorted[i].startTime, gapMinutes: gap });
    }
  }
  return out;
}

/** Bookings that already exist (e.g. another semester in the same weeks) and must be respected. */
export interface ExistingBooking {
  teacherId: string;
  venueId: string | null;
  sectionId?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export function generateTimetable(
  sections: TtSection[],
  offerings: TtOffering[],
  rooms: TtRoom[],
  periodsOrUndefined: Period[] | undefined = undefined,
  existing: ExistingBooking[] = [],
): TtResult {
  const teacherBusy = new Booking();
  const sectionBusy = new Booking();
  const roomBusy = new Booking();
  const slots: TtSlot[] = [];
  const unplaced: TtResult['unplaced'] = [];

  for (const b of existing) {
    const i = { dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime };
    teacherBusy.add(b.teacherId, i);
    if (b.venueId) roomBusy.add(b.venueId, i);
    if (b.sectionId) sectionBusy.add(b.sectionId, i);
  }

  const orderedRooms = [...rooms].sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name)); // smallest fitting room first
  const orderedSections = [...sections].sort((a, b) => a.name.localeCompare(b.name));
  const orderedOfferings = [...offerings].sort((a, b) => a.code.localeCompare(b.code));

  orderedSections.forEach((section, si) => {
    const periods = (section.periods ?? periodsOrUndefined ?? STANDARD_PERIODS).filter((p) => !section.latestEnd || toMinutes(p.endTime) <= toMinutes(section.latestEnd));
    const maxGap = section.maxGapMinutes ?? DEFAULT_MAX_GAP_MIN;

    orderedOfferings.forEach((offering, oi) => {
      const need = offering.sessionsPerWeek ?? 2;
      const usedDays = new Set<number>();
      let placed = 0;
      let blocked = 'no free period with a room, teacher and section all available';
      const start = (si * 3 + oi * 7) % Math.max(1, periods.length);

      // pass 1: spread over distinct days and keep the day compact; pass 2: distinct days only; pass 3: anything free
      for (const [distinctDays, respectGap] of [[true, true], [false, true], [false, false]] as const) {
        for (let i = 0; i < periods.length && placed < need; i++) {
          const p = periods[(start + i) % periods.length];
          if (distinctDays && usedDays.has(p.dayOfWeek)) continue;
          if (sectionBusy.busy(section.id, p)) continue;
          if (teacherBusy.busy(offering.teacherId, p)) continue;
          if (respectGap && breaksGapRule(sectionBusy.get(section.id), p, maxGap)) {
            blocked = `only periods that would leave a gap longer than ${maxGap / 60} h were free`;
            continue;
          }
          const room = orderedRooms.find((r) => r.capacity >= section.size && !roomBusy.busy(r.id, p));
          if (!room) {
            blocked = 'no room of the right size was free';
            continue;
          }
          slots.push({ sectionId: section.id, offeringId: offering.id, teacherId: offering.teacherId, venueId: room.id, dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime });
          sectionBusy.add(section.id, p);
          teacherBusy.add(offering.teacherId, p);
          roomBusy.add(room.id, p);
          usedDays.add(p.dayOfWeek);
          placed++;
        }
        if (placed >= need) break;
      }
      if (placed < need) unplaced.push({ sectionId: section.id, offeringId: offering.id, missing: need - placed, reason: blocked });
    });
  });

  const ordered = slots.sort((a, b) => a.dayOfWeek - b.dayOfWeek || toMinutes(a.startTime) - toMinutes(b.startTime) || a.sectionId.localeCompare(b.sectionId));
  const gapMap = new Map(sections.map((s) => [s.id, s.maxGapMinutes ?? DEFAULT_MAX_GAP_MIN]));
  const gapViolations = findGapViolations(ordered).filter((v) => v.gapMinutes > (gapMap.get(v.sectionId) ?? DEFAULT_MAX_GAP_MIN));
  return { slots: ordered, unplaced, gapViolations };
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

export interface SlotCandidate {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  venueId: string;
  venueName: string;
  keepsRoom: boolean;
  createsGap: boolean;
}

/**
 * Free places a class could move to — used when a drag-and-drop lands on a clash, so the
 * UI can offer "put it here instead" rather than just refusing.
 */
export function suggestSlots(args: {
  periods: Period[];
  section: { id: string; size: number; latestEnd?: string; maxGapMinutes?: number };
  teacherId: string;
  currentVenueId?: string | null;
  rooms: TtRoom[];
  existing: ExistingBooking[]; // every other booking in the same weeks (excluding the slot being moved)
  limit?: number;
}): SlotCandidate[] {
  const { periods, section, teacherId, currentVenueId, rooms, existing, limit = 8 } = args;
  const teacherBusy = new Booking();
  const sectionBusy = new Booking();
  const roomBusy = new Booking();
  for (const b of existing) {
    const i = { dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime };
    teacherBusy.add(b.teacherId, i);
    if (b.venueId) roomBusy.add(b.venueId, i);
    if (b.sectionId) sectionBusy.add(b.sectionId, i);
  }
  const maxGap = section.maxGapMinutes ?? DEFAULT_MAX_GAP_MIN;
  const usable = periods.filter((p) => !section.latestEnd || toMinutes(p.endTime) <= toMinutes(section.latestEnd));
  const out: SlotCandidate[] = [];
  for (const p of usable) {
    if (sectionBusy.busy(section.id, p) || teacherBusy.busy(teacherId, p)) continue;
    const free = rooms.filter((r) => r.capacity >= section.size && !roomBusy.busy(r.id, p)).sort((a, b) => Number(b.id === currentVenueId) - Number(a.id === currentVenueId) || a.capacity - b.capacity || a.name.localeCompare(b.name));
    const room = free[0];
    if (!room) continue;
    out.push({ dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime, venueId: room.id, venueName: room.name, keepsRoom: room.id === currentVenueId, createsGap: breaksGapRule(sectionBusy.get(section.id), p, maxGap) });
  }
  return out
    .sort((a, b) => Number(a.createsGap) - Number(b.createsGap) || Number(b.keepsRoom) - Number(a.keepsRoom) || a.dayOfWeek - b.dayOfWeek || toMinutes(a.startTime) - toMinutes(b.startTime))
    .slice(0, limit);
}

/** Concrete calendar date of a weekly slot in week `week` (1-based) of a semester starting on `semesterStart`. */
export function slotDate(semesterStart: Date, week: number, dayOfWeek: number): Date {
  const start = new Date(semesterStart);
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
