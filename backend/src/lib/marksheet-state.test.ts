import { describe, expect, it } from 'vitest';
import { assertTransition, availableActions } from './marksheet-state';

describe('mark sheet state machine', () => {
  it('walks the happy path', () => {
    expect(assertTransition('DRAFT', 'submit', 'LECTURER')).toBe('SUBMITTED');
    expect(assertTransition('SUBMITTED', 'start_review', 'MODULE_LEADER')).toBe('UNDER_REVIEW');
    expect(assertTransition('UNDER_REVIEW', 'approve', 'MODULE_LEADER')).toBe('APPROVED');
    expect(assertTransition('APPROVED', 'publish', 'ADMIN')).toBe('PUBLISHED');
  });

  it('only admins publish', () => {
    expect(() => assertTransition('APPROVED', 'publish', 'MODULE_LEADER')).toThrow(/may not publish/);
    expect(() => assertTransition('APPROVED', 'publish', 'LECTURER')).toThrow(/may not publish/);
  });

  it('lecturers cannot approve their own sheets', () => {
    expect(() => assertTransition('UNDER_REVIEW', 'approve', 'LECTURER')).toThrow(/may not approve/);
  });

  it('rejects out-of-order transitions', () => {
    expect(() => assertTransition('DRAFT', 'approve', 'ADMIN')).toThrow(/Cannot approve/);
    expect(() => assertTransition('PUBLISHED', 'submit', 'ADMIN')).toThrow(/Cannot submit/);
    expect(() => assertTransition('DRAFT', 'publish', 'ADMIN')).toThrow(/Cannot publish/);
  });

  it('requires a reason to reject or request a correction', () => {
    expect(() => assertTransition('UNDER_REVIEW', 'reject', 'MODULE_LEADER')).toThrow(/reason is required/);
    expect(() => assertTransition('UNDER_REVIEW', 'reject', 'MODULE_LEADER', '  ')).toThrow(/reason is required/);
    expect(assertTransition('UNDER_REVIEW', 'reject', 'MODULE_LEADER', 'Row 12 looks wrong')).toBe('DRAFT');
    expect(() => assertTransition('PUBLISHED', 'request_correction', 'ADMIN')).toThrow(/reason is required/);
    expect(assertTransition('PUBLISHED', 'request_correction', 'ADMIN', 'Transcription error')).toBe('CORRECTION_REQUESTED');
  });

  it('published sheets can only move to correction', () => {
    expect(availableActions('PUBLISHED', 'ADMIN')).toEqual(['request_correction']);
    expect(availableActions('PUBLISHED', 'LECTURER')).toEqual([]);
  });

  it('lists role-appropriate actions', () => {
    expect(availableActions('DRAFT', 'LECTURER')).toEqual(['submit']);
    expect(availableActions('SUBMITTED', 'MODULE_LEADER')).toEqual(['start_review', 'reject']);
    expect(availableActions('APPROVED', 'ADMIN')).toEqual(['reject', 'publish']);
  });
});
