import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow, requireRole, STAFF } from '../plugins/auth';
import { notifyUsers } from '../lib/notify';

const feeInclude = {
  student: { select: { id: true, studentId: true, name: true, userId: true, programme: { select: { code: true } }, section: { select: { name: true } } } },
  semester: { select: { id: true, number: true, term: true, intake: { select: { label: true, programme: { select: { code: true } } } } } },
};

async function ownStudent(userId: string) {
  const s = await prisma.student.findFirst({ where: { userId, deletedAt: null }, select: { id: true, studentId: true } });
  if (!s) throw notFound('No student record is linked to this account');
  return s;
}

/** Semester fees (mock payment) and admit cards that unlock only once the fee is settled. */
export async function feeRoutes(app: FastifyInstance) {
  // ---------- admin ----------
  app.get('/fees', { preHandler: [allow('fees.read')] }, async (req) => {
    const q = parse(z.object({ semesterId: z.string().optional(), status: z.enum(['UNPAID', 'PAID', 'WAIVED']).optional(), q: z.string().optional() }), req.query);
    const items = await prisma.feeInvoice.findMany({
      where: {
        ...(q.semesterId ? { semesterId: q.semesterId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.q ? { student: { OR: [{ studentId: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }] } } : {}),
      },
      include: feeInclude,
      orderBy: [{ status: 'desc' }, { student: { studentId: 'asc' } }],
      take: 500,
    });
    const summary = await prisma.feeInvoice.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amount: true }, where: q.semesterId ? { semesterId: q.semesterId } : {} });
    return { items, summary: summary.map((s) => ({ status: s.status, count: s._count._all, amount: Number(s._sum.amount ?? 0) })) };
  });

  app.post('/fees/generate', { preHandler: [allow('fees.write')] }, async (req) => {
    const { semesterId, amount, dueDate } = parse(z.object({ semesterId: z.string(), amount: z.number().positive(), dueDate: z.coerce.date() }), req.body);
    const students = await prisma.student.findMany({ where: { currentSemesterId: semesterId, deletedAt: null, feeInvoices: { none: { semesterId } } }, select: { id: true } });
    const res = await prisma.feeInvoice.createMany({ data: students.map((s) => ({ studentId: s.id, semesterId, amount, dueDate })) });
    await audit(prisma, { ...actorOf(req), action: 'fees.generate', entityType: 'Semester', entityId: semesterId, after: { created: res.count, amount } });
    return { created: res.count };
  });

  app.patch('/fees/:id', { preHandler: [allow('fees.write')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ status: z.enum(['UNPAID', 'PAID', 'WAIVED']), method: z.string().max(40).optional(), reference: z.string().max(60).optional() }), req.body);
    const before = await prisma.feeInvoice.findUnique({ where: { id }, include: feeInclude });
    if (!before) throw notFound('Invoice not found');
    const after = await prisma.feeInvoice.update({ where: { id }, data: { status: body.status, method: body.method ?? before.method, reference: body.reference ?? before.reference, paidAt: body.status === 'PAID' ? before.paidAt ?? new Date() : null }, include: feeInclude });
    await audit(prisma, { ...actorOf(req), action: 'fees.update', entityType: 'FeeInvoice', entityId: id, before: { status: before.status }, after: body });
    if (after.student.userId && body.status !== 'UNPAID') await notifyUsers(prisma, [after.student.userId], { type: 'fee.updated', title: `Semester fee marked ${body.status.toLowerCase()}`, body: 'You can now download your admit card.', payload: { invoiceId: id } });
    return after;
  });

  // ---------- student ----------
  app.get('/fees/me', { preHandler: [requireRole('STUDENT')] }, async (req) => {
    const s = await ownStudent(req.user!.id);
    const [invoices, admitCards] = await Promise.all([
      prisma.feeInvoice.findMany({ where: { studentId: s.id }, include: { semester: feeInclude.semester }, orderBy: { semester: { startDate: 'desc' } } }),
      prisma.admitCard.findMany({ where: { studentId: s.id }, select: { id: true, semesterId: true, cardNo: true, issuedAt: true } }),
    ]);
    return { invoices: invoices.map((i) => ({ ...i, amount: Number(i.amount), admitCard: admitCards.find((a) => a.semesterId === i.semesterId) ?? null })) };
  });

  /** Mock payment gateway: marks the invoice paid with a reference. Real eSewa/Khalti go here later. */
  app.post('/fees/:id/pay', async (req) => {
    const { id } = parse(idParam, req.params);
    const { method } = parse(z.object({ method: z.enum(['eSewa', 'Khalti', 'Bank transfer', 'Cash']).default('eSewa') }), req.body ?? {});
    const inv = await prisma.feeInvoice.findUnique({ where: { id }, include: feeInclude });
    if (!inv) throw notFound('Invoice not found');
    const u = req.user!;
    if (u.role === 'STUDENT' && inv.student.userId !== u.id) throw forbidden('Not your invoice');
    if (u.role !== 'STUDENT' && u.role !== 'ADMIN') throw forbidden('Only the student or the RTE admin can record a payment');
    if (inv.status === 'PAID') throw conflict('Already paid');
    const reference = `PAY-${inv.student.studentId}-${Date.now().toString(36).toUpperCase()}`;
    const after = await prisma.feeInvoice.update({ where: { id }, data: { status: 'PAID', paidAt: new Date(), method, reference }, include: feeInclude });
    await audit(prisma, { ...actorOf(req), action: 'fees.pay', entityType: 'FeeInvoice', entityId: id, before: { status: inv.status }, after: { status: 'PAID', method, reference } });
    if (inv.student.userId) await notifyUsers(prisma, [inv.student.userId], { type: 'fee.paid', title: 'Payment received', body: `Semester ${inv.semester.number} fee paid via ${method} (ref ${reference}). Your admit card is ready to issue.`, payload: { invoiceId: id } });
    return { ...after, amount: Number(after.amount) };
  });

  // ---------- admit cards ----------
  app.post('/admit-cards/issue', async (req, reply) => {
    const { semesterId, studentId } = parse(z.object({ semesterId: z.string(), studentId: z.string().optional() }), req.body);
    const u = req.user!;
    const student = u.role === 'STUDENT' ? await ownStudent(u.id) : await prisma.student.findFirst({ where: { id: studentId ?? '' }, select: { id: true, studentId: true } });
    if (!student) throw notFound('Student not found');
    if (u.role !== 'STUDENT' && u.role !== 'ADMIN') throw forbidden('Only the student or the RTE admin can issue an admit card');
    const inv = await prisma.feeInvoice.findUnique({ where: { studentId_semesterId: { studentId: student.id, semesterId } } });
    if (!inv) throw badRequest('No fee invoice exists for this semester yet');
    if (inv.status === 'UNPAID') throw conflict('Semester fee is unpaid. Pay the fee to receive your admit card.', { invoiceId: inv.id, amount: Number(inv.amount) });
    const sem = await prisma.semester.findUnique({ where: { id: semesterId }, select: { number: true } });
    const card = await prisma.admitCard.upsert({
      where: { studentId_semesterId: { studentId: student.id, semesterId } },
      create: { studentId: student.id, semesterId, cardNo: `AC-${student.studentId}-S${sem?.number ?? 0}`, issuedById: u.id },
      update: {},
    });
    await audit(prisma, { ...actorOf(req), action: 'admitcard.issue', entityType: 'AdmitCard', entityId: card.id, after: { cardNo: card.cardNo } });
    reply.code(201);
    return card;
  });

  app.get('/admit-cards/:id.pdf', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const card = await prisma.admitCard.findUnique({
      where: { id },
      include: { student: { include: { programme: true, intake: true, section: true, user: { select: { id: true } } } }, semester: { include: { intake: { include: { programme: true } } } } },
    });
    if (!card) throw notFound('Admit card not found');
    const u = req.user!;
    if (u.role === 'STUDENT' && card.student.user?.id !== u.id) throw forbidden('Not your admit card');
    const inv = await prisma.feeInvoice.findUnique({ where: { studentId_semesterId: { studentId: card.studentId, semesterId: card.semesterId } } });
    const exams = await prisma.examSession.findMany({
      where: { kind: { in: ['FINAL', 'RESIT'] }, offerings: { some: { semesterId: card.semesterId, enrollments: { some: { studentId: card.studentId, deletedAt: null } } } } },
      include: { offerings: { select: { module: { select: { code: true, title: true } } } }, venues: { select: { name: true } }, seatAllocations: { where: { studentId: card.studentId }, include: { venue: { select: { name: true } } } } },
      orderBy: { date: 'asc' },
    });

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.rect(0, 0, doc.page.width, 70).fill('#2D2F53');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(18).text('Islington College · RTE Department', 48, 22);
      doc.fontSize(11).font('Helvetica').text('EXAMINATION ADMIT CARD', 48, 46);
      doc.fillColor('#111');
      doc.moveDown(2.5);
      const s = card.student;
      const row = (k: string, v: string) => {
        doc.font('Helvetica-Bold').fontSize(10).text(k, 48, doc.y, { continued: true, width: 160 });
        doc.font('Helvetica').text(v);
      };
      row('Card no.', card.cardNo);
      row('Student ID', s.studentId);
      row('Name', s.name);
      row('Programme', `${s.programme.code} · ${s.programme.name}`);
      row('Intake / section', `${s.intake.label}${s.section ? ` · Section ${s.section.name}` : ''}`);
      row('Semester', `Semester ${card.semester.number} (${card.semester.term.toLowerCase()})`);
      row('Fee status', inv ? `${inv.status}${inv.reference ? ` · ref ${inv.reference}` : ''}` : '—');
      row('Issued', card.issuedAt.toISOString().slice(0, 10));
      doc.moveDown(1);
      doc.font('Helvetica-Bold').fontSize(12).text('Examinations');
      doc.moveDown(0.3);
      if (exams.length === 0) doc.font('Helvetica').fontSize(10).text('Exam timetable not yet published — this card remains valid for all examinations of the semester.');
      for (const e of exams) {
        const seat = e.seatAllocations[0];
        doc.font('Helvetica-Bold').fontSize(10).text(`${e.offerings.map((o) => o.module.code).join(', ')} · ${e.offerings.map((o) => o.module.title).join(', ')}`);
        doc.font('Helvetica').fontSize(10).text(`${e.date.toISOString().slice(0, 10)} · ${e.startTime} · ${e.durationMin} min · ${seat ? `${seat.venue.name} seat ${seat.seatLabel}` : `venue ${e.venues.map((v) => v.name).join(' / ')} (seat to be announced)`}`);
        doc.moveDown(0.4);
      }
      doc.moveDown(1.5);
      doc.fontSize(9).fillColor('#555').text('Bring this card and your student ID to every examination. Arrive 15 minutes before the start. Mobile phones must be switched off and left with the invigilator.');
      doc.moveDown(2);
      doc.fillColor('#111').text('______________________          ______________________');
      doc.text('Student signature                              Controller of Examinations');
      doc.end();
    });
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', `attachment; filename="admit-card-${card.cardNo}.pdf"`);
    return pdf;
  });

  app.get('/admit-cards', { preHandler: [requireRole(...STAFF)] }, async (req) => {
    const { semesterId } = parse(z.object({ semesterId: z.string().optional() }), req.query);
    return prisma.admitCard.findMany({ where: semesterId ? { semesterId } : {}, include: { student: { select: { studentId: true, name: true } }, semester: feeInclude.semester }, orderBy: { issuedAt: 'desc' }, take: 500 });
  });
}
