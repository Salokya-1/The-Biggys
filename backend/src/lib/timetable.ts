/**
 * Weekly timetable generator — pure and deterministic.
 *
 * One constant weekly routine is produced for a semester and repeated for the teaching weeks.
 * The teaching week is Sunday to Friday (Saturday is the weekend in Nepal).
 *
 * Each module offering runs as a lecture plus a tutorial and/or a workshop, and each year of
 * study has its own pair of days for each of those, so the three years never compete for the
 * same rooms at the same time:
 *
 * | Year | Lecture     | Tutorial    | Workshop    |
 * |------|-------------|-------------|-------------|
 * | 1    | Sun · Mon   | Tue · Wed   | Thu · Fri   |
 * | 2    | Tue · Wed   | Thu · Fri   | Sun · Mon   |
 * | 3    | Thu · Fri   | Sun · Mon   | Tue · Wed   |
 *
 * A period can be used only if the section, the teacher and the room are all free, and only if
 * it respects the section's constraints: final-year groups finish by 10:00, and nobody gets a gap
 * longer than two hours between classes on the same day. Unplaceable sessions are reported,
 * never dropped silently.
 */

/** A class kind. Lectures are whole-section; tutorials and workshops are the applied hours. */
export type ClassKind = 'LECTURE' | 'TUTORIAL' | 'WORKSHOP';
export const CLASS_KINDS: readonly ClassKind[] = ['LECTURE', 'TUTORIAL', 'WORKSHOP'];
export const CLASS_KIND_LABEL: Record<ClassKind, string> = { LECTURE: 'Lecture', TUTORIAL: 'Tutorial', WORKSHOP: 'Workshop' };

/** ISO weekday numbers for the Sunday–Friday teaching week. */
export const SUN = 7, MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5;
/** Working days in teaching order, Sunday first. */
export const TEACHING_DAYS = [SUN, MON, TUE, WED, THU, FRI];

/** Each year of study gets its own days for each class kind, so the years never collide. */
export const DAY_PATTERN: Record<number, Record<ClassKind, number[]>> = {
  1: { LECTURE: [SUN, MON], TUTORIAL: [TUE, WED], WORKSHOP: [THU, FRI] },
  2: { LECTURE: [TUE, WED], TUTORIAL: [THU, FRI], WORKSHOP: [SUN, MON] },
  3: { LECTURE: [THU, FRI], TUTORIAL: [SUN, MON], WORKSHOP: [TUE, WED] },
};

/** Year of study from the semester number: 1–2 → year 1, 3–4 → year 2, 5–6 → year 3. */
export const yearOfSemester = (semesterNumber: number) => Math.min(3, Math.max(1, Math.ceil(semesterNumber / 2)));
export const daysFor = (year: number, kind: ClassKind) => DAY_PATTERN[Math.min(3, Math.max(1, year))][kind];

/**
 * Weekly sessions for a module: every module has a lecture; a 30-credit module also has both a
 * tutorial and a workshop, a 15-credit one alternates between the two so the week stays balanced.
 */
export function sessionsFor(credits = 15, index = 0): ClassKind[] {
  if (credits >= 30) return ['LECTURE', 'TUTORIAL', 'WORKSHOP'];
  return ['LECTURE', index % 2 === 0 ? 'TUTORIAL' : 'WORKSHOP'];
}

export interface Period {
  dayOfWeek: number; // 7 = Sunday, 1 = Monday … 5 = Friday (Sat is the weekend)
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
  /** Year of study (1–3); picks the lecture/tutorial/workshop day pattern. */
  year?: number;
}

export interface TtOffering {
  id: string;
  code: string;
  /** Teacher used when the offering has no per-section pair. */
  teacherId: string;
  /** The module's teachers (usually two). Sections are shared out between them in turn. */
  teacherIds?: string[];
  credits?: number;
  /** Overrides the kinds derived from the credits. */
  sessions?: ClassKind[];
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
  kind: ClassKind;
  teacherId: string;
  venueId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface TtResult {
  slots: TtSlot[];
  unplaced: { sectionId: string; offeringId: string; kind: ClassKind; missing: number; reason: string }[];
  gapViolations: GapViolation[];
}

const grid = (times: [string, string][]): Period[] =>
  TEACHING_DAYS.flatMap((day) => times.map(([startTime, endTime]) => ({ dayOfWeek: day, startTime, endTime })));

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
    const year = section.year;

