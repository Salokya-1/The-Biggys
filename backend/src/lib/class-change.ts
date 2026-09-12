import { prisma } from './prisma';
import { notifyUsers } from './notify';

const DAY_NAME: Record<number, string> = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' };

export interface ClassShape {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  teacherName: string | null;
  venueName: string | null;
}

/**
 * What actually changed about a class, in the words a student needs.
 *
 * "Room change for AC4053" tells somebody there is a problem without telling them what to do
 * about it — they still have to open the timetable to find the new room. Each line here names the
 * old value and the new one, and anything that did not move is left out entirely: a room change
 * says nothing about the lecturer, because the lecturer is the same person they were expecting.
 */
export function describeChange(before: ClassShape, after: ClassShape): string[] {
  const lines: string[] = [];
  if (before.dayOfWeek !== after.dayOfWeek || before.startTime !== after.startTime || before.endTime !== after.endTime) {
    lines.push(`Now ${DAY_NAME[after.dayOfWeek]} ${after.startTime}–${after.endTime} (was ${DAY_NAME[before.dayOfWeek]} ${before.startTime}–${before.endTime})`);
  }
  if ((before.venueName ?? null) !== (after.venueName ?? null)) {
    lines.push(after.venueName ? `Room is now ${after.venueName}${before.venueName ? ` (was ${before.venueName})` : ''}` : 'The room has been released — RTE will confirm a new one');
  }
  if ((before.teacherName ?? null) !== (after.teacherName ?? null)) {
    lines.push(`Taken by ${after.teacherName ?? 'a lecturer still to be named'}${before.teacherName ? ` (was ${before.teacherName})` : ''}`);
  }
  return lines;
}

/**
 * Tell everybody sitting in the room, plus the lecturer coming and the one going.
 *
 * A combined lecture is several groups in one booking, so the notice goes to every group attached
 * to the class and not only to the section that happens to own the row.
 */
export async function notifyClassChange(opts: {
  slotId: string;
  moduleCode: string;
  sectionIds: string[];
  changes: string[];
  /** A single date when this is a one-off; omitted when the routine itself moved. */
  date?: string;
  reason?: string | null;
  staffIds?: (string | null | undefined)[];
}) {
  if (opts.changes.length === 0) return 0;

  const students = await prisma.student.findMany({
    where: { sectionId: { in: opts.sectionIds }, deletedAt: null, userId: { not: null } },
    select: { userId: true },
  });
  const recipients = [...students.map((s) => s.userId!), ...(opts.staffIds ?? []).filter((x): x is string => !!x)];

  const when = opts.date ? ` on ${opts.date}` : ' from now on';
  return notifyUsers(prisma, recipients, {
    type: 'class.rescheduled',
    title: `${opts.moduleCode}: your class has changed`,
    body: [`${opts.changes.join('. ')}${when}.`, opts.reason ? `Reason: ${opts.reason}` : null].filter(Boolean).join(' '),
    payload: { slotId: opts.slotId, date: opts.date ?? null },
  });
}
