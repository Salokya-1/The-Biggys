import { randomUUID } from 'node:crypto';
import { PrismaClient, type ClassKind, type RoomType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { computeGrade, type ComponentSpec } from '../lib/grading';
import { generateSeating, type SeatStudent, type SeatVenue } from '../lib/seating';

/**
 * A walk-through built on a real document.
 *
 * The demo data is generated, which is fine for volume but proves nothing about whether the system
 * matches how the college actually runs. This lays the published Level 6 Networking schedule
 * (Autumn 2026, group N3) over the Sep 2024 Networking cohort exactly as printed — same days,
 * same times, same lecturers, same rooms, same combined groups — and puts one student, Biggy
 * Ghimire, through the whole of it: two years of published results, this term's classes, an exam
 * with a seat, a paid fee and an admit card.
 *
 * Additive and repeatable. It never truncates: run it twice and you get the same one student, the
 * same five classes and the same exam, because everything is matched on a natural key first.
 */

/** Monday = 1 … Sunday = 7, the way the timetable stores a day. */
const SUN = 7, TUE = 2, WED = 3, THU = 4, FRI = 5;

interface Row {
  day: number;
  start: string;
  end: string;
  kind: ClassKind;
  code: string;
  title: string;
  lecturer: string;
  /** Groups sharing the room. A cohort lecture lists them all; a workshop is one group. */
  groups: 'ALL' | string[];
  room: string;
  building: string;
  roomType: RoomType;
}

/** The schedule as printed. Nothing here is inferred. */
const ROUTINE: Row[] = [
  { day: SUN, start: '06:30', end: '08:30', kind: 'WORKSHOP', code: 'CT6009', title: 'Enterprise Networking Security and Automation', lecturer: 'Mr. Raman Pradhananga', groups: ['N3'], room: 'Lab 02 - Ams Ghimire', building: 'Skill', roomType: 'LAB' },
  { day: TUE, start: '06:30', end: '08:30', kind: 'WORKSHOP', code: 'CC6011', title: 'Digital Investigation and E-Discovery', lecturer: 'Mr. Anuj Shilpakar', groups: ['N3'], room: 'TR06 - Annapurna', building: 'Nepal', roomType: 'TUTORIAL_ROOM' },
  { day: WED, start: '06:30', end: '08:00', kind: 'LECTURE', code: 'CS6W50', title: 'Career Development Learning', lecturer: 'Mr. Bibek Baral', groups: ['N1', 'N2', 'N3'], room: 'LT03 - Westminster Palace', building: 'London', roomType: 'LECTURE_THEATRE' },
  { day: THU, start: '06:30', end: '08:00', kind: 'LECTURE', code: 'CC6011', title: 'Digital Investigation and E-Discovery', lecturer: 'Mr. Anuj Shilpakar', groups: 'ALL', room: 'Hall - 01', building: 'Kumari', roomType: 'HALL' },
  { day: FRI, start: '08:00', end: '09:30', kind: 'LECTURE', code: 'CT6009', title: 'Enterprise Networking, Security and Automation', lecturer: 'Mr. Raman Pradhananga', groups: 'ALL', room: 'Hall - 01', building: 'Kumari', roomType: 'HALL' },
];

/** The named teacher, plus the three the schedule names. */
const STAFF = [
  { name: 'Mr. Sujal Shiwakoti', email: 'sujal.shiwakoti@demo' },
  { name: 'Mr. Raman Pradhananga', email: 'raman.pradhananga@demo' },
  { name: 'Mr. Anuj Shilpakar', email: 'anuj.shilpakar@demo' },
  { name: 'Mr. Bibek Baral', email: 'bibek.baral@demo' },
];

const HERO = { studentId: '24030777', name: 'Biggy Ghimire', email: 'biggy@demo', group: 'N3' };

/** Extra Networking names, so N3 reads like a real group rather than one person and a gap. */
const CLASSMATES = [
  'Aayush Gurung', 'Sneha Bajracharya', 'Nirajan Shrestha', 'Prerana Maharjan', 'Sujan Tamang',
  'Riya Pradhan', 'Bibek Chaudhary', 'Alisha Rai', 'Sandesh Bhandari', 'Muna Lamichhane',
  'Rojan Karki', 'Sushmita Thapa',
];

/**
 * A well-mixed value in [0,1) from an integer.
 *
 * Taking the first output of a freshly seeded linear generator is not random at all: seeds that
 * differ by a small step give outputs that differ by a small step, so a per-student, per-week
 * "did they turn up" test came out the same way every week and the struggling students attended
 * nothing whatsoever. This mixes properly before it is asked for a decision.
 */
export function hashUnit(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 2246822507);
  x = Math.imul(x ^ (x >>> 13), 3266489909);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Deterministic pseudo-randomness: the same run gives the same marks, every time. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export interface ScenarioReport {
  student: { id: string; studentId: string; name: string; login: string };
  teacher: { id: string; name: string; login: string };
  classmatesAdded: number;
  classes: string[];
  publishedResults: number;
  currentModules: string[];
  exam: { title: string; date: string; seat: string | null; venue: string | null } | null;
  admitCard: string | null;
  attendanceMarked: number;
  warnings: string[];
}

export async function runScenario(prisma: PrismaClient): Promise<ScenarioReport> {
  const warnings: string[] = [];
  const pw = await bcrypt.hash('Demo1234!', 10);

  // ---- the cohort ------------------------------------------------------------
  const programme = await prisma.programme.findFirst({ where: { code: 'BSCNIS' } });
  if (!programme) throw new Error('BSc Networking is not in this database — seed it first.');
  const intake = await prisma.intake.findFirst({
    where: { programmeId: programme.id, label: 'Sep 2024' },
    include: { semesters: { orderBy: { number: 'asc' } }, sections: true },
  });
  if (!intake) throw new Error('The Sep 2024 Networking intake is missing — seed it first.');

  const current = intake.semesters[intake.semesters.length - 1];
  const section = intake.sections.find((s) => s.name === HERO.group);
  if (!section) throw new Error(`Group ${HERO.group} does not exist in the Sep 2024 Networking intake.`);
  const allSections = [...intake.sections].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  // ---- staff -----------------------------------------------------------------
  const staffByName = new Map<string, { id: string; name: string }>();
  for (const s of STAFF) {
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: { name: s.name, isActive: true },
      create: { email: s.email, name: s.name, role: 'LECTURER', passwordHash: pw },
      select: { id: true, name: true },
    });
    staffByName.set(s.name, user);
  }
  const sujal = staffByName.get('Mr. Sujal Shiwakoti')!;

  // ---- rooms, by the names on the schedule -----------------------------------
  const venueByName = new Map<string, { id: string; name: string; rows: number; cols: number; disabledSeats: unknown; adjacencyMode: string }>();
  for (const r of ROUTINE) {
    if (venueByName.has(r.room)) continue;
    let venue = await prisma.venue.findFirst({ where: { name: r.room } });
    if (!venue) {
      const size = r.roomType === 'HALL' ? { rows: 14, cols: 16 } : r.roomType === 'LECTURE_THEATRE' ? { rows: 12, cols: 15 } : r.roomType === 'LAB' ? { rows: 5, cols: 5 } : { rows: 5, cols: 6 };
      venue = await prisma.venue.create({
        data: { name: r.room, building: r.building, roomType: r.roomType, ...size, isClassroom: true, adjacencyMode: 'ROW_AND_COLUMN', disabledSeats: [] },
      });
      warnings.push(`Created room "${r.room}" (${r.building}) — the schedule names it but the estate did not have it.`);
    }
    venueByName.set(r.room, venue as never);
  }

  // ---- this term's offerings, staffed as the schedule says --------------------
  const wanted = [...new Set(ROUTINE.map((r) => r.code))];
  const offeringByCode = new Map<string, { id: string; components: { id: string; name: string; weight: number; maxMark: number; componentPassMark: number | null }[] }>();
  for (const code of wanted) {
    const module = await prisma.module.findFirst({ where: { code, programmeId: programme.id } });
    if (!module) {
      warnings.push(`Module ${code} is not in the Networking catalogue; its classes were skipped.`);
      continue;
    }
    const lecturerName = ROUTINE.find((r) => r.code === code)!.lecturer;
    const lecturer = staffByName.get(lecturerName)!;
    // Sujal Shiwakoti sits alongside the named lecturer on every module this group takes, so the
    // class lists and mark sheets Biggy appears on are ones he can actually open.
    const offering = await prisma.moduleOffering.upsert({
      where: { moduleId_semesterId: { moduleId: module.id, semesterId: current.id } },
      update: { lecturerId: lecturer.id, coLecturerId: sujal.id },
      create: { moduleId: module.id, semesterId: current.id, lecturerId: lecturer.id, coLecturerId: sujal.id },
      select: { id: true, components: { select: { id: true, name: true, weight: true, maxMark: true, componentPassMark: true } } },
    });
    if (offering.components.length === 0) {
      await prisma.assessmentComponent.createMany({
        data: [
          { moduleOfferingId: offering.id, name: 'Coursework', weight: 60, maxMark: 100, sortOrder: 1 },
          { moduleOfferingId: offering.id, name: 'Examination', weight: 40, maxMark: 100, componentPassMark: 30, sortOrder: 2 },
        ],
      });
      offering.components = await prisma.assessmentComponent.findMany({
        where: { moduleOfferingId: offering.id },
        select: { id: true, name: true, weight: true, maxMark: true, componentPassMark: true },
        orderBy: { sortOrder: 'asc' },
      });
    }
    await prisma.module.update({ where: { id: module.id }, data: { moduleLeaderId: sujal.id } });
    offeringByCode.set(code, offering);
  }

  // ---- the student, and company for him --------------------------------------
  async function makeStudent(studentId: string, name: string, email: string | null) {
    const existing = await prisma.student.findUnique({ where: { studentId }, select: { id: true } });
    if (existing) {
      await prisma.student.update({ where: { id: existing.id }, data: { sectionId: section!.id, currentSemesterId: current.id, status: 'ACTIVE', deletedAt: null } });
      return existing.id;
    }
    let userId: string | undefined;
    if (email) {
      const user = await prisma.user.upsert({
        where: { email },
        update: { name, isActive: true },
        create: { email, name, role: 'STUDENT', passwordHash: pw },
        select: { id: true },
      });
      userId = user.id;
    }
    const s = await prisma.student.create({
      data: { studentId, name, email, programmeId: programme!.id, intakeId: intake!.id, sectionId: section!.id, currentSemesterId: current.id, userId },
      select: { id: true },
    });
    return s.id;
  }

  const heroId = await makeStudent(HERO.studentId, HERO.name, HERO.email);
  let classmatesAdded = 0;
  for (const [i, name] of CLASSMATES.entries()) {
    const sid = `2403${String(800 + i).padStart(4, '0')}`.slice(0, 8);
    const before = await prisma.student.findUnique({ where: { studentId: sid }, select: { id: true } });
    await makeStudent(sid, name, null);
    if (!before) classmatesAdded += 1;
  }

  // ---- enrol him on everything his cohort has ever run ------------------------
  const cohortOfferings = await prisma.moduleOffering.findMany({
    where: { semesterId: { in: intake.semesters.map((s) => s.id) } },
    select: { id: true, semesterId: true, module: { select: { code: true } }, components: { select: { id: true, name: true, weight: true, maxMark: true, componentPassMark: true }, orderBy: { sortOrder: 'asc' } } },
  });
  const semNumber = new Map(intake.semesters.map((s) => [s.id, s.number]));

  for (const o of cohortOfferings) {
    await prisma.enrollment.upsert({
      where: { studentId_moduleOfferingId_attempt: { studentId: heroId, moduleOfferingId: o.id, attempt: 1 } },
      update: {},
      create: { studentId: heroId, moduleOfferingId: o.id, attempt: 1 },
    });
  }
  const classmateIds = await prisma.student.findMany({ where: { sectionId: section.id, deletedAt: null }, select: { id: true } });
  const thisTermOfferings = cohortOfferings.filter((o) => o.semesterId === current.id);
  for (const o of thisTermOfferings) {
    for (const s of classmateIds) {
      await prisma.enrollment.upsert({
        where: { studentId_moduleOfferingId_attempt: { studentId: s.id, moduleOfferingId: o.id, attempt: 1 } },
        update: {},
        create: { studentId: s.id, moduleOfferingId: o.id, attempt: 1 },
      });
    }
  }

  // ---- two years of published results ----------------------------------------
  // His marks go onto the sheets his cohort already has, rather than into sheets of his own: a
  // student whose results live somewhere separate is not in the cohort, he is beside it.
  const rnd = seeded(0xb1667);
  let publishedResults = 0;
  for (const o of cohortOfferings) {
    const n = semNumber.get(o.semesterId) ?? 0;
    if (n >= current.number) continue;
    const sheet = await prisma.markSheet.findFirst({
      where: { moduleOfferingId: o.id, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, gradingScheme: { select: { passMark: true, resitCap: true, bands: true } } },
    });
    if (!sheet || o.components.length === 0) continue;
    const enrollment = await prisma.enrollment.findFirst({ where: { studentId: heroId, moduleOfferingId: o.id }, select: { id: true } });
    if (!enrollment) continue;
    if (await prisma.result.findFirst({ where: { enrollmentId: enrollment.id }, select: { id: true } })) {
      publishedResults += 1;
      continue;
    }

    // A capable but human student: mid-sixties, wandering a little module to module.
    const ability = 58 + Math.round(rnd() * 22);
    const marks = o.components.map((c) => ({
      componentId: c.id,
      rawMark: Math.max(0, Math.min(c.maxMark, Math.round(((ability + (rnd() * 16 - 8)) / 100) * c.maxMark * 2) / 2)),
      isAbsent: false,
    }));
    await prisma.mark.createMany({
      data: marks.map((m) => ({ markSheetId: sheet.id, enrollmentId: enrollment.id, componentId: m.componentId, rawMark: m.rawMark, isAbsent: false })),
      skipDuplicates: true,
    });
    const specs: ComponentSpec[] = o.components.map((c) => ({ id: c.id, name: c.name, weight: c.weight, maxMark: c.maxMark, componentPassMark: c.componentPassMark ?? null }));
    const g = computeGrade({
      components: specs,
      marks,
      scheme: { passMark: sheet.gradingScheme?.passMark ?? 40, resitCap: sheet.gradingScheme?.resitCap ?? 40, bands: (sheet.gradingScheme?.bands ?? []) as never },
      attempt: 1,
      isResit: false,
    });
    await prisma.result.create({
      data: { enrollmentId: enrollment.id, markSheetId: sheet.id, markSheetVersion: sheet.version, overallMark: g.overallMark, grade: g.grade, outcome: g.outcome },
    });
    publishedResults += 1;
  }

  // ---- the routine, exactly as printed ---------------------------------------
  const sectionIds = allSections.map((s) => s.id);
  await prisma.timetableSlot.deleteMany({ where: { semesterId: current.id, sectionId: { in: sectionIds } } });

  const classes: string[] = [];
  const DAY = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' } as Record<number, string>;
  for (const r of ROUTINE) {
    const offering = offeringByCode.get(r.code);
    if (!offering) continue;
    const venue = venueByName.get(r.room)!;
    const teacher = staffByName.get(r.lecturer)!;
    const groups = r.groups === 'ALL' ? allSections : allSections.filter((s) => (r.groups as string[]).includes(s.name));
    if (groups.length === 0) {
      warnings.push(`No group matched ${r.groups} for ${r.code}; that row was skipped.`);
      continue;
    }
    const slot = await prisma.timetableSlot.create({
      data: {
        semesterId: current.id,
        sectionId: groups[0].id,
        moduleOfferingId: offering.id,
        teacherId: teacher.id,
        venueId: venue.id,
        kind: r.kind,
        dayOfWeek: r.day,
        startTime: r.start,
        endTime: r.end,
        groups: { connect: groups.map((g) => ({ id: g.id })) },
      },
      select: { id: true },
    });
    void slot;
    classes.push(`${DAY[r.day]} ${r.start}–${r.end} · ${r.kind.toLowerCase()} · ${r.code} · ${groups.map((g) => g.name).join('+')} · ${r.room} · ${r.lecturer}`);
  }

  // ---- an exam he can see a seat for ------------------------------------------
  let exam: ScenarioReport['exam'] = null;
  const examOffering = offeringByCode.get('CT6009');
  const hall = venueByName.get('Hall - 01');
  if (examOffering && hall) {
    const when = new Date(Date.now() + 12 * 86400e3);
    when.setUTCHours(0, 0, 0, 0);
    const title = 'Level 6 Networking · Enterprise Networking, Security and Automation';
    let session = await prisma.examSession.findFirst({ where: { title }, select: { id: true } });
    if (!session) {
      session = await prisma.examSession.create({
        data: {
          title,
          kind: 'FINAL',
          seatingMode: 'MIXED',
          semesterId: current.id,
          date: when,
          startTime: '09:00',
          durationMin: 120,
          generatedBy: 'manual',
          offerings: { connect: [{ id: examOffering.id }] },
          sections: { connect: allSections.map((s) => ({ id: s.id })) },
          venues: { connect: [{ id: hall.id }] },
        },
        select: { id: true },
      });
    } else {
      await prisma.examSession.update({ where: { id: session.id }, data: { date: when } });
    }
    await prisma.examInvigilator.deleteMany({ where: { examSessionId: session.id } });
    await prisma.examInvigilator.create({ data: { examSessionId: session.id, venueId: hall.id, userId: sujal.id } });

    const candidates = await prisma.enrollment.findMany({
      where: { moduleOfferingId: examOffering.id, deletedAt: null, student: { deletedAt: null, status: 'ACTIVE' } },
      select: { student: { select: { id: true, studentId: true, name: true, specialNeedsSeating: true } } },
    });
    const seatStudents: SeatStudent[] = candidates.map((c) => ({
      studentId: c.student.id,
      label: c.student.studentId,
      name: c.student.name,
      offeringId: examOffering.id,
      moduleCode: 'CT6009',
      specialNeeds: c.student.specialNeedsSeating,
    }));
    const seatVenue: SeatVenue = {
      id: hall.id,
      name: hall.name,
      rows: hall.rows,
      cols: hall.cols,
      disabledSeats: (hall.disabledSeats as { row: number; col: number }[]) ?? [],
      adjacencyMode: hall.adjacencyMode as never,
    };
    const seating = generateSeating([seatVenue], seatStudents, 7);
    const runId = randomUUID();
    await prisma.seatAllocation.deleteMany({ where: { examSessionId: session.id } });
    await prisma.seatAllocation.createMany({
      data: seating.allocations.map((a) => ({ examSessionId: session!.id, venueId: a.venueId, studentId: a.studentId, moduleOfferingId: a.offeringId, row: a.row, col: a.col, seatLabel: a.seatLabel, runId })),
    });
    const mine = seating.allocations.find((a) => a.studentId === heroId);
    exam = { title, date: when.toISOString().slice(0, 10), seat: mine?.seatLabel ?? null, venue: hall.name };
    if (!mine) warnings.push('The hall filled before his seat was reached — he is on the unseated list.');
  }

  // ---- fee settled, so the admit card can be issued ----------------------------
  let admitCard: string | null = null;
  const invoice = await prisma.feeInvoice.findFirst({ where: { studentId: heroId, semesterId: current.id }, select: { id: true } });
  if (invoice) {
    await prisma.feeInvoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt: new Date(), method: 'eSewa', reference: 'ESW-SCENARIO-001' } });
  } else {
    await prisma.feeInvoice.create({
      data: { studentId: heroId, semesterId: current.id, amount: 92500, dueDate: new Date(Date.now() - 5 * 86400e3), status: 'PAID', paidAt: new Date(), method: 'eSewa', reference: 'ESW-SCENARIO-001' },
    });
  }
  const existingCard = await prisma.admitCard.findFirst({ where: { studentId: heroId, semesterId: current.id }, select: { cardNo: true } });
  if (existingCard) admitCard = existingCard.cardNo;
  else {
    const card = await prisma.admitCard.create({
      data: { studentId: heroId, semesterId: current.id, cardNo: `AC-${HERO.studentId}-S${current.number}` },
      select: { cardNo: true },
    });
    admitCard = card.cardNo;
  }

  // ---- a few weeks of registers, so attendance is not an empty box -------------
  const slots = await prisma.timetableSlot.findMany({ where: { semesterId: current.id, sectionId: { in: sectionIds } }, select: { id: true, moduleOfferingId: true, dayOfWeek: true } });
  let attendanceMarked = 0;
  const today = new Date();
  for (const slot of slots) {
    for (let back = 1; back <= 6; back += 1) {
      const d = new Date(today.getTime() - back * 7 * 86400e3);
      const iso = ((d.getUTCDay() + 6) % 7) + 1;
      d.setUTCDate(d.getUTCDate() + (slot.dayOfWeek - iso));
      d.setUTCHours(0, 0, 0, 0);
      if (d > today) continue;
      const present = rnd() > 0.18;
      await prisma.attendanceRecord.upsert({
        where: { studentId_slotId_date: { studentId: heroId, slotId: slot.id, date: d } },
        update: {},
        create: { studentId: heroId, slotId: slot.id, offeringId: slot.moduleOfferingId, date: d, status: present ? 'PRESENT' : 'ABSENT', markedById: sujal.id },
      });
      attendanceMarked += 1;
    }
  }

  const hero = await prisma.student.findUnique({ where: { id: heroId }, select: { id: true, studentId: true, name: true } });
  return {
    student: { id: hero!.id, studentId: hero!.studentId, name: hero!.name, login: HERO.email },
    teacher: { id: sujal.id, name: sujal.name, login: 'sujal.shiwakoti@demo' },
    classmatesAdded,
    classes,
    publishedResults,
    currentModules: [...offeringByCode.keys()],
    exam,
    admitCard,
    attendanceMarked,
    warnings,
  };
}

