import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { parse } from '../lib/validation';
import { allow } from '../plugins/auth';
import { CLASS_KIND_LABEL, toMinutes, type ClassKind } from '../lib/timetable';

/** The sheet writes days as three letters, Sunday first. */
const DAY_CODE: Record<number, string> = { 7: 'SUN', 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT' };
const DAY_ORDER: Record<number, number> = { 7: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

/** "06:30" → 630, the way the live sheet stores a time. */
const hhmm = (t: string) => Number(t.replace(':', ''));
const hours = (start: string, end: string) => Math.round(((toMinutes(end) - toMinutes(start)) / 60) * 100) / 100;
const ampm = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
};
/** Islington writes London Met codes with an NI suffix. */
const niCode = (code: string) => (code.endsWith('NI') ? code : `${code}NI`);

const rowsInclude = {
  section: { select: { name: true } },
  groups: { select: { name: true } },
  teacher: { select: { id: true, name: true } },
  venue: { select: { name: true, building: true } },
  moduleOffering: { select: { module: { select: { code: true, title: true } } } },
  semester: {
    select: { number: true, term: true, intake: { select: { label: true, programme: { select: { code: true, name: true } } } } },
  },
} as const;

/** Course and specialisation labels, in the sheet's shorthand. */
const COURSE: Record<string, { course: string; spec: string }> = {
  BSCC: { course: 'IT', spec: 'C' },
  BSCAI: { course: 'IT', spec: 'AI' },
  BSCNIS: { course: 'IT', spec: 'N' },
  BSCMT: { course: 'IT', spec: 'M' },
  BABA: { course: 'BBA', spec: 'BBA' },
  BAAF: { course: 'BAF', spec: 'BAF' },
};

interface AllocationRow {
  day: string;
  dayOrder: number;
  start: number;
  startTime: string;
  endTime: string;
  end: number;
  hours: number;
  classType: string;
  year: number;
  course: string;
  specialisation: string;
  moduleCode: string;
  moduleTitle: string;
  lecturer: string;
  lecturerId: string;
  group: string;
  block: string;
  room: string;
}

async function loadRows(semesterId?: string): Promise<AllocationRow[]> {
  const slots = await prisma.timetableSlot.findMany({ where: semesterId ? { semesterId } : {}, include: rowsInclude });
  return slots
    .map((s): AllocationRow => {
      const programme = s.semester.intake.programme.code;
      const naming = COURSE[programme] ?? { course: programme, spec: programme };
      const year = Math.min(3, Math.max(1, Math.ceil(s.semester.number / 2)));
      const semesterInYear = s.semester.number % 2 === 1 ? 1 : 2;
      // A lecture lists every group in the room, joined the way the sheet joins them.
      const group = (s.groups.length ? s.groups.map((g) => g.name) : [s.section.name]).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join('+');
      return {
        day: DAY_CODE[s.dayOfWeek] ?? String(s.dayOfWeek),
        dayOrder: DAY_ORDER[s.dayOfWeek] ?? 9,
        start: hhmm(s.startTime),
        startTime: s.startTime,
        endTime: s.endTime,
        end: hhmm(s.endTime),
        hours: hours(s.startTime, s.endTime),
        classType: CLASS_KIND_LABEL[s.kind as ClassKind],
        year,
        course: naming.course,
        specialisation: `${naming.spec} [S${semesterInYear}]`,
        moduleCode: niCode(s.moduleOffering.module.code),
        moduleTitle: s.moduleOffering.module.title,
        lecturer: s.teacher.name,
        lecturerId: s.teacher.id,
        group,
        block: s.venue?.building ?? '',
        room: s.venue?.name ?? '',
      };
    })
    .sort((a, b) => a.dayOrder - b.dayOrder || a.start - b.start || a.moduleCode.localeCompare(b.moduleCode));
}

const HEADERS = ['Day', 'Time Start', 'Time End', 'Hours', 'Class Type', 'Year', 'Course', 'Specialization', 'Module Code', 'Module Title', 'Lecturer', 'Group', 'Block', 'Room'];
const WIDTHS = [7, 11, 10, 7, 11, 6, 9, 15, 13, 34, 26, 22, 10, 28];
const line = (r: AllocationRow) => [r.day, r.start, r.end, r.hours, r.classType, r.year, r.course, r.specialisation, r.moduleCode, r.moduleTitle, r.lecturer, r.group, r.block, r.room];

/**
 * Resource allocation, in the format RTE already works in.
 *
 * The department keeps the timetable as one row per session — day, time, hours, class type, year,
 * course, specialisation, module, lecturer, group, block, room — with a module view, a sheet per
 * year, and a workload sheet that totals each lecturer's contact hours. Exporting exactly that
 * shape means the generated routine can be checked against, and dropped into, what they use now.
 */
export async function allocationRoutes(app: FastifyInstance) {
  app.get('/timetable/allocation', { preHandler: [allow('timetable.read')] }, async (req) => {
    const { semesterId } = parse(z.object({ semesterId: z.string().optional() }), req.query);
    const rows = await loadRows(semesterId);
    const workload = new Map<string, { lecturer: string; sessions: number; hours: number }>();
    for (const r of rows) {
      const w = workload.get(r.lecturerId) ?? { lecturer: r.lecturer, sessions: 0, hours: 0 };
      w.sessions += 1;
      w.hours = Math.round((w.hours + r.hours) * 100) / 100;
      workload.set(r.lecturerId, w);
    }
    return {
      columns: HEADERS,
      rows,
      workload: [...workload.values()].sort((a, b) => b.hours - a.hours),
      totals: { sessions: rows.length, hours: Math.round(rows.reduce((n, r) => n + r.hours, 0) * 10) / 10 },
    };
  });

  app.get('/timetable/allocation.xlsx', { preHandler: [allow('timetable.read')] }, async (req, reply) => {
    const { semesterId } = parse(z.object({ semesterId: z.string().optional() }), req.query);
    const rows = await loadRows(semesterId);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'RTE Management System';
    wb.created = new Date();

    const sheet = (name: string, data: AllocationRow[], title?: string[]) => {
      const ws = wb.addWorksheet(name.slice(0, 31));
      if (title) {
        for (const line of title) ws.addRow([line]).font = { bold: true };
        ws.addRow([]);
      }
      const header = ws.addRow(HEADERS);
      header.font = { bold: true };
      header.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
        c.border = { bottom: { style: 'thin' } };
      });
      WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));
      for (const r of data) ws.addRow(line(r));
      ws.views = [{ state: 'frozen', ySplit: header.number }];
      ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: HEADERS.length } };
      return ws;
    };

    // Module view: every session in the college, the master sheet.
    sheet('Module view', rows);

    // One sheet per course and year, the way the department circulates it.
    const groups = new Map<string, AllocationRow[]>();
    for (const r of rows) groups.set(`${r.course} Year ${r.year}`, [...(groups.get(`${r.course} Year ${r.year}`) ?? []), r]);
    for (const [name, data] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
      sheet(name, data, ['LONDON METROPOLITAN UNIVERSITY', `${name.toUpperCase()} TIME TABLE`]);
    }

    // Teacher workload: sessions and contact hours a week, highest first.
    const ws = wb.addWorksheet('Teacher Workload');
    ws.columns = [
      { header: 'Lecturer', key: 'name', width: 28 },
      { header: 'Sessions / week', key: 'sessions', width: 16 },
      { header: 'Contact hours / week', key: 'hours', width: 20 },
      { header: 'Lectures', key: 'lect', width: 10 },
      { header: 'Tutorials', key: 'tut', width: 10 },
      { header: 'Workshops', key: 'wk', width: 11 },
    ];
    const by = new Map<string, { name: string; sessions: number; hours: number; lect: number; tut: number; wk: number }>();
    for (const r of rows) {
      const w = by.get(r.lecturerId) ?? { name: r.lecturer, sessions: 0, hours: 0, lect: 0, tut: 0, wk: 0 };
      w.sessions += 1;
      w.hours = Math.round((w.hours + r.hours) * 100) / 100;
      if (r.classType === 'Lecture') w.lect += 1;
      else if (r.classType === 'Tutorial') w.tut += 1;
      else w.wk += 1;
      by.set(r.lecturerId, w);
    }
    for (const w of [...by.values()].sort((a, b) => b.hours - a.hours)) ws.addRow(w);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const buf = await wb.xlsx.writeBuffer();
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition', `attachment; filename="resource-allocation.xlsx"`);
    return Buffer.from(buf);
  });

  /** The same rows as CSV, for anyone who wants to paste them straight into the live sheet. */
  app.get('/timetable/allocation.csv', { preHandler: [allow('timetable.read')] }, async (req, reply) => {
    const { semesterId } = parse(z.object({ semesterId: z.string().optional() }), req.query);
    const rows = await loadRows(semesterId);
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = [HEADERS.join(','), ...rows.map((r) => line(r).map(esc).join(','))].join('\n');
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="resource-allocation.csv"');
    return body;
  });

  /** Display helper the web grid uses for the "01:30 PM - 03:00 PM" column. */
  app.get('/timetable/allocation/display', { preHandler: [allow('timetable.read')] }, async (req) => {
    const { semesterId } = parse(z.object({ semesterId: z.string().optional() }), req.query);
    const rows = await loadRows(semesterId);
    return rows.map((r) => ({ ...r, display: `${ampm(r.startTime)} - ${ampm(r.endTime)}` }));
  });
}
