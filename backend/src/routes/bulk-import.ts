import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { parse } from '../lib/validation';
import { badRequest } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow } from '../plugins/auth';
import { normalizeHeader, parseSpreadsheet } from '../lib/import';
import { CLASS_KINDS, TEACHING_DAYS, toMinutes, type ClassKind } from '../lib/timetable';

type Level = 'ok' | 'warning' | 'error';
interface Row {
  rowNumber: number;
  level: Level;
  message: string;
  data: Record<string, string>;
}

/** Headers are matched loosely: "Module Code", "module_code" and "modulecode" are the same column. */
function column(row: Record<string, string>, ...names: string[]): string {
  const map = new Map(Object.entries(row).map(([k, v]) => [normalizeHeader(k), v]));
  for (const n of names) {
    const v = map.get(normalizeHeader(n));
    if (v !== undefined && v !== '') return v.trim();
  }
  return '';
}

const DAY_BY_NAME: Record<string, number> = {
  sun: 7, sunday: 7, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

/** "630", "6:30", "06:30", "1330" all mean the same thing on a timetable. */
function readTime(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(':').map(Number);
    return h < 24 && m < 60 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : null;
  }
  if (/^\d{3,4}$/.test(s)) {
    const h = Number(s.slice(0, s.length - 2));
    const m = Number(s.slice(-2));
    return h < 24 && m < 60 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : null;
  }
  return null;
}

const readKind = (raw: string): ClassKind | null => {
  const k = raw.trim().toUpperCase();
  return (CLASS_KINDS as readonly string[]).includes(k) ? (k as ClassKind) : null;
};

/**
 * Bringing an existing spreadsheet in.
 *
 * Most departments already have their routine, their students and their staff in Excel, and being
 * told to retype it is how a new system gets abandoned. Every import runs in two steps — a preview
 * that validates each row and writes nothing, then a commit of only the rows that passed — so a
 * bad file can never half-load.
 */
