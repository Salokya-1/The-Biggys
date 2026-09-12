import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { allow } from '../plugins/auth';

/**
 * How long a sheet may sit in one state before it is holding something up.
 *
 * These are not arbitrary: a scholarship panel or a progression board works from published
 * results, so a sheet still in review a fortnight after the exam is not "in progress", it is a
 * decision nobody can take.
 */
const AGE_LIMIT_DAYS: Record<string, number> = {
  DRAFT: 21,
  SUBMITTED: 5,
  UNDER_REVIEW: 7,
  APPROVED: 3,
  RETURNED: 5,
};

/** Consequences worth naming, so a queue length reads as something other than a queue length. */
const CONSEQUENCE: Record<string, string> = {
  DRAFT: 'Marks are not entered, so nothing downstream can start.',
  SUBMITTED: 'Waiting on a reviewer. Progression and scholarship decisions read published results only.',
  UNDER_REVIEW: 'Under review past the point where the board would expect a decision.',
  APPROVED: 'Approved but unpublished — the students still cannot see it and awards cannot be assessed.',
  RETURNED: 'Sent back for correction and not yet returned.',
};

const days = (from: Date) => Math.floor((Date.now() - from.getTime()) / 86400e3);

export interface Bottleneck {
  kind: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  consequence: string;
  count: number;
  worstAgeDays: number | null;
  href: string;
  examples: string[];
}

/**
 * Where the operation is stuck.
 *
 * A dashboard of counts tells you how much there is; it does not tell you what is jammed. This
 * looks for the handful of states that stall other people's work — results that will not publish,
 * marks nobody has entered, exams with more candidates than seats, classes with no lecturer —
 * ranks them by how long they have been stuck, and says what each one is costing.
 */
