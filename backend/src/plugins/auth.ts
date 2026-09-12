import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Role } from '@prisma/client';
import { forbidden, unauthorized } from '../lib/errors';
import { verifyAccessToken, type AuthUser } from '../lib/jwt';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export const STAFF: Role[] = ['ADMIN', 'MODULE_LEADER', 'LECTURER'];
export const ALL_ROLES: Role[] = ['ADMIN', 'MODULE_LEADER', 'LECTURER', 'STUDENT'];

/** preHandler: requires a valid Bearer access token; attaches req.user. */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) throw unauthorized('Missing bearer token');
  try {
    req.user = verifyAccessToken(header.slice(7));
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

/** preHandler factory: deny unless the caller's role is in the list. Always used after `authenticate`. */
export function requireRole(...roles: Role[]): preHandlerHookHandler {
  return async (req) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden(`Requires role: ${roles.join(' or ')}`);
  };
}

/** Pure permission matrix — unit-tested, and the single place the rules live. */
export type Action =
  | 'programme.read' | 'programme.write'
  | 'module.read' | 'module.write'
  | 'student.read' | 'student.write'
  | 'marksheet.read' | 'marksheet.edit' | 'marksheet.submit' | 'marksheet.review' | 'marksheet.publish'
  | 'seating.read' | 'seating.generate'
  | 'dashboard.read'
  | 'audit.read';

const MATRIX: Record<Action, Role[]> = {
  'programme.read': STAFF,
  'programme.write': ['ADMIN'],
  'module.read': STAFF,
  'module.write': ['ADMIN'],
  'student.read': STAFF,
  'student.write': ['ADMIN'],
  'marksheet.read': STAFF,
  'marksheet.edit': ['ADMIN', 'LECTURER', 'MODULE_LEADER'],
  'marksheet.submit': ['ADMIN', 'LECTURER', 'MODULE_LEADER'],
  'marksheet.review': ['ADMIN', 'MODULE_LEADER'],
  'marksheet.publish': ['ADMIN'],
  'seating.read': STAFF,
  'seating.generate': ['ADMIN'],
  'dashboard.read': ['ADMIN', 'MODULE_LEADER'],
  'audit.read': ['ADMIN'],
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[action].includes(role);
}

export function allow(action: Action): preHandlerHookHandler {
  return requireRole(...MATRIX[action]);
}
