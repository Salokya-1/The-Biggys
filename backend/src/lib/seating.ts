/**
 * Exam seating engine — pure and deterministic for a given seed.
 *
 * Constraints, in order:
 *  1. capacity (disabled seats are never used; overflow is returned as `unseated`, never silently dropped)
 *  2. no two students of the same module offering in adjacent seats (left/right, plus front/back when the
 *     venue's adjacencyMode is ROW_AND_COLUMN) — only matters when modules share a venue
 *  3. special-needs students get front-row or aisle seats
 *  4. reproducible for a given seed; 5. stable seat labels A1…, B1…
 */

export interface SeatVenue {
  id: string;
  name: string;
  rows: number;
  cols: number;
  disabledSeats: { row: number; col: number }[];
  adjacencyMode: 'ROW' | 'ROW_AND_COLUMN';
}

export interface SeatStudent {
  studentId: string; // Student.id
  label: string; // institutional ID
  name: string;
  offeringId: string;
  moduleCode: string;
  specialNeeds: boolean;
}

export interface Allocation {
  venueId: string;
  studentId: string;
  offeringId: string;
  row: number;
  col: number;
  seatLabel: string;
}

export interface Violation {
  venueId: string;
  a: string;
  b: string;
  seatA: string;
  seatB: string;
}

export interface VenueSummary {
  venueId: string;
  name: string;
  capacity: number;
  used: number;
  violations: number;
  byOffering: Record<string, number>;
}

export interface SeatingResult {
  allocations: Allocation[];
  unseated: SeatStudent[];
  violations: Violation[];
  venues: VenueSummary[];
}

export function seatLabel(row: number, col: number): string {
  let r = row;
  let letters = '';
  while (r > 0) {
    const rem = (r - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    r = Math.floor((r - 1) / 26);
  }
  return `${letters}${col}`;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Seat {
  row: number;
  col: number;
}

export function usableSeats(v: SeatVenue): Seat[] {
  const disabled = new Set(v.disabledSeats.map((d) => `${d.row}:${d.col}`));
  const seats: Seat[] = [];
  for (let r = 1; r <= v.rows; r++) for (let c = 1; c <= v.cols; c++) if (!disabled.has(`${r}:${c}`)) seats.push({ row: r, col: c });
  return seats;
}

export function capacityOf(v: SeatVenue): number {
  return usableSeats(v).length;
}

const isPriority = (v: SeatVenue, s: Seat) => s.row === 1 || s.col === 1 || s.col === v.cols;

function neighbours(v: SeatVenue, s: Seat): Seat[] {
  const out: Seat[] = [{ row: s.row, col: s.col - 1 }, { row: s.row, col: s.col + 1 }];
  if (v.adjacencyMode === 'ROW_AND_COLUMN') out.push({ row: s.row - 1, col: s.col }, { row: s.row + 1, col: s.col });
  return out.filter((n) => n.row >= 1 && n.row <= v.rows && n.col >= 1 && n.col <= v.cols);
}

/** Largest set of mutually non-adjacent seats (checkerboard) — the most one module can take without violations. */
export function maxPerModule(v: SeatVenue): number {
  return Math.ceil(capacityOf(v) / 2);
}

/**
 * Split students across venues (largest venue first). Module mix stays proportional and, when other venues
 * still have room, no module exceeds the venue's non-adjacent maximum. Capacity always wins over adjacency:
 * if there is nowhere else to put people, they are still seated (violations are reported, never hidden).
 */
function partition(venues: SeatVenue[], groups: Map<string, SeatStudent[]>): { venue: SeatVenue; pool: Map<string, SeatStudent[]> }[] {
  const remaining = new Map([...groups.entries()].map(([k, v]) => [k, [...v]]));
  const plan: { venue: SeatVenue; pool: Map<string, SeatStudent[]> }[] = [];
  const totalCapacity = venues.reduce((s, v) => s + capacityOf(v), 0);
  let capacityLeft = totalCapacity;

  for (const venue of venues) {
    const cap = capacityOf(venue);
    const total = [...remaining.values()].reduce((s, g) => s + g.length, 0);
    if (total === 0) break;
    const take = Math.min(cap, total);
    const otherCapacity = capacityLeft - cap;
    const modulesHere = [...remaining.entries()].filter(([, g]) => g.length > 0).length;
    const bound = modulesHere > 1 ? maxPerModule(venue) : cap;

    // largest-remainder apportionment, then clamp to the adjacency bound when the overflow can go elsewhere
    const entries = [...remaining.entries()].filter(([, g]) => g.length > 0);
    const raw = entries.map(([k, g]) => ({ k, exact: (g.length / total) * take }));
    const counts = new Map(raw.map((r) => [r.k, Math.floor(r.exact)]));
    let left = take - [...counts.values()].reduce((s, n) => s + n, 0);
    for (const r of [...raw].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)))) {
      if (left <= 0) break;
      counts.set(r.k, counts.get(r.k)! + 1);
      left--;
    }
    let surplus = 0;
    for (const [k, n] of counts) {
      if (n > bound) {
        surplus += n - bound;
        counts.set(k, bound);
      }
    }
    // redistribute surplus to modules under their bound; whatever cannot fit here goes to later venues if they exist
    for (const [k, n] of [...counts.entries()].sort((a, b) => a[1] - b[1])) {
      if (surplus <= 0) break;
      const room = Math.min(bound - n, remaining.get(k)!.length - n);
      if (room > 0) {
        const add = Math.min(room, surplus);
        counts.set(k, n + add);
        surplus -= add;
      }
    }
    if (surplus > 0 && otherCapacity < surplus) {
      // no room elsewhere: seat them here anyway (capacity beats adjacency)
      for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
        const room = remaining.get(k)!.length - n;
        const add = Math.min(room, surplus);
        counts.set(k, n + add);
        surplus -= add;
        if (surplus <= 0) break;
      }
    }

    const pool = new Map<string, SeatStudent[]>();
    for (const [k, n] of counts) pool.set(k, remaining.get(k)!.splice(0, n));
    plan.push({ venue, pool });
    capacityLeft -= cap;
  }
  return plan;
}

