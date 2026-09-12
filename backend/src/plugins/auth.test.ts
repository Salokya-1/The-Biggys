import { describe, expect, it } from 'vitest';
import { ACTIONS, can, effectiveActions, roleHas } from '../lib/actions';

describe('permission matrix', () => {
  it('students hold only their own capabilities', () => {
    const student = effectiveActions('STUDENT');
    expect(student.sort()).toEqual(['assistant.use', 'request.create', 'timetable.read'].sort());
  });

  // Held by nobody by default: RTE gates admit cards on paid or unpaid and does not need the
  // sums, so an admin sees the ledger without the amounts until finance is granted them.
  const GRANT_ONLY = ['fees.amount'];

  it('admins hold everything except the capabilities reserved for an explicit grant', () => {
    expect(effectiveActions('ADMIN')).toHaveLength(ACTIONS.length - GRANT_ONLY.length);
    for (const key of GRANT_ONLY) expect(roleHas('ADMIN', key as never)).toBe(false);
  });

  it('a grant-only capability can still be given to one person', () => {
    expect(can('ADMIN', 'fees.amount', { grant: ['fees.amount'] })).toBe(true);
    expect(can('ADMIN', 'fees.amount', undefined)).toBe(false);
  });

  it('only admins publish, generate seating, manage users and read the audit log', () => {
    for (const action of ['marksheet.publish', 'seating.generate', 'users.manage', 'audit.read', 'fees.write', 'timetable.write'] as const) {
      expect(roleHas('ADMIN', action)).toBe(true);
      expect(roleHas('MODULE_LEADER', action)).toBe(false);
      expect(roleHas('LECTURER', action)).toBe(false);
      expect(roleHas('STUDENT', action)).toBe(false);
    }
  });

  it('lecturers can edit and submit but not review', () => {
    expect(roleHas('LECTURER', 'marksheet.edit')).toBe(true);
    expect(roleHas('LECTURER', 'marksheet.submit')).toBe(true);
    expect(roleHas('LECTURER', 'marksheet.review')).toBe(false);
    expect(roleHas('MODULE_LEADER', 'marksheet.review')).toBe(true);
  });

  it('a per-user grant adds one capability without changing the role', () => {
    const overrides = { grant: ['marksheet.publish'] };
    expect(can('LECTURER', 'marksheet.publish', overrides)).toBe(true);
    expect(can('LECTURER', 'users.manage', overrides)).toBe(false);
    expect(roleHas('LECTURER', 'marksheet.publish')).toBe(false); // the role itself is untouched
  });

  it('a per-user revoke removes a capability the role would have', () => {
    expect(can('ADMIN', 'marksheet.publish', { revoke: ['marksheet.publish'] })).toBe(false);
    expect(can('MODULE_LEADER', 'marksheet.review', { revoke: ['marksheet.review'] })).toBe(false);
  });

  it('revoke wins over grant', () => {
    expect(can('LECTURER', 'fees.write', { grant: ['fees.write'], revoke: ['fees.write'] })).toBe(false);
  });

  it('every action belongs to a group, and only the reserved ones have no default role', () => {
    for (const a of ACTIONS) {
      expect(a.group.length).toBeGreaterThan(0);
      if (!GRANT_ONLY.includes(a.key)) expect(a.roles.length).toBeGreaterThan(0);
    }
  });
});
