import type { MarkSheetStatus, Role } from '@prisma/client';

/**
 * Result-pipeline state machine.
 *
 * DRAFT ─submit─▶ SUBMITTED ─start_review─▶ UNDER_REVIEW ─approve─▶ APPROVED ─publish─▶ PUBLISHED
 *   ▲                                            │                                        │
 *   └──────────────── reject (reason) ◀──────────┘          request_correction (reason) ◀─┘
 *                                                                        ▼
 *                                                              CORRECTION_REQUESTED ─▶ new DRAFT version
 */
export type TransitionAction = 'submit' | 'start_review' | 'approve' | 'reject' | 'publish' | 'request_correction';

interface Transition {
  from: MarkSheetStatus[];
  to: MarkSheetStatus;
  roles: Role[];
  reasonRequired: boolean;
}

export const TRANSITIONS: Record<TransitionAction, Transition> = {
  submit: { from: ['DRAFT'], to: 'SUBMITTED', roles: ['LECTURER', 'MODULE_LEADER', 'ADMIN'], reasonRequired: false },
  start_review: { from: ['SUBMITTED'], to: 'UNDER_REVIEW', roles: ['MODULE_LEADER', 'ADMIN'], reasonRequired: false },
  approve: { from: ['UNDER_REVIEW'], to: 'APPROVED', roles: ['MODULE_LEADER', 'ADMIN'], reasonRequired: false },
  reject: { from: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'], to: 'DRAFT', roles: ['MODULE_LEADER', 'ADMIN'], reasonRequired: true },
  publish: { from: ['APPROVED'], to: 'PUBLISHED', roles: ['ADMIN'], reasonRequired: false },
  request_correction: { from: ['PUBLISHED'], to: 'CORRECTION_REQUESTED', roles: ['ADMIN', 'MODULE_LEADER'], reasonRequired: true },
};

export const EDITABLE_STATES: MarkSheetStatus[] = ['DRAFT'];

export class TransitionError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_STATE' | 'FORBIDDEN' | 'REASON_REQUIRED',
  ) {
    super(message);
  }
}

/** Throws unless `action` is valid from `status` for `role`. Returns the target status. */
export function assertTransition(status: MarkSheetStatus, action: TransitionAction, role: Role, reason?: string | null): MarkSheetStatus {
  const t = TRANSITIONS[action];
  if (!t.from.includes(status)) {
    throw new TransitionError(`Cannot ${action.replace('_', ' ')} a mark sheet that is ${status}`, 'INVALID_STATE');
  }
  if (!t.roles.includes(role)) {
    throw new TransitionError(`Role ${role} may not ${action.replace('_', ' ')} a mark sheet`, 'FORBIDDEN');
  }
  if (t.reasonRequired && !(reason && reason.trim().length >= 3)) {
    throw new TransitionError(`A reason is required to ${action.replace('_', ' ')}`, 'REASON_REQUIRED');
  }
  return t.to;
}

/** Actions available to a role from a given state — drives the buttons in the UI. */
export function availableActions(status: MarkSheetStatus, role: Role): TransitionAction[] {
  return (Object.keys(TRANSITIONS) as TransitionAction[]).filter((a) => {
    const t = TRANSITIONS[a];
    return t.from.includes(status) && t.roles.includes(role);
  });
}
