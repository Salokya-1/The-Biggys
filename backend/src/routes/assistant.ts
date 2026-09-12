import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config';
import { parse } from '../lib/validation';
import { badRequest, HttpError } from '../lib/errors';
import { audit, actorOf } from '../lib/audit';
import { prisma } from '../lib/prisma';

/**
 * AI assistant: an OpenRouter model with function tools. Every tool is an HTTP call to this same
 * API, injected in-process with the caller's own bearer token — so the assistant can do anything
 * the user can do, and nothing they cannot. RBAC, validation, audit and notifications all apply.
 */

interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  call: (args: Record<string, unknown>) => { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; body?: unknown };
}

const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const str = { type: 'string' };
const num = { type: 'number' };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

const TOOLS: ToolDef[] = [
  { name: 'search_students', description: 'Search the student directory. Filters: q (id/name/email), programmeId, intakeId, status, standing, page, pageSize.', parameters: obj({ q: str, programmeId: str, intakeId: str, status: { type: 'string', enum: ['ACTIVE', 'DEFERRED', 'WITHDRAWN', 'GRADUATED'] }, standing: { type: 'string', enum: ['GOOD', 'RESIT', 'REVIEW'] }, page: num, pageSize: num }), call: (a) => ({ method: 'GET', url: `/api/students${qs(a)}` }) },
  { name: 'get_student', description: 'Full academic profile of one student by internal id.', parameters: obj({ id: str }, ['id']), call: (a) => ({ method: 'GET', url: `/api/students/${a.id}` }) },
  { name: 'create_student', description: 'Create a student record (admin). programmeId and intakeId are internal ids from list_programmes. Set createLogin true (with email) to create a login.', parameters: obj({ studentId: str, name: str, email: str, programmeId: str, intakeId: str, currentSemesterId: str, sectionId: str, specialNeedsSeating: { type: 'boolean' }, createLogin: { type: 'boolean' }, password: str }, ['studentId', 'name', 'programmeId', 'intakeId']), call: (a) => ({ method: 'POST', url: '/api/students', body: a }) },
  { name: 'update_student', description: 'Update fields of a student (admin): name, email, status, standing, currentSemesterId, sectionId, specialNeedsSeating, programmeId, intakeId.', parameters: obj({ id: str, fields: { type: 'object', additionalProperties: true } }, ['id', 'fields']), call: (a) => ({ method: 'PATCH', url: `/api/students/${a.id}`, body: a.fields }) },
  { name: 'delete_student', description: 'Soft-delete (withdraw) a student with a reason (admin). Irreversible from the UI — confirm with the user first.', parameters: obj({ id: str, reason: str }, ['id', 'reason']), call: (a) => ({ method: 'DELETE', url: `/api/students/${a.id}`, body: { reason: a.reason } }) },
  { name: 'list_programmes', description: 'Programmes with their intakes and semesters (ids needed by other tools).', parameters: obj({}), call: () => ({ method: 'GET', url: '/api/programmes' }) },
  { name: 'list_modules', description: 'Modules, optionally by programmeId.', parameters: obj({ programmeId: str }), call: (a) => ({ method: 'GET', url: `/api/modules${qs(a)}` }) },
  { name: 'list_offerings', description: 'Module offerings (a module running in a semester) with lecturer, components, latest mark sheet. Filters semesterId, moduleId, programmeId, mine.', parameters: obj({ semesterId: str, moduleId: str, programmeId: str, mine: { type: 'boolean' } }), call: (a) => ({ method: 'GET', url: `/api/offerings${qs(a)}` }) },
  { name: 'enrol_students', description: 'Enrol students (internal student ids) on a module offering (admin).', parameters: obj({ offeringId: str, studentIds: { type: 'array', items: str }, isResit: { type: 'boolean' } }, ['offeringId', 'studentIds']), call: (a) => ({ method: 'POST', url: `/api/offerings/${a.offeringId}/enrollments`, body: { studentIds: a.studentIds, isResit: a.isResit ?? false } }) },
  { name: 'list_marksheets', description: 'Mark sheets in the caller\'s scope, optionally by status.', parameters: obj({ status: { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'CORRECTION_REQUESTED'] } }), call: (a) => ({ method: 'GET', url: `/api/marksheets${qs(a)}` }) },
  { name: 'get_marksheet', description: 'Mark sheet detail: rows with marks and computed grades, validation, flags, allowed actions, lockVersion.', parameters: obj({ id: str }, ['id']), call: (a) => ({ method: 'GET', url: `/api/marksheets/${a.id}` }) },
  { name: 'create_marksheet', description: 'Create a DRAFT mark sheet for an offering (or the next version after a correction request).', parameters: obj({ offeringId: str }, ['offeringId']), call: (a) => ({ method: 'POST', url: `/api/offerings/${a.offeringId}/marksheets`, body: {} }) },
  { name: 'save_marks', description: 'Save marks on a DRAFT sheet. marks: [{enrollmentId, componentId, rawMark|null, isAbsent}]. Needs the current lockVersion from get_marksheet.', parameters: obj({ id: str, lockVersion: num, marks: { type: 'array', items: obj({ enrollmentId: str, componentId: str, rawMark: { type: ['number', 'null'] }, isAbsent: { type: 'boolean' } }, ['enrollmentId', 'componentId']) } }, ['id', 'lockVersion', 'marks']), call: (a) => ({ method: 'PUT', url: `/api/marksheets/${a.id}/marks`, body: { lockVersion: a.lockVersion, marks: a.marks } }) },
  { name: 'transition_marksheet', description: 'Move a mark sheet: submit, start_review, approve, reject (reason), publish (optional scheduledPublishAt ISO), request_correction (reason). Needs lockVersion.', parameters: obj({ id: str, action: { type: 'string', enum: ['submit', 'start_review', 'approve', 'reject', 'publish', 'request_correction'] }, lockVersion: num, reason: str, scheduledPublishAt: str }, ['id', 'action', 'lockVersion']), call: (a) => ({ method: 'POST', url: `/api/marksheets/${a.id}/transition`, body: a }) },
  { name: 'list_exams', description: 'Exam sessions with candidates, capacity and seating status.', parameters: obj({}), call: () => ({ method: 'GET', url: '/api/exams' }) },
  { name: 'get_exam', description: 'Exam session detail with venues, allocations, unseated students, invigilators.', parameters: obj({ id: str }, ['id']), call: (a) => ({ method: 'GET', url: `/api/exams/${a.id}` }) },
  { name: 'create_exam', description: 'Create an exam session or class test (admin/teacher). kind FINAL|CLASS_TEST|RESIT, seatingMode MIXED (anti-cheat) or BY_ID (by section, ascending ID). sectionIds for class tests. invigilators [{venueId,userId}]. Teacher clashes are rejected with details.', parameters: obj({ title: str, kind: { type: 'string', enum: ['FINAL', 'CLASS_TEST', 'RESIT'] }, seatingMode: { type: 'string', enum: ['MIXED', 'BY_ID'] }, date: str, startTime: str, durationMin: num, offeringIds: { type: 'array', items: str }, venueIds: { type: 'array', items: str }, sectionIds: { type: 'array', items: str }, invigilators: { type: 'array', items: obj({ venueId: str, userId: str }, ['venueId', 'userId']) }, semesterId: str }, ['title', 'date', 'startTime', 'durationMin', 'offeringIds', 'venueIds']), call: (a) => ({ method: 'POST', url: '/api/exams', body: a }) },
  { name: 'generate_seating', description: 'Generate (or regenerate) seating for an exam session (admin).', parameters: obj({ id: str, seed: num }, ['id']), call: (a) => ({ method: 'POST', url: `/api/exams/${a.id}/seating/generate`, body: a.seed ? { seed: a.seed } : {} }) },
  { name: 'generate_exam_schedule', description: 'Generate FINAL exams for every offering of a semester inside its 2-week exam window, with venues and invigilators (admin). replace true regenerates.', parameters: obj({ semesterId: str, durationMin: num, replace: { type: 'boolean' } }, ['semesterId']), call: (a) => ({ method: 'POST', url: '/api/exams/schedule/generate', body: a }) },
  { name: 'list_venues', description: 'Rooms and exam halls with capacity.', parameters: obj({}), call: () => ({ method: 'GET', url: '/api/venues' }) },
  { name: 'timetable_semesters', description: 'Semesters (with sections) available for timetables and exam windows.', parameters: obj({}), call: () => ({ method: 'GET', url: '/api/timetable/semesters' }) },
  { name: 'timetable_week', description: 'Concrete week of classes and exams. Use semesterId+week (1..12) or a date (YYYY-MM-DD); filter sectionId/teacherId/venueId (staff only).', parameters: obj({ semesterId: str, week: num, date: str, sectionId: str, teacherId: str, venueId: str }), call: (a) => ({ method: 'GET', url: `/api/timetable/week${qs(a)}` }) },
  { name: 'timetable_day', description: 'One day\'s classes and exams (date YYYY-MM-DD), optional sectionId/teacherId/venueId.', parameters: obj({ date: str, sectionId: str, teacherId: str, venueId: str }, ['date']), call: (a) => ({ method: 'GET', url: `/api/timetable/day${qs(a)}` }) },
  { name: 'generate_timetable', description: 'Generate the weekly routine for a semester across all its sections (admin). replace true regenerates.', parameters: obj({ semesterId: str, sessionsPerWeek: num, replace: { type: 'boolean' } }, ['semesterId']), call: (a) => ({ method: 'POST', url: '/api/timetable/generate', body: a }) },
  { name: 'list_timetable_slots', description: 'Weekly slots (ids needed to change a class). Filters semesterId, sectionId, teacherId, venueId.', parameters: obj({ semesterId: str, sectionId: str, teacherId: str, venueId: str }), call: (a) => ({ method: 'GET', url: `/api/timetable/slots${qs(a)}` }) },
  { name: 'update_timetable_slot', description: 'Change a weekly slot permanently (admin): teacherId, venueId, dayOfWeek 1-7, startTime, endTime. Clashes are rejected with details.', parameters: obj({ slotId: str, fields: { type: 'object', additionalProperties: true } }, ['slotId', 'fields']), call: (a) => ({ method: 'PATCH', url: `/api/timetable/slots/${a.slotId}`, body: a.fields }) },
  { name: 'add_slot_exception', description: 'One-day change to a class (admin): kind CANCELLED | TEACHER_CHANGE (teacherId) | ROOM_CHANGE (venueId) | RESCHEDULED (startTime,endTime), with date and reason.', parameters: obj({ slotId: str, date: str, kind: { type: 'string', enum: ['CANCELLED', 'TEACHER_CHANGE', 'ROOM_CHANGE', 'RESCHEDULED'] }, teacherId: str, venueId: str, startTime: str, endTime: str, reason: str }, ['slotId', 'date', 'kind', 'reason']), call: (a) => ({ method: 'POST', url: `/api/timetable/slots/${a.slotId}/exceptions`, body: a }) },
  { name: 'list_teachers', description: 'Teaching staff (ids for teacher changes, cover, invigilation).', parameters: obj({}), call: () => ({ method: 'GET', url: '/api/timetable/teachers' }) },
  { name: 'list_requests', description: 'Absence / change requests (own for students and lecturers; all for admin and leaders).', parameters: obj({ status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] } }), call: (a) => ({ method: 'GET', url: `/api/requests${qs(a)}` }) },
  { name: 'create_request', description: 'Submit a request: TEACHER_ABSENCE (slotId,date), STUDENT_ABSENCE (slotId,date), SECTION_SWAP (targetSectionId,date). reason required.', parameters: obj({ kind: { type: 'string', enum: ['TEACHER_ABSENCE', 'STUDENT_ABSENCE', 'SECTION_SWAP'] }, slotId: str, date: str, targetSectionId: str, reason: str }, ['kind', 'date', 'reason']), call: (a) => ({ method: 'POST', url: '/api/requests', body: a }) },
  { name: 'decide_request', description: 'Approve or reject a request (admin/leader); coverTeacherId assigns cover for a teacher absence.', parameters: obj({ id: str, decision: { type: 'string', enum: ['APPROVED', 'REJECTED'] }, note: str, coverTeacherId: str }, ['id', 'decision']), call: (a) => ({ method: 'POST', url: `/api/requests/${a.id}/decide`, body: a }) },
  { name: 'list_fees', description: 'Fee invoices (staff). Filters semesterId, status, q.', parameters: obj({ semesterId: str, status: { type: 'string', enum: ['UNPAID', 'PAID', 'WAIVED'] }, q: str }), call: (a) => ({ method: 'GET', url: `/api/fees${qs(a)}` }) },
  { name: 'update_fee', description: 'Mark an invoice PAID / WAIVED / UNPAID (admin).', parameters: obj({ id: str, status: { type: 'string', enum: ['UNPAID', 'PAID', 'WAIVED'] }, reference: str, method: str }, ['id', 'status']), call: (a) => ({ method: 'PATCH', url: `/api/fees/${a.id}`, body: a }) },
  { name: 'my_fees', description: 'The signed-in student\'s invoices and admit cards.', parameters: obj({}), call: () => ({ method: 'GET', url: '/api/fees/me' }) },
  { name: 'pay_fee', description: 'Pay an invoice (student, mock gateway).', parameters: obj({ id: str, method: { type: 'string', enum: ['eSewa', 'Khalti', 'Bank transfer', 'Cash'] } }, ['id']), call: (a) => ({ method: 'POST', url: `/api/fees/${a.id}/pay`, body: { method: a.method ?? 'eSewa' } }) },
  { name: 'issue_admit_card', description: 'Issue the admit card for a semester (student for themselves; admin with studentId). Fails if the fee is unpaid.', parameters: obj({ semesterId: str, studentId: str }, ['semesterId']), call: (a) => ({ method: 'POST', url: '/api/admit-cards/issue', body: a }) },
  { name: 'retake_candidates', description: 'Students with outstanding resits for an academic year (start year) and existing summer semesters.', parameters: obj({ year: num }), call: (a) => ({ method: 'GET', url: `/api/retakes${qs(a)}` }) },
  { name: 'generate_retakes', description: 'Create the summer retake semester(s), offerings, resit enrolments and resit exams for an academic year (admin).', parameters: obj({ year: num }, ['year']), call: (a) => ({ method: 'POST', url: '/api/retakes/generate', body: a }) },
  { name: 'dashboard', description: 'Leadership dashboard aggregates (admin, module leader).', parameters: obj({}), call: () => ({ method: 'GET', url: '/api/dashboard' }) },
  { name: 'my_profile', description: 'The signed-in student\'s own profile and published results.', parameters: obj({}), call: () => ({ method: 'GET', url: '/api/students/me' }) },
  { name: 'my_exam_seats', description: 'The signed-in student\'s upcoming exams and seats.', parameters: obj({}), call: () => ({ method: 'GET', url: '/api/exams/me' }) },
  { name: 'my_timetable', description: 'This week\'s classes and exams for the signed-in user (student section or teacher).', parameters: obj({}), call: () => ({ method: 'GET', url: '/api/timetable/me' }) },
  { name: 'notifications', description: 'The signed-in user\'s notifications.', parameters: obj({}), call: () => ({ method: 'GET', url: '/api/notifications' }) },
  { name: 'api_request', description: 'Escape hatch: call any API route directly (path must start with /api/). Use only when no specific tool fits. See the route list in the system prompt.', parameters: obj({ method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }, path: str, body: { type: 'object', additionalProperties: true } }, ['method', 'path']), call: (a) => ({ method: a.method as 'GET', url: String(a.path), body: a.body }) },
];

