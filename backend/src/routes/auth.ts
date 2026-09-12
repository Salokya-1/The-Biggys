import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { parse } from '../lib/validation';
import { locked, unauthorized } from '../lib/errors';
import { audit } from '../lib/audit';
import { hashToken, newRefreshToken, signAccessToken, ACCESS_TTL_SEC, type AuthUser } from '../lib/jwt';
import { authenticate } from '../plugins/auth';
import { effectiveActions, parseOverrides } from '../lib/actions';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const loginBody = z.object({ email: z.string().email().or(z.string().min(3)), password: z.string().min(1) });
const refreshBody = z.object({ refreshToken: z.string().min(10) });

async function toAuthUser(userId: string): Promise<AuthUser | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { student: { select: { id: true } } } });
  if (!u || !u.isActive) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, studentId: u.student?.id ?? null };
}

/** The capabilities this account actually holds, so the web app hides what it cannot do. */
async function actionsFor(userId: string): Promise<string[]> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, permissions: true } });
  return u ? effectiveActions(u.role, parseOverrides(u.permissions)) : [];
}

async function issueTokens(user: AuthUser) {
  const rt = newRefreshToken();
  await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: rt.tokenHash, expiresAt: rt.expiresAt } });
  return { accessToken: signAccessToken(user), refreshToken: rt.token, expiresIn: ACCESS_TTL_SEC, user: { ...user, actions: await actionsFor(user.id) } };
}

export async function authRoutes(app: FastifyInstance) {
  // Per-IP limit; the account lockout below is the per-user brake. 30/min tolerates a shared campus NAT.
  app.post('/login', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { email, password } = parse(loginBody, req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Same message for unknown email and wrong password — no account enumeration.
    if (!user || !user.isActive) throw unauthorized('Invalid email or password');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw locked(`Account locked until ${user.lockedUntil.toISOString()} after repeated failed logins`);
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      const lockedUntil = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: lockedUntil ? 0 : failed, lockedUntil },
      });
      await audit(prisma, { actorId: user.id, action: 'auth.login_failed', entityType: 'User', entityId: user.id, ip: req.ip, after: { lockedUntil } });
      throw unauthorized('Invalid email or password');
    }

    if (user.failedLogins > 0 || user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    }
    const authUser = (await toAuthUser(user.id))!;
    await audit(prisma, { actorId: user.id, action: 'auth.login', entityType: 'User', entityId: user.id, ip: req.ip });
    return issueTokens(authUser);
  });

  app.post('/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { refreshToken } = parse(refreshBody, req.body);
    const tokenHash = hashToken(refreshToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) throw unauthorized('Invalid refresh token');

    if (stored.revokedAt) {
      // Reuse of a rotated token: someone replayed it. Revoke the whole family.
      await prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(prisma, { actorId: stored.userId, action: 'auth.refresh_reuse_detected', entityType: 'User', entityId: stored.userId, ip: req.ip });
      throw unauthorized('Refresh token reuse detected; please sign in again');
    }
    if (stored.expiresAt < new Date()) throw unauthorized('Refresh token expired');

    const user = await toAuthUser(stored.userId);
    if (!user) throw unauthorized('Account inactive');

    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return issueTokens(user);
  });

  app.post('/logout', async (req) => {
    const { refreshToken } = parse(refreshBody, req.body);
    await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  });

  app.get('/me', { preHandler: [authenticate] }, async (req) => {
    const user = await toAuthUser(req.user!.id);
    if (!user) throw unauthorized('Account inactive');
    return { ...user, actions: await actionsFor(user.id) };
  });
}
