import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest, conflict, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow } from '../plugins/auth';
import { IT_SUPPORT_EMAIL, mailerConfigured, sendEmail } from '../lib/mailer';
import { parseDay } from '../services/calendar';
import { overlaps } from '../lib/timetable';

const createBody = z
  .object({
    examSessionId: z.string().optional(),
    slotId: z.string().optional(),
    venueId: z.string().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    reason: z.string().trim().min(10).max(500),
  })
  .refine((b) => b.examSessionId || b.slotId || (b.venueId && b.date && b.startTime && b.endTime), {
    message: 'Give an exam session, a class, or a room with a date and a time window',
  });

const decideBody = z.object({ decision: z.enum(['APPROVED', 'DENIED']), note: z.string().trim().max(300).optional() });

const include = {
  venue: { select: { id: true, name: true, building: true } },
  requestedBy: { select: { id: true, name: true, email: true } },
  examSession: { select: { id: true, title: true, kind: true } },
  slot: { select: { id: true, startTime: true, endTime: true, section: { select: { name: true } }, moduleOffering: { select: { module: { select: { code: true, title: true } } } } } },
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addMinutes = (t: string, min: number) => {
  const [h, m] = t.split(':').map(Number);
  const total = h * 60 + m + min;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * Camera access for an exam or a class.
 *
 * Watching a room is intrusive, so the shape of this endpoint is the control: only the RTE admin
 * can ask, the window is taken from the exam or class itself rather than typed in freely, a
 * written reason is required, and every request emails IT support and leaves an audit row. The
 * system never switches a camera on — it asks the people who can, and records that it asked.
 */
export async function cameraRoutes(app: FastifyInstance) {
  app.get('/camera-requests', { preHandler: [allow('camera.read')] }, async (req) => {
    const { status } = parse(z.object({ status: z.enum(['PENDING', 'SENT', 'APPROVED', 'DENIED']).optional() }), req.query);
    const items = await prisma.cameraAccessRequest.findMany({ where: status ? { status } : {}, include, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 });
    return { itSupportEmail: IT_SUPPORT_EMAIL, mailerConfigured: mailerConfigured(), items };
  });

  app.post('/camera-requests', { preHandler: [allow('camera.request')] }, async (req, reply) => {
    const body = parse(createBody, req.body);

    // Resolve the room and the window from whatever the caller named, so the request always
    // covers exactly the class or exam it is for.
    let venueId = body.venueId ?? '';
    let date: Date;
    let startTime = body.startTime ?? '';
    let endTime = body.endTime ?? '';

    if (body.examSessionId) {
      const exam = await prisma.examSession.findUnique({ where: { id: body.examSessionId }, include: { venues: { select: { id: true } } } });
      if (!exam) throw notFound('Exam session not found');
      venueId = body.venueId ?? exam.venues[0]?.id ?? '';
      if (!venueId) throw badRequest('That exam has no room yet — allocate one first, or name the room');
      if (!exam.venues.some((v) => v.id === venueId)) throw badRequest('That room is not used by this exam');
      date = exam.date;
      startTime = exam.startTime;
      endTime = addMinutes(exam.startTime, exam.durationMin);
    } else if (body.slotId) {
      const slot = await prisma.timetableSlot.findUnique({ where: { id: body.slotId } });
      if (!slot) throw notFound('Class not found');
      if (!slot.venueId) throw badRequest('That class has no room');
      if (!body.date) throw badRequest('Give the date of the class');
      venueId = slot.venueId;
      date = parseDay(body.date);
      startTime = slot.startTime;
      endTime = slot.endTime;
    } else {
      date = parseDay(body.date!);
    }
    if (endTime <= startTime) throw badRequest('The end time must be after the start time');

    const venue = await prisma.venue.findUnique({ where: { id: venueId }, select: { id: true, name: true, building: true } });
    if (!venue) throw notFound('Room not found');

    // One live request per room and window is enough; a second is noise for IT support.
    const sameDay = await prisma.cameraAccessRequest.findMany({ where: { venueId, date, status: { in: ['PENDING', 'SENT', 'APPROVED'] } } });
    const clash = sameDay.find((r) => overlaps(r.startTime, r.endTime, startTime, endTime));
    if (clash) throw conflict(`${venue.name} is already covered by ${clash.reference} from ${clash.startTime} to ${clash.endTime} that day`, { reference: clash.reference });

    const u = req.user!;
    const reference = `CAM-${iso(date).replace(/-/g, '')}-${venue.name.replace(/[^A-Za-z0-9]/g, '')}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
    const created = await prisma.cameraAccessRequest.create({
      data: {
        reference,
        venueId,
        examSessionId: body.examSessionId ?? null,
        slotId: body.slotId ?? null,
        date,
        startTime,
        endTime,
        reason: body.reason,
        requestedById: u.id,
        itSupportEmail: IT_SUPPORT_EMAIL,
      },
      include,
    });

    const what = created.examSession ? `${created.examSession.kind.replace('_', ' ').toLowerCase()} "${created.examSession.title}"` : created.slot ? `${created.slot.moduleOffering.module.code} ${created.slot.moduleOffering.module.title} (section ${created.slot.section.name})` : 'a booked session';
    const mail = await sendEmail(prisma, {
      to: IT_SUPPORT_EMAIL,
      subject: `Camera access request ${reference} — ${venue.name} on ${iso(date)}`,
      body: [
        'A camera access request has been raised in the RTE Management System.',
        '',
        `Reference:  ${reference}`,
        `Room:       ${venue.name} (${venue.building})`,
        `Date:       ${iso(date)}`,
        `Window:     ${startTime}–${endTime}`,
        `For:        ${what}`,
        `Requested by: ${u.name} <${created.requestedBy.email}> (RTE admin)`,
        '',
        'Reason given:',
        created.reason,
        '',
        'Access is requested for the length of that session only. Please approve or decline in the',
        'RTE Management System, or reply to this message.',
      ].join('\n'),
      relatedType: 'CameraAccessRequest',
      relatedId: created.id,
    });

    const sent = mail.status === 'SENT';
    const after = await prisma.cameraAccessRequest.update({
      where: { id: created.id },
      data: { status: sent ? 'SENT' : 'PENDING', notifiedAt: sent ? new Date() : null },
      include,
    });
    await audit(prisma, { ...actorOf(req), action: 'camera.request', entityType: 'CameraAccessRequest', entityId: created.id, after: { reference, venue: venue.name, date: iso(date), startTime, endTime, to: IT_SUPPORT_EMAIL }, reason: created.reason });

    reply.code(201);
    return { ...after, email: { id: mail.id, to: mail.to, status: mail.status, subject: mail.subject }, mailerConfigured: mailerConfigured() };
  });

  app.post('/camera-requests/:id/decide', { preHandler: [allow('camera.request')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(decideBody, req.body);
    const before = await prisma.cameraAccessRequest.findUnique({ where: { id } });
    if (!before) throw notFound('Request not found');
    if (before.status === 'APPROVED' || before.status === 'DENIED') throw conflict('That request has already been decided');
    const after = await prisma.cameraAccessRequest.update({ where: { id }, data: { status: body.decision, decidedAt: new Date(), decisionNote: body.note ?? null }, include });
    await audit(prisma, { ...actorOf(req), action: 'camera.decide', entityType: 'CameraAccessRequest', entityId: id, before: { status: before.status }, after: { status: body.decision }, reason: body.note ?? null });
    return after;
  });

  /** The outbox: what the system has sent, and whether it actually went out. */
  app.get('/emails', { preHandler: [allow('users.manage')] }, async (req) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    const items = await prisma.emailMessage.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    return { configured: mailerConfigured(), itSupportEmail: IT_SUPPORT_EMAIL, items };
  });
}
