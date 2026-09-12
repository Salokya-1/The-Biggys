import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow, requireRole, STAFF } from '../plugins/auth';
import { notifyRole, notifyUsers } from '../lib/notify';
import { CLASS_KIND_LABEL, TEACHING_DAYS, overlaps, toMinutes, type ClassKind } from '../lib/timetable';

const DAY_NAME: Record<number, string> = { 7: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' };
const hours = (a: string, b: string) => (toMinutes(b) - toMinutes(a)) / 60;

const windowBody = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().trim().max(120).optional(),
  /** Set once the person has seen which classes the window would take them out of. */
  confirm: z.boolean().optional(),
});

/**
 * Teachers: what each one carries, and when they cannot be given a class.
 *
 * A routine generated against staff who are all assumed to be free all week is fiction. Part-time
 * lecturers, industry days and standing commitments are ordinary facts about a timetable, so the
 * people who have them record them once and the generator works around them.
 */
export async function teacherRoutes(app: FastifyInstance) {
  /** My own unavailable windows (a teacher), or someone else's (RTE). */
  app.get('/teachers/:id/unavailability', { preHandler: [requireRole(...STAFF)] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const u = req.user!;
    if (u.role !== 'ADMIN' && u.id !== id) throw forbidden('You can only see your own availability');
    const items = await prisma.teacherUnavailability.findMany({ where: { teacherId: id }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] });
    return items.map((i) => ({ ...i, day: DAY_NAME[i.dayOfWeek] ?? String(i.dayOfWeek), hours: Math.round(hours(i.startTime, i.endTime) * 10) / 10 }));
  });

  app.post('/teachers/:id/unavailability', { preHandler: [requireRole(...STAFF)] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const body = parse(windowBody, req.body);
    const u = req.user!;
    if (u.role !== 'ADMIN' && u.id !== id) throw forbidden('You can only change your own availability');
    if (toMinutes(body.endTime) <= toMinutes(body.startTime)) throw badRequest('The end time must be after the start time');

    const existing = await prisma.teacherUnavailability.findMany({ where: { teacherId: id, dayOfWeek: body.dayOfWeek } });
    if (existing.some((e) => overlaps(e.startTime, e.endTime, body.startTime, body.endTime))) {
      throw conflict(`You already have ${DAY_NAME[body.dayOfWeek]} marked unavailable across that time`);
    }

    // Blocking an hour you are already teaching in is not refused — the class may be exactly what
    // needs to move — but it is never done silently either. The first attempt comes back with the
    // classes and who could take them; only a confirmed second attempt goes through, and then the
    // cover is assigned and everybody affected is told.
    const clashes = await prisma.timetableSlot.findMany({
      where: { teacherId: id, dayOfWeek: body.dayOfWeek },
      include: {
        moduleOffering: { select: { id: true, lecturerId: true, coLecturerId: true, module: { select: { code: true, title: true } } } },
        section: { select: { id: true, name: true } },
        groups: { select: { id: true } },
      },
    });
    const affected = clashes.filter((c) => overlaps(c.startTime, c.endTime, body.startTime, body.endTime));
    const describe = (c: (typeof affected)[number]) => `${c.moduleOffering.module.code} ${c.section.name} ${c.startTime}–${c.endTime}`;

    /** Somebody who already teaches the module, is not the person stepping out, and is free then. */
    async function coverFor(slot: (typeof affected)[number]) {
      const candidates = [slot.moduleOffering.lecturerId, slot.moduleOffering.coLecturerId].filter((x): x is string => !!x && x !== id);
      for (const candidateId of candidates) {
        const [busy, blocked] = await Promise.all([
          prisma.timetableSlot.findMany({ where: { teacherId: candidateId, dayOfWeek: slot.dayOfWeek }, select: { startTime: true, endTime: true } }),
          prisma.teacherUnavailability.findMany({ where: { teacherId: candidateId, dayOfWeek: slot.dayOfWeek }, select: { startTime: true, endTime: true } }),
        ]);
        const taken = [...busy, ...blocked].some((b) => overlaps(b.startTime, b.endTime, slot.startTime, slot.endTime));
        if (!taken) return prisma.user.findUnique({ where: { id: candidateId }, select: { id: true, name: true } });
      }
      return null;
    }

    if (affected.length > 0 && !body.confirm) {
      const withCover = await Promise.all(
        affected.map(async (c) => {
          const cover = await coverFor(c);
          return { id: c.id, what: describe(c), cover: cover?.name ?? null };
        }),
      );
      throw conflict(
        `You are teaching ${affected.length} class${affected.length === 1 ? '' : 'es'} in that window. Block it anyway and hand ${affected.length === 1 ? 'it' : 'them'} over?`,
        { needsConfirmation: true, classes: withCover },
      );
    }

    const created = await prisma.teacherUnavailability.create({ data: { teacherId: id, dayOfWeek: body.dayOfWeek, startTime: body.startTime, endTime: body.endTime, reason: body.reason ?? null } });

    const handovers: { what: string; cover: string | null }[] = [];
    for (const slot of affected) {
      const cover = await coverFor(slot);
      if (cover) {
        await prisma.timetableSlot.update({ where: { id: slot.id }, data: { teacherId: cover.id } });
        await notifyUsers(prisma, [cover.id], {
          type: 'class.cover',
          title: `You are now teaching ${slot.moduleOffering.module.code}`,
          body: `${DAY_NAME[slot.dayOfWeek]} ${slot.startTime}–${slot.endTime}, ${slot.section.name}. The usual lecturer has blocked that hour.`,
          payload: { slotId: slot.id },
        });
      }
      handovers.push({ what: describe(slot), cover: cover?.name ?? null });

      // Whoever is sitting in that room needs to know before they turn up to it.
      const sectionIds = [...new Set([slot.sectionId, ...slot.groups.map((g) => g.id)])];
      const students = await prisma.student.findMany({ where: { sectionId: { in: sectionIds }, deletedAt: null, userId: { not: null } }, select: { userId: true } });
      await notifyUsers(prisma, students.map((s) => s.userId!), {
        type: 'class.changed',
        title: `${slot.moduleOffering.module.code}: change of lecturer`,
        body: cover
          ? `${DAY_NAME[slot.dayOfWeek]} ${slot.startTime}–${slot.endTime} will be taken by ${cover.name}. Time and room are unchanged.`
          : `${DAY_NAME[slot.dayOfWeek]} ${slot.startTime}–${slot.endTime} has no lecturer yet — RTE is arranging cover and will confirm.`,
        payload: { slotId: slot.id },
      });
    }

    // Anything left without cover is RTE's to place, so RTE hears about it by name.
    const uncovered = handovers.filter((h) => !h.cover);
    if (uncovered.length > 0) {
      await notifyRole(prisma, 'ADMIN', {
        type: 'class.cover.needed',
        title: `${uncovered.length} class${uncovered.length === 1 ? '' : 'es'} need a lecturer`,
        body: uncovered.map((h) => h.what).join('; '),
      });
    }

    await audit(prisma, { ...actorOf(req), action: 'teacher.unavailability.add', entityType: 'User', entityId: id, after: { ...body, handovers } });
    reply.code(201);
    return { ...created, day: DAY_NAME[created.dayOfWeek], affectedClasses: handovers.map((h) => h.what), handovers };
  });

  app.delete('/teachers/unavailability/:id', { preHandler: [requireRole(...STAFF)] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const row = await prisma.teacherUnavailability.findUnique({ where: { id } });
    if (!row) throw notFound('Not found');
    const u = req.user!;
    if (u.role !== 'ADMIN' && u.id !== row.teacherId) throw forbidden('You can only change your own availability');
    await prisma.teacherUnavailability.delete({ where: { id } });
    await audit(prisma, { ...actorOf(req), action: 'teacher.unavailability.remove', entityType: 'User', entityId: row.teacherId, before: row });
    return { ok: true };
  });

  /**
   * Every teacher and everything they carry: modules, classes, contact hours, the exams they
   * invigilate and the hours they have blocked out. This is the view RTE needs before moving
   * anything, and the one nobody has when the timetable lives in a spreadsheet.
   */
  app.get('/teachers/overview', { preHandler: [allow('timetable.read')] }, async (req) => {
    const { q } = parse(z.object({ q: z.string().optional() }), req.query);
    const staff = await prisma.user.findMany({
      where: {
        role: { in: ['LECTURER', 'MODULE_LEADER'] },
        isActive: true,
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        unavailability: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
        taughtSlots: {
          include: {
            section: { select: { name: true } },
            groups: { select: { name: true } },
            venue: { select: { name: true } },
            moduleOffering: { select: { module: { select: { code: true, title: true } }, semester: { select: { number: true, intake: { select: { label: true, programme: { select: { code: true } } } } } } } },
          },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        },
        lecturedOfferings: { select: { module: { select: { code: true, title: true } } } },
        coLecturedOfferings: { select: { module: { select: { code: true, title: true } } } },
        ledModules: { select: { code: true } },
        invigilations: { select: { examSession: { select: { title: true, date: true, startTime: true } } } },
      },
      orderBy: { name: 'asc' },
    });

    return staff.map((s) => {
      const classes = s.taughtSlots.map((c) => ({
        id: c.id,
        kind: c.kind as ClassKind,
        kindLabel: CLASS_KIND_LABEL[c.kind as ClassKind],
        day: DAY_NAME[c.dayOfWeek] ?? String(c.dayOfWeek),
        dayOfWeek: c.dayOfWeek,
        startTime: c.startTime,
        endTime: c.endTime,
        hours: Math.round(hours(c.startTime, c.endTime) * 10) / 10,
        module: c.moduleOffering.module,
        cohort: `${c.moduleOffering.semester.intake.programme.code} ${c.moduleOffering.semester.intake.label} S${c.moduleOffering.semester.number}`,
        groups: (c.groups.length ? c.groups : [c.section]).map((g) => g.name),
        venue: c.venue?.name ?? null,
      }));
      const contactHours = Math.round(classes.reduce((n, c) => n + c.hours, 0) * 10) / 10;
      const modules = [...new Set([...s.lecturedOfferings, ...s.coLecturedOfferings].map((o) => o.module.code))].sort();
      const blocked = s.unavailability.map((b) => ({ id: b.id, day: DAY_NAME[b.dayOfWeek] ?? String(b.dayOfWeek), dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime, reason: b.reason }));
      // A day is "busy" once it holds anything at all — the shape of the week at a glance.
      const daysUsed = TEACHING_DAYS.filter((d) => classes.some((c) => c.dayOfWeek === d));
      return {
        id: s.id,
        name: s.name,
        email: s.email,
        role: s.role,
        modules,
        leads: s.ledModules.map((m) => m.code),
        classes,
        classCount: classes.length,
        contactHours,
        daysUsed,
        blocked,
        invigilations: s.invigilations.map((i) => i.examSession).filter(Boolean),
      };
    });
  });
}