export async function bulkImportRoutes(app: FastifyInstance) {
  async function read(req: FastifyRequest) {
    const file = await (req as unknown as { file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> } | undefined> }).file();
    if (!file) throw badRequest('Upload a CSV or XLSX file in the "file" field');
    const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
    if (!['csv', 'xlsx', 'xls'].includes(ext)) throw badRequest('Only .csv, .xlsx or .xls files are accepted');
    return { filename: file.filename, sheet: parseSpreadsheet(await file.toBuffer()) };
  }

  // ---------------------------------------------------------------- teachers
  async function checkTeachers(rows: Record<string, string>[]): Promise<Row[]> {
    const emails = new Set((await prisma.user.findMany({ select: { email: true } })).map((u) => u.email.toLowerCase()));
    const seen = new Set<string>();
    return rows.map((data, i) => {
      const rowNumber = i + 1;
      const name = column(data, 'Name', 'Teacher', 'Lecturer', 'Full Name');
      const email = column(data, 'Email', 'Email Address').toLowerCase();
      const role = (column(data, 'Role') || 'LECTURER').toUpperCase();
      if (!name) return { rowNumber, level: 'error' as Level, message: 'No name in this row', data };
      if (!email) return { rowNumber, level: 'error' as Level, message: `No email for ${name}`, data };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !email.endsWith('@demo')) return { rowNumber, level: 'error' as Level, message: `"${email}" is not an email address`, data };
      if (!['LECTURER', 'MODULE_LEADER'].includes(role)) return { rowNumber, level: 'error' as Level, message: `Role must be LECTURER or MODULE_LEADER, not "${role}"`, data };
      if (seen.has(email)) return { rowNumber, level: 'error' as Level, message: `${email} appears twice in this file`, data };
      seen.add(email);
      if (emails.has(email)) return { rowNumber, level: 'warning' as Level, message: `${email} already exists — their name and role will be updated`, data };
      return { rowNumber, level: 'ok' as Level, message: `${name} will be added as ${role === 'MODULE_LEADER' ? 'a module leader' : 'a lecturer'}`, data };
    });
  }

  // ---------------------------------------------------------------- students
  async function checkStudents(rows: Record<string, string>[]): Promise<Row[]> {
    const [existing, programmes, sections] = await Promise.all([
      prisma.student.findMany({ select: { studentId: true } }),
      prisma.programme.findMany({ select: { id: true, code: true, intakes: { select: { id: true, label: true, sections: { select: { id: true, name: true } } } } } }),
      prisma.section.findMany({ select: { id: true, name: true } }),
    ]);
    const have = new Set(existing.map((s) => s.studentId));
    const seen = new Set<string>();
    void sections;
    return rows.map((data, i) => {
      const rowNumber = i + 1;
      const studentId = column(data, 'Student ID', 'StudentId', 'ID');
      const name = column(data, 'Name', 'Student Name', 'Full Name');
      const programme = column(data, 'Programme', 'Course', 'Programme Code').toUpperCase();
      const intake = column(data, 'Intake', 'Intake Label');
      const group = column(data, 'Group', 'Section');
      if (!studentId) return { rowNumber, level: 'error' as Level, message: 'No student ID in this row', data };
      if (!name) return { rowNumber, level: 'error' as Level, message: `No name for ${studentId}`, data };
      if (seen.has(studentId)) return { rowNumber, level: 'error' as Level, message: `${studentId} appears twice in this file`, data };
      seen.add(studentId);
      if (have.has(studentId)) return { rowNumber, level: 'warning' as Level, message: `${studentId} already exists — their name and group will be updated`, data };
      const prog = programmes.find((p) => p.code.toUpperCase() === programme);
      if (!prog) return { rowNumber, level: 'error' as Level, message: `No programme "${programme}" — use one of ${programmes.map((p) => p.code).join(', ')}`, data };
      const intk = intake ? prog.intakes.find((x) => x.label.toLowerCase() === intake.toLowerCase()) : prog.intakes[0];
      if (!intk) return { rowNumber, level: 'error' as Level, message: `${programme} has no intake "${intake}"`, data };
      if (group && !intk.sections.some((s) => s.name.toLowerCase() === group.toLowerCase())) {
        return { rowNumber, level: 'error' as Level, message: `${programme} ${intk.label} has no group "${group}"`, data };
      }
      return { rowNumber, level: 'ok' as Level, message: `${name} joins ${prog.code} ${intk.label}${group ? ` group ${group}` : ''}`, data };
    });
  }

  // ---------------------------------------------------------------- timetable
  async function checkTimetable(rows: Record<string, string>[]): Promise<Row[]> {
    const [offerings, staff, venues, sections] = await Promise.all([
      prisma.moduleOffering.findMany({ select: { id: true, semesterId: true, module: { select: { code: true } }, semester: { select: { intake: { select: { label: true, programme: { select: { code: true } } } } } } } }),
      prisma.user.findMany({ where: { role: { in: ['LECTURER', 'MODULE_LEADER'] } }, select: { id: true, name: true } }),
      prisma.venue.findMany({ select: { id: true, name: true } }),
      prisma.section.findMany({ select: { id: true, name: true, intakeId: true } }),
    ]);
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return rows.map((data, i) => {
      const rowNumber = i + 1;
      const dayRaw = column(data, 'Day');
      const day = DAY_BY_NAME[dayRaw.trim().toLowerCase()] ?? (/^[1-7]$/.test(dayRaw) ? Number(dayRaw) : null);
      const start = readTime(column(data, 'Time Start', 'Start Time', 'Start'));
      const end = readTime(column(data, 'Time End', 'End Time', 'End'));
      const kind = readKind(column(data, 'Class Type', 'Kind', 'Type')) ?? 'LECTURE';
      const code = column(data, 'Module Code', 'Module', 'Code').replace(/NI$/i, '').toUpperCase();
      const teacherName = column(data, 'Lecturer', 'Teacher');
      const groupRaw = column(data, 'Group', 'Section');
      const roomName = column(data, 'Room', 'Venue');

      if (!day) return { rowNumber, level: 'error' as Level, message: `"${dayRaw}" is not a day`, data };
      if (!TEACHING_DAYS.includes(day)) return { rowNumber, level: 'error' as Level, message: `${dayRaw} is not a teaching day`, data };
      if (!start || !end) return { rowNumber, level: 'error' as Level, message: 'Start or end time could not be read', data };
      if (toMinutes(end) <= toMinutes(start)) return { rowNumber, level: 'error' as Level, message: 'The end time is not after the start time', data };

      const matching = offerings.filter((o) => o.module.code.toUpperCase() === code);
      if (!matching.length) return { rowNumber, level: 'error' as Level, message: `No module "${code}" is running`, data };
      const groups = groupRaw.split('+').map((g) => g.trim()).filter(Boolean);
      if (!groups.length) return { rowNumber, level: 'error' as Level, message: 'No group named', data };
      const offering = matching.find((o) => sections.some((s) => s.intakeId && groups.some((g) => clean(s.name) === clean(g)))) ?? matching[0];
      const found = groups.map((g) => sections.find((s) => clean(s.name) === clean(g)));
      const missing = groups.filter((_, idx) => !found[idx]);
      if (missing.length) return { rowNumber, level: 'error' as Level, message: `No group called ${missing.join(', ')}`, data };
      const teacher = staff.find((s) => clean(s.name) === clean(teacherName)) ?? staff.find((s) => clean(s.name).includes(clean(teacherName)) && clean(teacherName).length > 4);
      if (!teacher) return { rowNumber, level: 'error' as Level, message: `No teacher matching "${teacherName}"`, data };
      const venue = roomName ? venues.find((v) => clean(v.name) === clean(roomName)) ?? venues.find((v) => clean(v.name).startsWith(clean(roomName))) : undefined;
      if (roomName && !venue) return { rowNumber, level: 'warning' as Level, message: `No room called "${roomName}" — the class will be added without one`, data };

      void offering;
      return { rowNumber, level: 'ok' as Level, message: `${code} ${kind.toLowerCase()} for ${groups.join('+')} with ${teacher.name}${venue ? ` in ${venue.name}` : ''}`, data };
    });
  }

  const CHECKS = { teachers: checkTeachers, students: checkStudents, timetable: checkTimetable };
  const kindParam = z.object({ kind: z.enum(['teachers', 'students', 'timetable']) });

  /** Validate a file and describe every row. Nothing is written. */
  app.post('/import/:kind/preview', { preHandler: [allow('users.manage')] }, async (req) => {
    const { kind } = parse(kindParam, req.params);
    const { filename, sheet } = await read(req);
    if (!sheet.rows.length) throw badRequest('That file has no rows');
    const rows = await CHECKS[kind](sheet.rows);
    return {
      filename,
      headers: sheet.headers,
      total: rows.length,
      ok: rows.filter((r) => r.level === 'ok').length,
      warnings: rows.filter((r) => r.level === 'warning').length,
      errors: rows.filter((r) => r.level === 'error').length,
      rows,
    };
  });

  /** Write the rows that passed. Rows with an error are skipped, never guessed at. */
  app.post('/import/:kind/commit', { preHandler: [allow('users.manage')] }, async (req) => {
    const { kind } = parse(kindParam, req.params);
    const { filename, sheet } = await read(req);
    const rows = (await CHECKS[kind](sheet.rows)).filter((r) => r.level !== 'error');
    if (!rows.length) throw badRequest('Every row has an error — nothing to import');

    let created = 0;
    let updated = 0;
    const passwordHash = await bcrypt.hash('Demo1234!', 10);

    if (kind === 'teachers') {
      for (const r of rows) {
        const name = column(r.data, 'Name', 'Teacher', 'Lecturer', 'Full Name');
        const email = column(r.data, 'Email', 'Email Address').toLowerCase();
        const role = ((column(r.data, 'Role') || 'LECTURER').toUpperCase() === 'MODULE_LEADER' ? 'MODULE_LEADER' : 'LECTURER') as 'LECTURER' | 'MODULE_LEADER';
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          await prisma.user.update({ where: { id: existing.id }, data: { name, role } });
          updated += 1;
        } else {
          await prisma.user.create({ data: { email, name, role, passwordHash } });
          created += 1;
        }
      }
    }

    if (kind === 'students') {
      const programmes = await prisma.programme.findMany({ select: { id: true, code: true, intakes: { select: { id: true, label: true, semesters: { select: { id: true, number: true } }, sections: { select: { id: true, name: true } } } } } });
      for (const r of rows) {
        const studentId = column(r.data, 'Student ID', 'StudentId', 'ID');
        const name = column(r.data, 'Name', 'Student Name', 'Full Name');
        const programme = column(r.data, 'Programme', 'Course', 'Programme Code').toUpperCase();
        const intakeLabel = column(r.data, 'Intake', 'Intake Label');
        const group = column(r.data, 'Group', 'Section');
        const email = column(r.data, 'Email') || `${studentId}@student.demo`;
        const prog = programmes.find((p) => p.code.toUpperCase() === programme);
        const intake = prog ? (intakeLabel ? prog.intakes.find((x) => x.label.toLowerCase() === intakeLabel.toLowerCase()) : prog.intakes[0]) : undefined;
        const section = intake && group ? intake.sections.find((s) => s.name.toLowerCase() === group.toLowerCase()) : undefined;
        const current = intake?.semesters.slice().sort((a, b) => b.number - a.number)[0];

        const existing = await prisma.student.findUnique({ where: { studentId } });
        if (existing) {
          await prisma.student.update({ where: { id: existing.id }, data: { name, ...(section ? { sectionId: section.id } : {}) } });
          updated += 1;
        } else if (prog && intake) {
          const userId = randomUUID();
          await prisma.user.create({ data: { id: userId, email, name, role: 'STUDENT', passwordHash } });
          await prisma.student.create({
            data: { studentId, name, email, programmeId: prog.id, intakeId: intake.id, sectionId: section?.id ?? null, currentSemesterId: current?.id ?? null, userId, status: 'ACTIVE' },
          });
          created += 1;
        }
      }
    }

    if (kind === 'timetable') {
      const [offerings, staff, venues, sections] = await Promise.all([
        prisma.moduleOffering.findMany({ select: { id: true, semesterId: true, module: { select: { code: true } } } }),
        prisma.user.findMany({ where: { role: { in: ['LECTURER', 'MODULE_LEADER'] } }, select: { id: true, name: true } }),
        prisma.venue.findMany({ select: { id: true, name: true } }),
        prisma.section.findMany({ select: { id: true, name: true, intakeId: true } }),
      ]);
      const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const r of rows) {
        const dayRaw = column(r.data, 'Day');
        const day = DAY_BY_NAME[dayRaw.trim().toLowerCase()] ?? Number(dayRaw);
        const start = readTime(column(r.data, 'Time Start', 'Start Time', 'Start'))!;
        const end = readTime(column(r.data, 'Time End', 'End Time', 'End'))!;
        const kindValue = readKind(column(r.data, 'Class Type', 'Kind', 'Type')) ?? 'LECTURE';
        const code = column(r.data, 'Module Code', 'Module', 'Code').replace(/NI$/i, '').toUpperCase();
        const teacher = staff.find((s) => clean(s.name) === clean(column(r.data, 'Lecturer', 'Teacher'))) ?? staff.find((s) => clean(s.name).includes(clean(column(r.data, 'Lecturer', 'Teacher'))));
        const groupNames = column(r.data, 'Group', 'Section').split('+').map((g) => g.trim()).filter(Boolean);
        const groupRows = groupNames.map((g) => sections.find((s) => clean(s.name) === clean(g))!).filter(Boolean);
        const venue = venues.find((v) => clean(v.name) === clean(column(r.data, 'Room', 'Venue')));
        const offering = offerings.find((o) => o.module.code.toUpperCase() === code);
        if (!offering || !teacher || !groupRows.length) continue;

        const slotId = randomUUID();
        await prisma.timetableSlot.create({
          data: {
            id: slotId,
            semesterId: offering.semesterId,
            sectionId: groupRows[0].id,
            moduleOfferingId: offering.id,
            teacherId: teacher.id,
            venueId: venue?.id ?? null,
            kind: kindValue,
            dayOfWeek: day,
            startTime: start,
            endTime: end,
            groups: { connect: groupRows.map((g) => ({ id: g.id })) },
          },
        });
        created += 1;
      }
    }

    await audit(prisma, { ...actorOf(req), action: `import.${kind}`, entityType: 'Import', entityId: filename, after: { created, updated, rows: rows.length } });
    return { kind, filename, created, updated, skipped: sheet.rows.length - rows.length };
  });

  /** A blank file with the right headers, so nobody has to guess the format. */
  app.get('/import/:kind/template.csv', { preHandler: [allow('users.manage')] }, async (req, reply) => {
    const { kind } = parse(kindParam, req.params);
    const headers = {
      teachers: ['Name', 'Email', 'Role'],
      students: ['Student ID', 'Name', 'Email', 'Programme', 'Intake', 'Group'],
      timetable: ['Day', 'Time Start', 'Time End', 'Class Type', 'Module Code', 'Lecturer', 'Group', 'Room'],
    }[kind];
    const example = {
      teachers: ['Mr. Ramesh Poudel', 'ramesh.poudel@islington.edu.np', 'LECTURER'],
      students: ['26010161', 'Aarav Shrestha', '26010161@student.demo', 'BSCC', 'Sep 2026', 'C1'],
      timetable: ['SUN', '0630', '0830', 'Workshop', 'CS4001NI', 'Mr. Ramesh Poudel', 'C1', 'Lab 01 - Sarun Dahal'],
    }[kind];
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${kind}-template.csv"`);
    return `${headers.join(',')}\n${example.map((v) => (/[",]/.test(v) ? `"${v}"` : v)).join(',')}\n`;
  });
}