function fillVenue(venue: SeatVenue, pool: Map<string, SeatStudent[]>, rnd: () => number): { placed: Allocation[]; leftover: SeatStudent[] } {
  const seats = usableSeats(venue);
  const grid = new Map<string, SeatStudent>(); // "r:c" -> student
  const key = (s: Seat) => `${s.row}:${s.col}`;
  const offeringAt = (s: Seat) => grid.get(key(s))?.offeringId;
  const conflicts = (s: Seat, offeringId: string) => neighbours(venue, s).some((n) => offeringAt(n) === offeringId);

  // Queue per offering, shuffled deterministically; special-needs first within each queue.
  const queues = new Map<string, SeatStudent[]>();
  for (const [k, g] of pool) {
    const shuffled = shuffle(g, rnd);
    queues.set(k, [...shuffled.filter((s) => s.specialNeeds), ...shuffled.filter((s) => !s.specialNeeds)]);
  }
  const multiModule = [...queues.keys()].filter((k) => queues.get(k)!.length > 0).length > 1;

  const pickFor = (seat: Seat, onlySpecial: boolean): SeatStudent | null => {
    const candidates = [...queues.entries()]
      .filter(([, q]) => q.length > 0 && (!onlySpecial || q[0].specialNeeds))
      .sort((a, b) => b[1].length - a[1].length); // largest remaining first keeps the mix balanced
    if (candidates.length === 0) return null;
    const ok = candidates.find(([k]) => !multiModule || !conflicts(seat, k));
    const [k, q] = ok ?? candidates[0];
    return q.shift()!;
  };

  // Pass 1: special-needs students into priority seats (front row, then aisles).
  const priority = seats.filter((s) => isPriority(venue, s)).sort((a, b) => a.row - b.row || a.col - b.col);
  for (const seat of priority) {
    const anySpecial = [...queues.values()].some((q) => q[0]?.specialNeeds);
    if (!anySpecial) break;
    const st = pickFor(seat, true);
    if (st) grid.set(key(seat), st);
  }
  // Pass 2: everyone else, row-major. With spare seats we leave a gap rather than create a clash.
  const toPlace = () => [...queues.values()].reduce((s, q) => s + q.length, 0);
  let slack = seats.filter((s) => !grid.has(key(s))).length - toPlace();
  for (const seat of seats) {
    if (grid.has(key(seat))) continue;
    if (toPlace() === 0) break;
    const conflictFree = [...queues.entries()].some(([k, q]) => q.length > 0 && (!multiModule || !conflicts(seat, k)));
    if (!conflictFree && slack > 0) {
      slack--;
      continue;
    }
    const st = pickFor(seat, false);
    if (!st) break;
    grid.set(key(seat), st);
  }

  // Repair: move a clashing student to an empty seat, or swap with a student of another module (bounded).
  if (multiModule) {
    for (let pass = 0; pass < 4; pass++) {
      let fixed = 0;
      for (const seat of seats) {
        const st = grid.get(key(seat));
        if (!st || !conflicts(seat, st.offeringId)) continue;
        let done = false;
        for (const other of seats) {
          if (grid.has(key(other))) continue;
          if (st.specialNeeds && !isPriority(venue, other)) continue;
          grid.delete(key(seat));
          if (!conflicts(other, st.offeringId)) {
            grid.set(key(other), st);
            done = true;
            break;
          }
          grid.set(key(seat), st);
        }
        if (!done) {
          for (const other of seats) {
            const o = grid.get(key(other));
            if (!o || o.offeringId === st.offeringId) continue;
            if (o.specialNeeds !== st.specialNeeds) continue; // keep special-needs in priority seats
            grid.set(key(seat), o);
            grid.set(key(other), st);
            if (!conflicts(seat, o.offeringId) && !conflicts(other, st.offeringId)) {
              done = true;
              break;
            }
            grid.set(key(seat), st);
            grid.set(key(other), o);
          }
        }
        if (done) fixed++;
      }
      if (fixed === 0) break;
    }
  }

  const placed: Allocation[] = [];
  for (const seat of seats) {
    const st = grid.get(key(seat));
    if (st) placed.push({ venueId: venue.id, studentId: st.studentId, offeringId: st.offeringId, row: seat.row, col: seat.col, seatLabel: seatLabel(seat.row, seat.col) });
  }
  const leftover = [...queues.values()].flat();
  return { placed, leftover };
}