    orderedOfferings.forEach((offering, oi) => {
      // Two teachers share a module: section A goes to the first, B to the second, and so on.
      const pool = offering.teacherIds?.length ? offering.teacherIds : [offering.teacherId];
      const teacherId = pool[si % pool.length];
      const kinds = offering.sessions ?? sessionsFor(offering.credits, oi);

      kinds.forEach((kind, ki) => {
        // A kind is pinned to its year's two days; without a year every working day is allowed.
        const allowed = year ? daysFor(year, kind) : TEACHING_DAYS;
        const onPattern = periods.filter((p) => allowed.includes(p.dayOfWeek));
        const usedDays = new Set<number>();
        let placed = 0;
        let blocked = 'no free period with a room, teacher and section all available';
        const need = 1;

        // pass 1: stay on the year's days for this kind and keep the day compact;
        // pass 2: same days, allow a longer gap; pass 3: any working day (reported as off-pattern).
        for (const [pool2, respectGap] of [[onPattern, true], [onPattern, false], [periods, false]] as const) {
          if (!pool2.length) continue;
          const start = (si * 3 + oi * 7 + ki * 5) % pool2.length;
          for (let i = 0; i < pool2.length && placed < need; i++) {
            const p = pool2[(start + i) % pool2.length];
            if (usedDays.has(p.dayOfWeek)) continue;
            if (sectionBusy.busy(section.id, p)) continue;
            if (teacherBusy.busy(teacherId, p)) continue;
            if (respectGap && breaksGapRule(sectionBusy.get(section.id), p, maxGap)) {
              blocked = `only periods that would leave a gap longer than ${maxGap / 60} h were free`;
              continue;
            }
            const room = orderedRooms.find((r) => r.capacity >= section.size && !roomBusy.busy(r.id, p));
            if (!room) {
              blocked = 'no room of the right size was free';
              continue;
            }
            slots.push({ sectionId: section.id, offeringId: offering.id, kind, teacherId, venueId: room.id, dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime });
            sectionBusy.add(section.id, p);
            teacherBusy.add(teacherId, p);
            roomBusy.add(room.id, p);
            placed++;
          }
          if (placed >= need) break;
        }
        if (placed < need) unplaced.push({ sectionId: section.id, offeringId: offering.id, kind, missing: need - placed, reason: blocked });
      });
    });
  });

  // The fallback passes can leave a hole in a section's day. The two-hour rule is a promise to
  // students rather than a preference, so pull those classes earlier where the section, the
  // teacher and a room are all free. Moves stay on the same day, so the year's pattern holds.
  compactGaps(slots, sections, rooms, periodsOrUndefined, existing);

  const ordered = slots.sort((a, b) => a.dayOfWeek - b.dayOfWeek || toMinutes(a.startTime) - toMinutes(b.startTime) || a.sectionId.localeCompare(b.sectionId));
  const gapMap = new Map(sections.map((s) => [s.id, s.maxGapMinutes ?? DEFAULT_MAX_GAP_MIN]));
  const gapViolations = findGapViolations(ordered).filter((v) => v.gapMinutes > (gapMap.get(v.sectionId) ?? DEFAULT_MAX_GAP_MIN));
  return { slots: ordered, unplaced, gapViolations };
}

/** Close gaps left by the fallback passes by moving the class after the hole earlier. */
function compactGaps(slots: TtSlot[], sections: TtSection[], rooms: TtRoom[], periodsOrUndefined: Period[] | undefined, existing: ExistingBooking[]): void {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const smallestFirst = [...rooms].sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name));

  for (let pass = 0; pass < 4; pass++) {
    const gaps = findGapViolations(slots).filter((g) => g.gapMinutes > (byId.get(g.sectionId)?.maxGapMinutes ?? DEFAULT_MAX_GAP_MIN));
    if (!gaps.length) return;
    let moved = false;

    for (const g of gaps) {
      const section = byId.get(g.sectionId);
      const i = slots.findIndex((s) => s.sectionId === g.sectionId && s.dayOfWeek === g.dayOfWeek && s.startTime === g.before);
      if (i < 0) continue;
      const slot = slots[i];

      // Everything booked apart from the class we are trying to move.
      const others = slots.filter((_, j) => j !== i);
      const busy = (key: 'sectionId' | 'teacherId' | 'venueId', value: string | null, p: Period) =>
        value !== null &&
        (others.some((s) => s[key] === value && s.dayOfWeek === p.dayOfWeek && overlaps(s.startTime, s.endTime, p.startTime, p.endTime)) ||
          existing.some((b) => (key === 'sectionId' ? b.sectionId : key === 'teacherId' ? b.teacherId : b.venueId) === value && b.dayOfWeek === p.dayOfWeek && overlaps(b.startTime, b.endTime, p.startTime, p.endTime)));

      // Only earlier periods inside the hole are worth trying — they are what closes it.
      const candidates = (section?.periods ?? periodsOrUndefined ?? STANDARD_PERIODS)
        .filter((p) => p.dayOfWeek === g.dayOfWeek)
        .filter((p) => !section?.latestEnd || toMinutes(p.endTime) <= toMinutes(section.latestEnd))
        .filter((p) => toMinutes(p.startTime) >= toMinutes(g.after) && toMinutes(p.startTime) < toMinutes(g.before))
        .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

      for (const p of candidates) {
        if (busy('sectionId', slot.sectionId, p) || busy('teacherId', slot.teacherId, p)) continue;
        const room = busy('venueId', slot.venueId, p) ? smallestFirst.find((r) => r.capacity >= (section?.size ?? 0) && !busy('venueId', r.id, p)) : { id: slot.venueId };
        if (!room) continue;
        slots[i] = { ...slot, startTime: p.startTime, endTime: p.endTime, venueId: room.id };
        moved = true;
        break;
      }
    }
    if (!moved) return;
  }
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
  /** False when the day is not one of this year's days for the class kind. */
  onPattern?: boolean;
}

