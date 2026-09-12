import type { Role } from '@prisma/client';

/**
 * Every capability in the system, with the roles that hold it by default.
 * Admins can grant or revoke any of these per user (User.permissions), so the RTE office
 * can, for example, let one lecturer publish results without making them an admin.
 */
export const ACTIONS = [
  // Records
  { key: 'student.read', label: 'View student records', group: 'Records', roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { key: 'student.write', label: 'Add / edit / withdraw students', group: 'Records', roles: ['ADMIN'] },
  { key: 'programme.read', label: 'View programmes and intakes', group: 'Records', roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { key: 'programme.write', label: 'Manage programmes, intakes, semesters', group: 'Records', roles: ['ADMIN'] },
  { key: 'module.read', label: 'View modules and class lists', group: 'Records', roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { key: 'module.write', label: 'Manage modules and offerings', group: 'Records', roles: ['ADMIN'] },
  // Results
  { key: 'marksheet.read', label: 'View mark sheets', group: 'Results', roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { key: 'marksheet.edit', label: 'Enter and import marks', group: 'Results', roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { key: 'marksheet.submit', label: 'Submit marks for review', group: 'Results', roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { key: 'marksheet.review', label: 'Review, approve or return marks', group: 'Results', roles: ['ADMIN', 'MODULE_LEADER'] },
  { key: 'marksheet.publish', label: 'Publish results to students', group: 'Results', roles: ['ADMIN'] },
  // Exams
  { key: 'seating.read', label: 'View exams, venues and seating', group: 'Examinations', roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { key: 'seating.generate', label: 'Generate exam seating', group: 'Examinations', roles: ['ADMIN'] },
  { key: 'exam.create', label: 'Create exams and class tests', group: 'Examinations', roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER'] },
  { key: 'exam.schedule', label: 'Generate the semester exam schedule', group: 'Examinations', roles: ['ADMIN'] },
  { key: 'venue.write', label: 'Manage venues and room layouts', group: 'Examinations', roles: ['ADMIN'] },
  // Timetable
  { key: 'timetable.read', label: 'View timetables', group: 'Timetable', roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER', 'STUDENT'] },
  { key: 'timetable.write', label: 'Generate and edit the routine', group: 'Timetable', roles: ['ADMIN'] },
  { key: 'request.create', label: 'Submit absence / change requests', group: 'Timetable', roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER', 'STUDENT'] },
  { key: 'request.decide', label: 'Approve or reject requests', group: 'Timetable', roles: ['ADMIN', 'MODULE_LEADER'] },
  // Finance
  { key: 'fees.read', label: 'View the fee ledger', group: 'Finance', roles: ['ADMIN'] },
  { key: 'fees.write', label: 'Record payments, waivers and invoices', group: 'Finance', roles: ['ADMIN'] },
  // Administration
  { key: 'dashboard.read', label: 'View the operations dashboard', group: 'Administration', roles: ['ADMIN', 'MODULE_LEADER'] },
  { key: 'audit.read', label: 'Read the audit log', group: 'Administration', roles: ['ADMIN'] },
  { key: 'users.manage', label: 'Manage users, roles and permissions', group: 'Administration', roles: ['ADMIN'] },
  { key: 'retakes.run', label: 'Generate summer retakes', group: 'Administration', roles: ['ADMIN'] },
  { key: 'assistant.use', label: 'Use the AI assistant', group: 'Administration', roles: ['ADMIN', 'MODULE_LEADER', 'LECTURER', 'STUDENT'] },
] as const satisfies readonly { key: string; label: string; group: string; roles: readonly Role[] }[];

export type Action = (typeof ACTIONS)[number]['key'];

export interface PermissionOverrides {
  grant?: string[];
  revoke?: string[];
}

const BY_KEY = new Map(ACTIONS.map((a) => [a.key as string, a]));

export const isAction = (key: string): key is Action => BY_KEY.has(key);

/** Default capability of a role, before per-user overrides. */
export function roleHas(role: Role, action: Action): boolean {
  const def = BY_KEY.get(action);
  return !!def && (def.roles as readonly string[]).includes(role);
}

/** Effective capability: role default, plus per-user grants, minus per-user revokes. */
export function can(role: Role, action: Action, overrides?: PermissionOverrides | null): boolean {
  if (overrides?.revoke?.includes(action)) return false;
  if (overrides?.grant?.includes(action)) return true;
  return roleHas(role, action);
}

/** Everything a user may do — used by the web app to hide what it cannot do. */
export function effectiveActions(role: Role, overrides?: PermissionOverrides | null): Action[] {
  return ACTIONS.map((a) => a.key as Action).filter((k) => can(role, k, overrides));
}

export function parseOverrides(value: unknown): PermissionOverrides | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && isAction(s)) : undefined);
  const grant = list(v.grant);
  const revoke = list(v.revoke);
  return grant?.length || revoke?.length ? { grant, revoke } : null;
}
