/**
 * Outgoing mail.
 *
 * Every message is written to the `EmailMessage` outbox first, then delivered if SMTP is
 * configured. That ordering is deliberate: the record of what the system told whom survives a
 * mail outage, a missing password and a demo laptop with no network, and the outbox is what the
 * Users screen shows. Without `SMTP_URL` the row simply stays QUEUED and the body is logged, so
 * nothing silently disappears and no feature depends on a mail server existing.
 */
import type { PrismaClient } from '@prisma/client';

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
  relatedType?: string;
  relatedId?: string;
}

/** Where IT support requests go. Override per deployment with IT_SUPPORT_EMAIL. */
export const IT_SUPPORT_EMAIL = process.env.IT_SUPPORT_EMAIL || 'salokyaghimire133@gmail.com';

const FROM = process.env.SMTP_FROM || 'RTE Management System <no-reply@islington.edu.np>';

/** True when a real SMTP server is configured; the UI says so rather than pretending. */
export const mailerConfigured = () => Boolean(process.env.SMTP_URL);

export async function sendEmail(prisma: PrismaClient, mail: OutgoingEmail) {
  const row = await prisma.emailMessage.create({
    data: { to: mail.to, subject: mail.subject, body: mail.body, relatedType: mail.relatedType ?? null, relatedId: mail.relatedId ?? null },
  });

  if (!mailerConfigured()) {
    console.info(`email queued for ${mail.to} — "${mail.subject}" (set SMTP_URL to deliver it)`);
    return row;
  }

  try {
    // Imported lazily so the API starts and runs without the dependency being touched.
    const { createTransport } = await import('nodemailer');
    const transport = createTransport(process.env.SMTP_URL);
    await transport.sendMail({ from: FROM, to: mail.to, subject: mail.subject, text: mail.body });
    return prisma.emailMessage.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date() } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`email delivery failed for ${mail.to}: ${message}`);
    return prisma.emailMessage.update({ where: { id: row.id }, data: { status: 'FAILED', error: message.slice(0, 500) } });
  }
}