/**
 * Registers for the term that has actually run.
 *
 * Attendance only means something once enough of a term has passed — a fortnight of absence is a
 * cold, a whole term of it is a problem — and in this calendar every cohort's current semester
 * begins today, so the only term with anything to judge is the one before it. These are last
 * term's registers: real dates, one class a week per module, with a deliberate minority who fell
 * well below half and would have been picked up by the at-risk list at the time.
 *
 * One group per cohort rather than all eight. The point is that every course and every module has
 * attendance to look at, not that a free database holds two hundred thousand rows of it.
 */
export async function seedAttendanceHistory(prisma: PrismaClient) {
  const WEEKS = 8;
  /** Roughly one in five, chosen by position so a re-run picks the same people. */
  const isStruggling = (i: number) => i % 5 === 2;

  const intakes = await prisma.intake.findMany({
    include: {
      programme: { select: { code: true } },
      semesters: { orderBy: { number: 'asc' } },
      sections: { orderBy: { name: 'asc' } },
    },
  });
  const anyTeacher = await prisma.user.findFirst({ where: { role: 'LECTURER', isActive: true }, select: { id: true } });

  const covered: string[] = [];
  const skipped: string[] = [];
  let records = 0;

  for (const intake of intakes) {
    // The current semester started today; the one before it is the only term with a story.
    if (intake.semesters.length < 2) {
      skipped.push(`${intake.programme.code} ${intake.label} — no term before the one starting today`);
      continue;
    }
    const term = intake.semesters[intake.semesters.length - 2];
    const section = intake.sections[0];
    if (!section) continue;

    const offerings = await prisma.moduleOffering.findMany({
      where: { semesterId: term.id },
      select: { id: true, lecturerId: true, module: { select: { code: true } } },
      orderBy: { module: { code: 'asc' } },
    });
    if (offerings.length === 0) continue;

    const students = await prisma.student.findMany({
      where: { sectionId: section.id, deletedAt: null },
      select: { id: true },
      orderBy: { studentId: 'asc' },
    });
    if (students.length === 0) continue;

    for (const [oi, offering] of offerings.entries()) {
      const teacherId = offering.lecturerId ?? anyTeacher?.id;
      if (!teacherId) continue;

      // One weekly class per module. Past terms were never given a routine, so it is written here
      // rather than invented per register — attendance has to point at a real class.
      let slot = await prisma.timetableSlot.findFirst({
        where: { semesterId: term.id, sectionId: section.id, moduleOfferingId: offering.id },
        select: { id: true, dayOfWeek: true },
      });
      if (!slot) {
        const day = [7, 1, 2, 3, 4, 5][oi % 6];
        const hour = 9 + (oi % 4) * 2;
        slot = await prisma.timetableSlot.create({
          data: {
            semesterId: term.id,
            sectionId: section.id,
            moduleOfferingId: offering.id,
            teacherId,
            kind: 'LECTURE',
            dayOfWeek: day,
            startTime: `${String(hour).padStart(2, '0')}:00`,
            endTime: `${String(hour + 1).padStart(2, '0')}:30`,
          },
          select: { id: true, dayOfWeek: true },
        });
      }

      const rows: { studentId: string; slotId: string; offeringId: string; date: Date; status: 'PRESENT' | 'ABSENT'; markedById: string }[] = [];
      for (let w = 0; w < WEEKS; w += 1) {
        const d = new Date(term.startDate.getTime() + w * 7 * 86400e3);
        const iso = ((d.getUTCDay() + 6) % 7) + 1;
        d.setUTCDate(d.getUTCDate() + (slot.dayOfWeek - iso));
        d.setUTCHours(0, 0, 0, 0);
        for (const [si, s] of students.entries()) {
          // A struggling student turns up now and then; everybody else misses the odd week.
          const rnd = hashUnit(si * 977 + w * 31 + oi * 7);
          const present = isStruggling(si) ? rnd < 0.32 : rnd < 0.9;
          rows.push({ studentId: s.id, slotId: slot.id, offeringId: offering.id, date: d, status: present ? 'PRESENT' : 'ABSENT', markedById: teacherId });
        }
      }
      // Rewritten, not skipped: a re-run has to be able to correct what the last one wrote.
      await prisma.attendanceRecord.deleteMany({ where: { slotId: slot.id } });
      for (let i = 0; i < rows.length; i += 500) {
        const r = await prisma.attendanceRecord.createMany({ data: rows.slice(i, i + 500), skipDuplicates: true });
        records += r.count;
      }
    }
    covered.push(`${intake.programme.code} ${intake.label} · semester ${term.number} · group ${section.name} · ${offerings.length} modules · ${students.length} students`);
  }

  return { records, covered, skipped };
}
