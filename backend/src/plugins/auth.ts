import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Role } from '@prisma/client';
import { forbidden, unauthorized } from '../lib/errors';
import { verifyAccessToken, type AuthUser } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { can, effectiveActions, parseOverrides, roleHas, type Action, type PermissionOverrides } from '../lib/actions';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    permissions?: PermissionOverrides | null;
  }
}

export const STAFF: Role[] = ['ADMIN', 'MODULE_LEADER', 'LECTURER'];
export const ALL_ROLES: Role[] = ['ADMIN', 'MODULE_LEADER', 'LECTURER', 'STUDENT'];

/** Per-user permission overrides, cached briefly so a toggle takes effect within seconds. */
const cache = new Map<string, { value: PermissionOverrides | null; at: number }>();
const TTL_MS = 10_000;

export function invalidatePermissions(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

export async function overridesFor(userId: string): Promise<PermissionOverrides | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { permissions: true } });
  const value = parseOverrides(row?.permissions);
  cache.set(userId, { value, at: Date.now() });
  return value;
}

/** preHandler: requires a valid Bearer access token; attaches req.user and its permission overrides. */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) throw unauthorized('Missing bearer token');
  try {
    req.user = verifyAccessToken(header.slice(7));
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  req.permissions = await overridesFor(req.user.id);
}

/** preHandler factory: deny unless the caller's role is in the list. Always used after `authenticate`. */
export function requireRole(...roles: Role[]): preHandlerHookHandler {
  return async (req) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden(`Requires role: ${roles.join(' or ')}`);
  };
}

/** preHandler factory: deny unless the caller holds the capability (role default ± per-user override). */
export function allow(action: Action): preHandlerHookHandler {
  return async (req) => {
    if (!req.user) throw unauthorized();
    const overrides = req.permissions ?? (await overridesFor(req.user.id));
    if (!can(req.user.role, action, overrides)) throw forbidden(`You do not have permission to: ${action}`);
  };
}

export { can, roleHas, effectiveActions, type Action };