export async function bottleneckRoutes(app: FastifyInstance) {
  app.get('/bottlenecks', { preHandler: [allow('dashboard.read')] }, async () => {
    const out: Bottleneck[] = [];

    // ---- result pipeline ----------------------------------------------------
    const sheets = await prisma.markSheet.findMany({
      where: { status: { not: 'PUBLISHED' } },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        moduleOffering: { select: { module: { select: { code: true } }, semester: { select: { number: true, intake: { select: { label: true, programme: { select: { code: true } } } } } } } },
      },
    });
    const byStatus = new Map<string, typeof sheets>();
    for (const s of sheets) {
      const limit = AGE_LIMIT_DAYS[s.status];
      if (limit === undefined || days(s.updatedAt) < limit) continue;
      byStatus.set(s.status, [...(byStatus.get(s.status) ?? []), s]);
    }
    for (const [status, rows] of byStatus) {
      const worst = Math.max(...rows.map((r) => days(r.updatedAt)));
      out.push({
        kind: `marksheet.${status.toLowerCase()}`,
        severity: worst >= AGE_LIMIT_DAYS[status] * 2 ? 'high' : 'medium',
        title: `${rows.length} mark sheet${rows.length === 1 ? '' : 's'} stuck at ${status.replace('_', ' ').toLowerCase()}`,
        detail: `Oldest has sat there ${worst} days; anything past ${AGE_LIMIT_DAYS[status]} is counted.`,
        consequence: CONSEQUENCE[status],
        count: rows.length,
        worstAgeDays: worst,
        href: '/marksheets',
        examples: rows
          .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
          .slice(0, 4)
          .map((r) => `${r.moduleOffering.module.code} · ${r.moduleOffering.semester.intake.programme.code} ${r.moduleOffering.semester.intake.label} S${r.moduleOffering.semester.number} (${days(r.updatedAt)}d)`),
      });
    }

    // ---- exams with nowhere to sit ------------------------------------------
    const exams = await prisma.examSession.findMany({
      where: { date: { gte: new Date() } },
      select: {
        id: true,
        title: true,
        date: true,
        venues: { select: { rows: true, cols: true, disabledSeats: true } },
        offerings: { select: { _count: { select: { enrollments: true } } } },
      },
    });
    const short = exams
      .map((e) => {
        const capacity = e.venues.reduce((n, v) => n + v.rows * v.cols - ((v.disabledSeats as unknown[]) ?? []).length, 0);
        const candidates = e.offerings.reduce((n, o) => n + o._count.enrollments, 0);
        return { title: e.title, date: e.date, shortfall: candidates - capacity, candidates, capacity };
      })
      .filter((e) => e.shortfall > 0)
      .sort((a, b) => b.shortfall - a.shortfall);
    if (short.length) {
      out.push({
        kind: 'exam.capacity',
        severity: 'high',
        title: `${short.length} exam${short.length === 1 ? '' : 's'} with more candidates than seats`,
        detail: `${short.reduce((n, e) => n + e.shortfall, 0)} students have nowhere to sit across those sittings.`,
        consequence: 'Seating cannot be generated, so admit cards cannot be issued and the sitting cannot go ahead as booked.',
        count: short.length,
        worstAgeDays: null,
        href: '/exams',
        examples: short.slice(0, 4).map((e) => `${e.title} — ${e.candidates} candidates, ${e.capacity} seats`),
      });
    }

    // ---- classes nobody is covering -----------------------------------------
    const openAlerts = await prisma.classAlert.findMany({
      where: { status: 'OPEN' },
      select: { createdAt: true, slot: { select: { moduleOffering: { select: { module: { select: { code: true } } } }, section: { select: { name: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    if (openAlerts.length) {
      out.push({
        kind: 'class.uncovered',
        severity: openAlerts.length > 3 ? 'high' : 'medium',
        title: `${openAlerts.length} class${openAlerts.length === 1 ? '' : 'es'} with no lecturer`,
        detail: `Oldest raised ${days(openAlerts[0].createdAt)} days ago and still open.`,
        consequence: 'Students are turning up to a room where nobody is teaching, and the contact hours are lost.',
        count: openAlerts.length,
        worstAgeDays: days(openAlerts[0].createdAt),
        href: '/alerts',
        examples: openAlerts.slice(0, 4).map((a) => `${a.slot.moduleOffering.module.code} · ${a.slot.section.name}`),
      });
    }

    // ---- requests waiting on a decision -------------------------------------
    const pending = await prisma.changeRequest.findMany({
      where: { status: 'PENDING' },
      select: { createdAt: true, kind: true },
      orderBy: { createdAt: 'asc' },
    });
    const stale = pending.filter((r) => days(r.createdAt) >= 5);
    if (stale.length) {
      out.push({
        kind: 'request.pending',
        severity: stale.length > 10 ? 'high' : 'low',
        title: `${stale.length} request${stale.length === 1 ? '' : 's'} waiting more than five days`,
        detail: `Oldest has been open ${days(stale[0].createdAt)} days.`,
        consequence: 'People are waiting on an answer they need before they can do anything else.',
        count: stale.length,
        worstAgeDays: days(stale[0].createdAt),
        href: '/requests',
        examples: [...new Set(stale.map((r) => r.kind))].slice(0, 4),
      });
    }

    // ---- queries nobody has answered ----------------------------------------
    const openQueries = await prisma.queryTicket.findMany({ where: { status: 'OPEN' }, select: { createdAt: true, subject: true }, orderBy: { createdAt: 'asc' } });
    const staleQueries = openQueries.filter((q) => days(q.createdAt) >= 3);
    if (staleQueries.length) {
      out.push({
        kind: 'query.open',
        severity: 'low',
        title: `${staleQueries.length} quer${staleQueries.length === 1 ? 'y' : 'ies'} unanswered for three days or more`,
        detail: `Oldest asked ${days(staleQueries[0].createdAt)} days ago.`,
        consequence: 'Unanswered questions come back as requests, or as somebody at the office door.',
        count: staleQueries.length,
        worstAgeDays: days(staleQueries[0].createdAt),
        href: '/queries',
        examples: staleQueries.slice(0, 4).map((q) => q.subject),
      });
    }

    const rank = { high: 0, medium: 1, low: 2 };
    out.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.worstAgeDays ?? 0) - (a.worstAgeDays ?? 0));

    return {
      checkedAt: new Date().toISOString(),
      clear: out.length === 0,
      high: out.filter((b) => b.severity === 'high').length,
      bottlenecks: out,
    };
  });
}
