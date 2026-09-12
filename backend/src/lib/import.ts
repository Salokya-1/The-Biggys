/**
 * Spreadsheet import: parse CSV/XLSX server-side, match rows to enrolments and
 * components, and produce a row-level validation preview. Nothing is written
 * to the database here — the caller commits only rows the user accepts.
 */
import * as XLSX from 'xlsx';

export interface ImportComponent {
  id: string;
  name: string;
  maxMark: number;
}

export interface ImportEnrollment {
  id: string;
  studentId: string; // institutional ID
  name: string;
}

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

export type RowLevel = 'ok' | 'warning' | 'error';

export interface ImportRowResult {
  rowNumber: number; // 1-based data row (header is row 0)
  studentId: string;
  name: string | null;
  enrollmentId: string | null;
  level: RowLevel;
  messages: string[];
  marks: { componentId: string; rawMark: number | null; isAbsent: boolean }[];
}

export interface ImportPreview {
  studentIdColumn: string | null;
  columnMap: Record<string, string>; // component id -> header used
  missingColumns: string[];
  rows: ImportRowResult[];
  summary: { total: number; ok: number; warnings: number; errors: number };
}

const ABSENT_TOKENS = new Set(['abs', 'absent', 'a', 'x', 'n/a', 'na']);
const ID_HEADERS = ['studentid', 'id', 'student', 'studentno', 'studentnumber', 'sid'];
const NAME_HEADERS = ['name', 'studentname', 'fullname'];

export const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

export function parseSpreadsheet(buffer: Buffer): ParsedSheet {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: false });
  const first = wb.SheetNames[0];
  if (!first) return { headers: [], rows: [] };
  const ws = wb.Sheets[first];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
  const headers = json.length ? Object.keys(json[0]).map((h) => h.trim()) : [];
  const rows = json.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), String(v ?? '').trim()])),
  );
  return { headers, rows };
}

function findHeader(headers: string[], candidates: string[]): string | null {
  for (const h of headers) if (candidates.includes(normalizeHeader(h))) return h;
  return null;
}

export function validateImport(sheet: ParsedSheet, components: ImportComponent[], enrollments: ImportEnrollment[]): ImportPreview {
  const { headers, rows } = sheet;
  const studentIdColumn = findHeader(headers, ID_HEADERS);
  const nameColumn = findHeader(headers, NAME_HEADERS);

  const columnMap: Record<string, string> = {};
  const missingColumns: string[] = [];
  for (const c of components) {
    const h = headers.find((x) => normalizeHeader(x) === normalizeHeader(c.name));
    if (h) columnMap[c.id] = h;
    else missingColumns.push(c.name);
  }

  const byStudentId = new Map(enrollments.map((e) => [e.studentId.toLowerCase(), e]));
  const seen = new Map<string, number>();
  const results: ImportRowResult[] = [];

  rows.forEach((row, i) => {
    const rowNumber = i + 1;
    const messages: string[] = [];
    let hasError = false;
    let hasWarning = false;
    const err = (m: string) => {
      messages.push(m);
      hasError = true;
    };
    const warn = (m: string) => {
      messages.push(m);
      hasWarning = true;
    };

    const rawId = studentIdColumn ? row[studentIdColumn] ?? '' : '';
    const studentId = rawId.trim();
    const name = nameColumn ? row[nameColumn] || null : null;

    if (!studentIdColumn) err('No student ID column found (expected a header like "Student ID")');
    else if (!studentId) err('Student ID is empty');

    const enrollment = studentId ? byStudentId.get(studentId.toLowerCase()) ?? null : null;
    if (studentId && !enrollment) err(`Student ${studentId} is not enrolled on this module offering`);

    if (studentId) {
      const key = studentId.toLowerCase();
      const first = seen.get(key);
      if (first !== undefined) err(`Duplicate row for student ${studentId} (also row ${first})`);
      else seen.set(key, rowNumber);
    }

    if (enrollment && name && name.toLowerCase() !== enrollment.name.toLowerCase()) {
      warn(`Name mismatch: sheet says "${name}", record says "${enrollment.name}"`);
    }

    const marks: ImportRowResult['marks'] = [];
    for (const c of components) {
      const header = columnMap[c.id];
      if (!header) {
        err(`Missing column for component "${c.name}"`);
        continue;
      }
      const cell = (row[header] ?? '').trim();
      if (cell === '') {
        warn(`${c.name}: blank (left as not entered)`);
        marks.push({ componentId: c.id, rawMark: null, isAbsent: false });
        continue;
      }
      if (ABSENT_TOKENS.has(cell.toLowerCase())) {
        warn(`${c.name}: marked absent`);
        marks.push({ componentId: c.id, rawMark: null, isAbsent: true });
        continue;
      }
      const n = Number(cell.replace(/,/g, ''));
      if (!Number.isFinite(n)) {
        err(`${c.name}: "${cell}" is not a number`);
        continue;
      }
      if (n < 0 || n > c.maxMark) {
        err(`${c.name}: ${n} is outside 0–${c.maxMark}`);
        continue;
      }
      marks.push({ componentId: c.id, rawMark: Math.round(n * 100) / 100, isAbsent: false });
    }

    results.push({
      rowNumber,
      studentId,
      name,
      enrollmentId: enrollment?.id ?? null,
      level: hasError ? 'error' : hasWarning ? 'warning' : 'ok',
      messages,
      marks,
    });
  });

  // Duplicate rows: mark the first occurrence as an error too, so neither is committed.
  const dupIds = new Set<string>();
  for (const r of results) if (r.messages.some((m) => m.startsWith('Duplicate row'))) dupIds.add(r.studentId.toLowerCase());
  for (const r of results) {
    if (dupIds.has(r.studentId.toLowerCase()) && !r.messages.some((m) => m.startsWith('Duplicate row'))) {
      r.messages.push(`Duplicate row for student ${r.studentId}`);
      r.level = 'error';
    }
  }

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.level === 'ok').length,
    warnings: results.filter((r) => r.level === 'warning').length,
    errors: results.filter((r) => r.level === 'error').length,
  };
  return { studentIdColumn, columnMap, missingColumns, rows: results, summary };
}

/** CSV template with one row per enrolled student and one column per component. */
export function buildTemplateCsv(components: ImportComponent[], enrollments: ImportEnrollment[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = ['Student ID', 'Name', ...components.map((c) => `${c.name}`)].map(esc).join(',');
  const lines = enrollments.map((e) => [e.studentId, e.name, ...components.map(() => '')].map(esc).join(','));
  return [header, ...lines].join('\r\n') + '\r\n';
}