export function findViolations(venue: SeatVenue, allocations: Allocation[]): Violation[] {
  const byPos = new Map(allocations.filter((a) => a.venueId === venue.id).map((a) => [`${a.row}:${a.col}`, a]));
  const out: Violation[] = [];
  const seen = new Set<string>();
  for (const a of byPos.values()) {
    for (const n of neighbours(venue, { row: a.row, col: a.col })) {
      const b = byPos.get(`${n.row}:${n.col}`);
      if (!b || b.offeringId !== a.offeringId) continue;
      const k = [a.studentId, b.studentId].sort().join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ venueId: venue.id, a: a.studentId, b: b.studentId, seatA: a.seatLabel, seatB: b.seatLabel });
    }
  }
  return out;
}

export function generateSeating(venuesIn: SeatVenue[], students: SeatStudent[], seed = 1): SeatingResult {
  const rnd = mulberry32(seed || 1);
  const venues = [...venuesIn].sort((a, b) => capacityOf(b) - capacityOf(a) || a.name.localeCompare(b.name));
  const groups = new Map<string, SeatStudent[]>();
  for (const s of [...students].sort((a, b) => a.label.localeCompare(b.label))) {
    if (!groups.has(s.offeringId)) groups.set(s.offeringId, []);
    groups.get(s.offeringId)!.push(s);
  }
  const ordered = new Map([...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])));

  const plan = partition(venues, ordered);
  const allocations: Allocation[] = [];
  let leftover: SeatStudent[] = [];
  const plannedIds = new Set<string>();
  for (const { venue, pool } of plan) {
    for (const g of pool.values()) for (const s of g) plannedIds.add(s.studentId);
    const r = fillVenue(venue, pool, rnd);
    allocations.push(...r.placed);
    leftover = leftover.concat(r.leftover);
  }
  const unplanned = students.filter((s) => !plannedIds.has(s.studentId));
  const unseated = [...leftover, ...unplanned].sort((a, b) => a.label.localeCompare(b.label));

  // Single-module venues have no adjacency rule; only report cross-module venues.
  const violations = venues.flatMap((v) => {
    const offeringsHere = new Set(allocations.filter((a) => a.venueId === v.id).map((a) => a.offeringId));
    return offeringsHere.size > 1 ? findViolations(v, allocations) : [];
  });
  const summaries: VenueSummary[] = venues.map((v) => {
    const here = allocations.filter((a) => a.venueId === v.id);
    const byOffering: Record<string, number> = {};
    for (const a of here) byOffering[a.offeringId] = (byOffering[a.offeringId] ?? 0) + 1;
    return { venueId: v.id, name: v.name, capacity: capacityOf(v), used: here.length, violations: violations.filter((x) => x.venueId === v.id).length, byOffering };
  });
  return { allocations, unseated, violations, venues: summaries };
}
