import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { config } from '../config';

export const ACCESS_TTL_SEC = 15 * 60; // 15 minutes
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Student.id when the user is a student, otherwise null. */
  studentId: string | null;
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    { email: user.email, name: user.name, role: user.role, studentId: user.studentId },
    config.JWT_SECRET,
    { subject: user.id, expiresIn: ACCESS_TTL_SEC, issuer: 'the-biggys-api' },
  );
}

export function verifyAccessToken(token: string): AuthUser {
  const payload = jwt.verify(token, config.JWT_SECRET, { issuer: 'the-biggys-api' }) as jwt.JwtPayload;
  return {
    id: String(payload.sub),
    email: String(payload.email),
    name: String(payload.name),
    role: payload.role as Role,
    studentId: (payload.studentId as string | null) ?? null,
  };
}

/** Opaque refresh tokens: random, stored hashed, rotated on every use. */
export function newRefreshToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(48).toString('base64url');
  return { token, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token + config.JWT_REFRESH_SECRET).digest('hex');
}
