import { Prisma, type PrismaClient, type Role } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export interface NotificationInput {
  type: string; // e.g. marksheet.submitted, result.published
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

export async function notifyUsers(db: Db, userIds: string[], n: NotificationInput) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const res = await db.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      type: n.type,
      title: n.title,
      body: n.body,
      payload: (n.payload ?? {}) as Prisma.InputJsonValue,
    })),
  });
  return res.count;
}

export async function notifyRole(db: Db, role: Role, n: NotificationInput) {
  const users = await db.user.findMany({ where: { role, isActive: true }, select: { id: true } });
  return notifyUsers(db, users.map((u) => u.id), n);
}
