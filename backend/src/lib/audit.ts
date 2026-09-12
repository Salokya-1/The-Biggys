import { Prisma, type PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';

type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  actorId?: string | null;
  action: string; // e.g. "marksheet.approve"
  entityType: string; // e.g. "MarkSheet"
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Append an audit-log row. The table is append-only at the DB level. */
export async function audit(db: Db, entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: toJson(entry.before),
      after: toJson(entry.after),
      reason: entry.reason ?? null,
      ip: entry.ip ?? null,
    },
  });
}

/** Convenience: build the actor/ip part of an entry from a request. */
export function actorOf(req: FastifyRequest): { actorId: string | null; ip: string | null } {
  return { actorId: req.user?.id ?? null, ip: req.ip ?? null };
}