/**
 * Free places a class could move to — used when a drag-and-drop lands on a clash, so the
 * UI can offer "put it here instead" rather than just refusing.
 */
export function suggestSlots(args: {
  periods: Period[];
  section: { id: string; size: number; latestEnd?: string; maxGapMinutes?: number; year?: number };
  teacherId: string;
  currentVenueId?: string | null;
  rooms: TtRoom[];
  existing: ExistingBooking[]; // every other booking in the same weeks (excluding the slot being moved)
  /** When given with the section's year, only that kind's days are offered. */
  kind?: ClassKind;
  limit?: number;
}): SlotCandidate[] {
  const { periods, section, teacherId, currentVenueId, rooms, existing, kind, limit = 8 } = args;
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
  const onPattern = kind && section.year ? daysFor(section.year, kind) : null;
  const usable = periods
    .filter((p) => !section.latestEnd || toMinutes(p.endTime) <= toMinutes(section.latestEnd))
    // the year's own days for this kind come first, but a day off the pattern is still offered
    .sort((a, b) => (onPattern ? Number(onPattern.includes(b.dayOfWeek)) - Number(onPattern.includes(a.dayOfWeek)) : 0));
  const out: SlotCandidate[] = [];
  for (const p of usable) {
    if (sectionBusy.busy(section.id, p) || teacherBusy.busy(teacherId, p)) continue;
    const free = rooms.filter((r) => r.capacity >= section.size && !roomBusy.busy(r.id, p)).sort((a, b) => Number(b.id === currentVenueId) - Number(a.id === currentVenueId) || a.capacity - b.capacity || a.name.localeCompare(b.name));
    const room = free[0];
    if (!room) continue;
    out.push({ dayOfWeek: p.dayOfWeek, startTime: p.startTime, endTime: p.endTime, venueId: room.id, venueName: room.name, keepsRoom: room.id === currentVenueId, createsGap: breaksGapRule(sectionBusy.get(section.id), p, maxGap), onPattern: !onPattern || onPattern.includes(p.dayOfWeek) });
  }
  return out
    .sort((a, b) => Number(a.createsGap) - Number(b.createsGap) || Number(b.keepsRoom) - Number(a.keepsRoom) || a.dayOfWeek - b.dayOfWeek || toMinutes(a.startTime) - toMinutes(b.startTime))
    .slice(0, limit);
}

/** Concrete calendar date of a weekly slot in week `week` (1-based) of a semester starting on `semesterStart`. */
/**
 * The calendar date of one weekday in one teaching week.
 *
 * Weeks run Sunday to Saturday because the teaching week here is Sunday to Friday, so week 1 is
 * the week containing the semester's start date, counted from its Sunday. `dayOfWeek` is the ISO
 * number (1 = Monday … 7 = Sunday).
 */
export function slotDate(semesterStart: Date, week: number, dayOfWeek: number): Date {
  const start = new Date(semesterStart);
  const sunday = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - start.getUTCDay()));
  const indexInWeek = dayOfWeek === 7 ? 0 : dayOfWeek; // Sunday first
  return new Date(sunday.getTime() + ((week - 1) * 7 + indexInWeek) * 86400e3);
}

/** Week number (1-based) of a date within a semester, or null when outside the teaching weeks. */
export function weekOf(semesterStart: Date, date: Date, teachingWeeks: number): number | null {
  const sunday = slotDate(semesterStart, 1, 7);
  const diff = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - sunday.getTime()) / 86400e3);
  if (diff < 0) return null;
  const week = Math.floor(diff / 7) + 1;
  return week <= teachingWeeks ? week : null;
}
