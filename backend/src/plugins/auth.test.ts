import { describe, expect, it } from 'vitest';
import { can } from './auth';

describe('permission matrix', () => {
  it('students can never touch staff-only actions', () => {
    for (const action of [
      'programme.read', 'programme.write', 'module.write', 'student.read', 'student.write',
      'marksheet.edit', 'marksheet.review', 'marksheet.publish', 'seating.generate', 'dashboard.read', 'audit.read',
    ] as const) {
      expect(can('STUDENT', action)).toBe(false);
    }
  });

  it('only admins publish, generate seating and read the audit log', () => {
    expect(can('ADMIN', 'marksheet.publish')).toBe(true);
    expect(can('MODULE_LEADER', 'marksheet.publish')).toBe(false);
    expect(can('LECTURER', 'marksheet.publish')).toBe(false);
    expect(can('ADMIN', 'seating.generate')).toBe(true);
    expect(can('LECTURER', 'seating.generate')).toBe(false);
    expect(can('ADMIN', 'audit.read')).toBe(true);
    expect(can('MODULE_LEADER', 'audit.read')).toBe(false);
  });

  it('lecturers can edit and submit but not review', () => {
    expect(can('LECTURER', 'marksheet.edit')).toBe(true);
    expect(can('LECTURER', 'marksheet.submit')).toBe(true);
    expect(can('LECTURER', 'marksheet.review')).toBe(false);
    expect(can('MODULE_LEADER', 'marksheet.review')).toBe(true);
  });
});