const ROUTE_CHEATSHEET = `Other routes for api_request: GET/POST /api/programmes, POST /api/programmes/:id/intakes, POST /api/intakes/:id/semesters, GET/POST /api/modules, PATCH /api/modules/:id, POST /api/offerings, PUT /api/offerings/:id/components, GET /api/marksheets/:id/audit, POST /api/venues, PATCH /api/venues/:id, PATCH /api/exams/:id, DELETE /api/exams/:id/seating, GET /api/exams/:id/lookup?studentId=, POST /api/timetable/slots, DELETE /api/timetable/slots/:id, DELETE /api/timetable/exceptions/:id, GET /api/timetable/sections?intakeId=, POST /api/fees/generate, GET /api/admit-cards, GET /api/students/:id/seats, POST /api/notifications/read.`;

function systemPrompt(req: FastifyRequest) {
  const u = req.user!;
  return `You are the RTE assistant inside Islington College's RTE Integrated Management System (results, exams, seating, timetables, fees). Today is ${new Date().toISOString().slice(0, 10)}.
You are talking to ${u.name} (role ${u.role}${u.studentId ? ', a student' : ''}). You act ONLY through the provided tools, which run with this user's own permissions; if a tool returns 403 the user is not allowed to do that — say so plainly.
Rules: (1) Look ids up with list/search tools before acting; never invent ids. (2) For irreversible or high-impact actions — deleting a student, publishing results, regenerating a timetable/exam schedule/seating that replaces existing data, approving requests, recording payments — state exactly what you are about to do and ask for confirmation, unless the user's message already explicitly requested that exact action. (3) After acting, report what changed in plain English, including any clashes, unseated students or validation errors returned. (4) Keep answers short; use bullet points for lists; never paste raw JSON. (5) Grading, standing and calendar rules are configurable assumptions — say so if asked. ${ROUTE_CHEATSHEET}`;
}

