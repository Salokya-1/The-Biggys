import { describe, expect, it } from 'vitest';
import { buildTemplateCsv, parseSpreadsheet, validateImport } from './import';

const components = [
  { id: 'cw', name: 'Coursework', maxMark: 100 },
  { id: 'ex', name: 'Exam', maxMark: 50 },
];
const enrollments = [
  { id: 'e1', studentId: '23012345', name: 'Dipesh Karki' },
  { id: 'e2', studentId: '23012346', name: 'Sita Rai' },
  { id: 'e3', studentId: '23012347', name: 'Ram Thapa' },
];

const csv = (text: string) => parseSpreadsheet(Buffer.from(text, 'utf8'));

describe('validateImport', () => {
  it('accepts clean rows', () => {
    const p = validateImport(csv('Student ID,Name,Coursework,Exam\n23012345,Dipesh Karki,80,25\n23012346,Sita Rai,55,30\n'), components, enrollments);
    expect(p.summary).toEqual({ total: 2, ok: 2, warnings: 0, errors: 0 });
    expect(p.rows[0].marks).toEqual([
      { componentId: 'cw', rawMark: 80, isAbsent: false },
      { componentId: 'ex', rawMark: 25, isAbsent: false },
    ]);
    expect(p.rows[0].enrollmentId).toBe('e1');
  });

  it('blocks a mark of 105 and a non-number with plain-English messages', () => {
    const p = validateImport(csv('Student ID,Coursework,Exam\n23012345,105,25\n23012346,fifty,30\n'), components, enrollments);
    expect(p.rows[0].level).toBe('error');
    expect(p.rows[0].messages[0]).toMatch(/105 is outside 0–100/);
    expect(p.rows[1].messages[0]).toMatch(/"fifty" is not a number/);
    expect(p.summary.errors).toBe(2);
  });

  it('blocks both rows of a duplicate student ID', () => {
    const p = validateImport(csv('Student ID,Coursework,Exam\n23012345,80,25\n23012345,70,20\n'), components, enrollments);
    expect(p.rows.every((r) => r.level === 'error')).toBe(true);
    expect(p.rows[1].messages[0]).toMatch(/Duplicate row.*also row 1/);
  });

  it('rejects students who are not enrolled', () => {
    const p = validateImport(csv('Student ID,Coursework,Exam\n99999999,80,25\n'), components, enrollments);
    expect(p.rows[0].level).toBe('error');
    expect(p.rows[0].messages[0]).toMatch(/not enrolled/);
  });

  it('treats ABS as absent and blanks as not entered (warnings, not errors)', () => {
    const p = validateImport(csv('Student ID,Coursework,Exam\n23012345,ABS,\n'), components, enrollments);
    expect(p.rows[0].level).toBe('warning');
    expect(p.rows[0].marks).toEqual([
      { componentId: 'cw', rawMark: null, isAbsent: true },
      { componentId: 'ex', rawMark: null, isAbsent: false },
    ]);
  });

  it('warns on a name mismatch but still maps the row', () => {
    const p = validateImport(csv('Student ID,Name,Coursework,Exam\n23012345,Deepesh Karki,80,25\n'), components, enrollments);
    expect(p.rows[0].level).toBe('warning');
    expect(p.rows[0].messages[0]).toMatch(/Name mismatch/);
    expect(p.rows[0].enrollmentId).toBe('e1');
  });

  it('matches component columns case- and punctuation-insensitively', () => {
    const p = validateImport(csv('student_id,COURSEWORK,exam\n23012345,80,25\n'), components, enrollments);
    expect(p.missingColumns).toEqual([]);
    expect(p.rows[0].level).toBe('ok');
  });

  it('reports missing component columns', () => {
    const p = validateImport(csv('Student ID,Coursework\n23012345,80\n'), components, enrollments);
    expect(p.missingColumns).toEqual(['Exam']);
    expect(p.rows[0].level).toBe('error');
  });

  it('reports a missing student ID column', () => {
    const p = validateImport(csv('Foo,Coursework,Exam\n1,80,25\n'), components, enrollments);
    expect(p.studentIdColumn).toBeNull();
    expect(p.rows[0].messages[0]).toMatch(/No student ID column/);
  });
});

describe('buildTemplateCsv', () => {
  it('lists every enrolled student with empty component cells', () => {
    const t = buildTemplateCsv(components, enrollments);
    expect(t.split('\r\n')[0]).toBe('Student ID,Name,Coursework,Exam');
    expect(t.split('\r\n')[1]).toBe('23012345,Dipesh Karki,,');
    // round-trips through the parser
    const p = validateImport(parseSpreadsheet(Buffer.from(t)), components, enrollments);
    expect(p.summary.total).toBe(3);
    expect(p.summary.errors).toBe(0);
  });
});
