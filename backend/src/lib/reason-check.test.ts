import { describe, expect, it } from 'vitest';
import { checkReason } from './reason-check';

const verdict = (s: string) => checkReason(s).verdict;

describe('checkReason', () => {
  it('rejects keyboard mashing', () => {
    for (const junk of ['hfiudewhfie', 'asdfghjkl', 'qwertyuiop', 'jkjkjkjkjkjk', 'xzcvbnmxzcv', 'aaaaaaaaaaaa', 'sdkjfhskdjfh sdkjfh']) {
      expect(verdict(junk), junk).toBe('GIBBERISH');
    }
  });

  it('rejects empty and one-word non-answers', () => {
    expect(verdict('')).toBe('GIBBERISH');
    expect(verdict('...')).toBe('GIBBERISH');
    expect(verdict('idk')).toBe('GIBBERISH');
    expect(verdict('123456789')).toBe('GIBBERISH');
  });

  it('accepts genuine reasons', () => {
    for (const good of [
      'Medical appointment at Bir Hospital on Monday morning.',
      'I have a doctor appointment for a fever and cannot attend the class.',
      'Family wedding in Pokhara, I will travel that day.',
      'My work shift was changed and it clashes with this class at 08:00.',
      'Guest lecture in the auditorium, the room is needed for the event.',
      'Bandh in Kathmandu so no transport is running to college.',
    ]) {
      expect(verdict(good), good).toBe('OK');
    }
  });

  it('flags short real words as weak rather than rejecting them', () => {
    expect(verdict('i am sick')).not.toBe('OK');
    expect(['WEAK', 'GIBBERISH']).toContain(verdict('personal work'));
  });

  it('classifies the reason', () => {
    expect(checkReason('Doctor appointment at the hospital tomorrow morning.').category).toBe('medical');
    expect(checkReason('My flight from Pokhara was delayed by the airline.').category).toBe('travel');
    expect(checkReason('It clashes with my other class in the timetable.').category).toBe('academic');
  });

  it('explains itself', () => {
    const r = checkReason('hfiudewhfie');
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(35);
    const ok = checkReason('I have a medical appointment at the hospital on Friday at 09:00.');
    expect(ok.score).toBeGreaterThan(70);
  });
});
