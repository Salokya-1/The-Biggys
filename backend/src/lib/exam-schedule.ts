/**
 * Exam-window scheduler — pure and deterministic.
 *
 * Every module offering gets one exam inside the two-week exam window (weekdays, two slots a day).
 * Offerings from the same semester share students, so they never share a slot. Venues are filled
 * largest-first until capacity covers the candidates. Each venue gets one invigilator: a teacher who
 * does not teach that module and is free in that slot (round-robin so the load is spread).
 */

export interface ExOffering {
  id: string;
  code: string;
  semesterId: string;
  candidates: number;
  teacherId: string | null;
}

export interface ExVenue {
  id: string;
  name: string;
  capacity: number;
  examHall: boolean; // prefer halls (isClassroom = false) first
}

export interface ExTeacher {
  id: string;
  name: string;
}

export interface ExamSlotSpec {
  date: Date;
  startTime: string;
}

export interface ScheduledExam {
  offeringIds: string[];
  semesterId: string;
  date: Date;
  startTime: string;
  durationMin: number;
  venueIds: string[];
  invigilators: { venueId: string; userId: string }[];
  candidates: number;
}

export interface ExamScheduleResult {
  sessions: ScheduledExam[];
  unscheduled: { offeringId: string; reason: string }[];
  warnings: string[];
}

/** Weekday slots across the exam window: Mon–Fri, 09:00 and 13:00. */
export function examSlots(examStart: Date, examEnd: Date, times: string[] = ['09:00', '13:00']): ExamSlotSpec[] {
  const out: ExamSlotSpec[] = [];
  for (let t = examStart.getTime(); t < examEnd.getTime(); t += 86400e3) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const startTime of times) out.push({ date: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), startTime });
  }
  return out;
}

export function generateExamSchedule(offerings: ExOffering[], venues: ExVenue[], teachers: ExTeacher[], slots: ExamSlotSpec[], durationMin = 120): ExamScheduleResult {
  const sessions: ScheduledExam[] = [];
  const unscheduled: ExamScheduleResult['unscheduled'] = [];
  const warnings: string[] = [];
  const slotKey = (s: ExamSlotSpec) => `${s.date.toISOString().slice(0, 10)} ${s.startTime}`;
  const venueUse = new Map<string, Set<string>>(); // slot -> venue ids
  const teacherUse = new Map<string, Set<string>>(); // slot -> teacher ids
  const semesterUse = new Map<string, Set<string>>(); // slot -> semester ids (students of one semester sit one exam per slot)
  const teacherLoad = new Map(teachers.map((t) => [t.id, 0]));
  const set = (m: Map<string, Set<string>>, k: string) => m.get(k) ?? m.set(k, new Set()).get(k)!;

  const orderedVenues = [...venues].sort((a, b) => Number(b.examHall) - Number(a.examHall) || b.capacity - a.capacity || a.name.localeCompare(b.name));
  // biggest cohorts first so they get the halls
  const ordered = [...offerings].sort((a, b) => b.candidates - a.candidates || a.code.localeCompare(b.code));
  const totalCapacity = venues.reduce((n, v) => n + v.capacity, 0);

  let cursor = 0;
  for (const off of ordered) {
    if (off.candidates === 0) {
      unscheduled.push({ offeringId: off.id, reason: 'no enrolled students' });
      continue;
    }
    if (off.candidates > totalCapacity) {
      unscheduled.push({ offeringId: off.id, reason: `${off.candidates} candidates exceed total venue capacity ${totalCapacity}` });
      continue;
    }
    let placed = false;
    for (let i = 0; i < slots.length && !placed; i++) {
      const slot = slots[(cursor + i) % slots.length];
      const k = slotKey(slot);
      if (set(semesterUse, k).has(off.semesterId)) continue;
      const used = set(venueUse, k);
      const chosen: ExVenue[] = [];
      let cap = 0;
      for (const v of orderedVenues) {
        if (used.has(v.id)) continue;
        chosen.push(v);
        cap += v.capacity;
        if (cap >= off.candidates) break;
      }
      if (cap < off.candidates) continue;
      // invigilators: one per venue, not the module's own teacher, free in this slot, least loaded first
      const busyTeachers = set(teacherUse, k);
      const invigilators: { venueId: string; userId: string }[] = [];
      for (const v of chosen) {
        const candidate = [...teachers]
          .filter((t) => t.id !== off.teacherId && !busyTeachers.has(t.id) && !invigilators.some((x) => x.userId === t.id))
          .sort((a, b) => teacherLoad.get(a.id)! - teacherLoad.get(b.id)! || a.name.localeCompare(b.name))[0];
        if (!candidate) {
          warnings.push(`${off.code} ${k}: no free invigilator for ${v.name}`);
          continue;
        }
        invigilators.push({ venueId: v.id, userId: candidate.id });
        teacherLoad.set(candidate.id, teacherLoad.get(candidate.id)! + 1);
      }
      for (const v of chosen) used.add(v.id);
      for (const inv of invigilators) busyTeachers.add(inv.userId);
      set(semesterUse, k).add(off.semesterId);
      sessions.push({ offeringIds: [off.id], semesterId: off.semesterId, date: slot.date, startTime: slot.startTime, durationMin, venueIds: chosen.map((v) => v.id), invigilators, candidates: off.candidates });
      cursor = (cursor + i + 1) % slots.length;
      placed = true;
    }
    if (!placed) unscheduled.push({ offeringId: off.id, reason: 'no slot with enough free venue capacity in the exam window' });
  }
  return { sessions: sessions.sort((a, b) => a.date.getTime() - b.date.getTime() || a.startTime.localeCompare(b.startTime)), unscheduled, warnings };
}