interface Msg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

async function callOpenRouter(messages: Msg[], tools: ToolDef[]): Promise<Msg & { usage?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.OPENROUTER_API_KEY}`, 'content-type': 'application/json', 'HTTP-Referer': 'https://github.com/Salokya-1/The-Biggys', 'X-Title': 'RTE IMS assistant' },
      body: JSON.stringify({
        model: config.OPENROUTER_MODEL,
        messages,
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 1200,
      }),
      signal: controller.signal,
    });
    const json = (await res.json()) as { choices?: { message: Msg }[]; error?: { message: string }; usage?: unknown };
    if (!res.ok || json.error) throw new HttpError(502, `AI provider error: ${json.error?.message ?? res.statusText}`);
    const m = json.choices?.[0]?.message;
    if (!m) throw new HttpError(502, 'AI provider returned no message');
    return { ...m, usage: json.usage };
  } finally {
    clearTimeout(timer);
  }
}

const clip = (s: string, n = 6000) => (s.length > n ? `${s.slice(0, n)}… [truncated ${s.length - n} chars]` : s);

export async function assistantRoutes(app: FastifyInstance) {
  app.get('/assistant/status', async () => ({ enabled: !!config.OPENROUTER_API_KEY, model: config.OPENROUTER_MODEL, tools: TOOLS.map((t) => t.name) }));

  app.post('/assistant/chat', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    if (!config.OPENROUTER_API_KEY) throw badRequest('The assistant is not configured (OPENROUTER_API_KEY is empty)');
    const { messages } = parse(z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) })).min(1).max(40) }), req.body);
    const authorization = req.headers.authorization ?? '';
    const convo: Msg[] = [{ role: 'system', content: systemPrompt(req) }, ...messages.map((m) => ({ role: m.role, content: m.content }) as Msg)];
    const actions: { tool: string; args: unknown; status: number; ok: boolean; summary: string }[] = [];

    for (let round = 0; round < 8; round++) {
      const reply = await callOpenRouter(convo, TOOLS);
      convo.push({ role: 'assistant', content: reply.content ?? '', tool_calls: reply.tool_calls });
      if (!reply.tool_calls || reply.tool_calls.length === 0) {
        if (actions.length) await audit(prisma, { ...actorOf(req), action: 'assistant.actions', entityType: 'Assistant', entityId: req.user!.id, after: actions.map((a) => ({ tool: a.tool, status: a.status })) });
        return { reply: reply.content ?? '', actions, model: config.OPENROUTER_MODEL };
      }
      for (const call of reply.tool_calls) {
        const tool = TOOLS.find((t) => t.name === call.function.name);
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
        } catch {
          convo.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify({ error: 'arguments were not valid JSON' }) });
          continue;
        }
        if (!tool) {
          convo.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify({ error: `unknown tool ${call.function.name}` }) });
          continue;
        }
        const { method, url, body } = tool.call(args);
        if (!url.startsWith('/api/')) {
          convo.push({ role: 'tool', tool_call_id: call.id, name: tool.name, content: JSON.stringify({ error: 'only /api/ routes are allowed' }) });
          continue;
        }
        const res = await app.inject({ method, url, headers: { authorization, 'content-type': 'application/json' }, payload: body === undefined ? undefined : JSON.stringify(body) });
        const text = res.body;
        const ok = res.statusCode < 400;
        let summary = `${method} ${url} → ${res.statusCode}`;
        try {
          const j = JSON.parse(text);
          if (!ok && j?.message) summary += ` ${j.message}`;
        } catch {
          /* non-JSON (csv/pdf) */
        }
        actions.push({ tool: tool.name, args, status: res.statusCode, ok, summary });
        req.log.info({ tool: tool.name, status: res.statusCode }, 'assistant.tool');
        convo.push({ role: 'tool', tool_call_id: call.id, name: tool.name, content: clip(res.headers['content-type']?.toString().includes('json') ? text : `[${res.headers['content-type']} ${text.length} bytes]`) });
      }
    }
    return { reply: 'I stopped after several steps without a final answer — please check what changed and ask again.', actions, model: config.OPENROUTER_MODEL };
  });
}
