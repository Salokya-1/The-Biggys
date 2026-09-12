import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { Prisma, type MarkSheetStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { idParam, parse } from '../lib/validation';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { actorOf, audit } from '../lib/audit';
import { allow, requireRole, STAFF } from '../plugins/auth';
import { assertTransition, availableActions, TransitionError, type TransitionAction } from '../lib/marksheet-state';
import { parseSpreadsheet, validateImport, buildTemplateCsv, type ImportRowResult } from '../lib/import';
import { notifyRole, notifyUsers } from '../lib/notify';
import { offeringScope } from './modules';
import { buildRows, flagsFor, loadSheet, refreshStanding, storeResults, validateForSubmit, type SheetContext } from '../services/results';

const markInput = z.object({
  enrollmentId: z.string().min(1),
  componentId: z.string().min(1),
  rawMark: z.number().min(0).nullable(),
  isAbsent: z.boolean().default(false),
  note: z.string().max(200).nullable().optional(),
});
const saveMarksBody = z.object({ lockVersion: z.number().int().min(0), marks: z.array(markInput).min(1).max(5000) });
const transitionBody = z.object({
  action: z.enum(['submit', 'start_review', 'approve', 'reject', 'publish', 'request_correction']),
  reason: z.string().trim().max(500).optional(),
  lockVersion: z.number().int().min(0),
  scheduledPublishAt: z.coerce.date().optional(),
});
const listQuery = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'CORRECTION_REQUESTED']).optional(),
  semesterId: z.string().optional(),
});

const OPEN_STATES: MarkSheetStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED'];

/** Lecturers/leaders may only touch sheets on offerings in their scope. */
function assertScope(req: FastifyRequest, sheet: SheetContext) {
  const u = req.user!;
  if (u.role === 'ADMIN') return;
  const o = sheet.moduleOffering;
  const teaches = o.lecturer?.id === u.id;
  const leads = o.module.moduleLeaderId === u.id;
  if (u.role === 'LECTURER' && !teaches) throw forbidden('You do not teach this module offering');
  if (u.role === 'MODULE_LEADER' && !teaches && !leads) throw forbidden('You do not lead or teach this module');
}

async function applyMarks(
  tx: Prisma.TransactionClient,
  sheet: SheetContext,
  marks: { enrollmentId: string; componentId: string; rawMark: number | null; isAbsent: boolean; note?: string | null }[],
) {
  const componentById = new Map(sheet.moduleOffering.components.map((c) => [c.id, c]));
  const enrollmentIds = new Set(sheet.moduleOffering.enrollments.map((e) => e.id));
  const existing = new Map(sheet.marks.map((m) => [`${m.enrollmentId}:${m.componentId}`, m]));
  const changes: { enrollmentId: string; componentId: string; before: unknown; after: unknown }[] = [];

  for (const m of marks) {
    const c = componentById.get(m.componentId);
    if (!c) throw badRequest(`Unknown component ${m.componentId}`);
    if (!enrollmentIds.has(m.enrollmentId)) throw badRequest(`Enrollment ${m.enrollmentId} is not on this offering`);
    if (m.rawMark !== null && m.rawMark > c.maxMark) throw badRequest(`${c.name}: ${m.rawMark} exceeds max ${c.maxMark}`);
    const rawMark = m.isAbsent ? null : m.rawMark;
    const prev = existing.get(`${m.enrollmentId}:${m.componentId}`);
    const before = prev ? { rawMark: prev.rawMark === null ? null : Number(prev.rawMark), isAbsent: prev.isAbsent } : null;
    const after = { rawMark, isAbsent: m.isAbsent };
    if (before && before.rawMark === after.rawMark && before.isAbsent === after.isAbsent && (prev?.note ?? null) === (m.note ?? null)) continue;
    await tx.mark.upsert({
      where: { markSheetId_enrollmentId_componentId: { markSheetId: sheet.id, enrollmentId: m.enrollmentId, componentId: m.componentId } },
      create: { markSheetId: sheet.id, enrollmentId: m.enrollmentId, componentId: m.componentId, rawMark, isAbsent: m.isAbsent, note: m.note ?? null },
      update: { rawMark, isAbsent: m.isAbsent, note: m.note ?? null },
    });
    changes.push({ enrollmentId: m.enrollmentId, componentId: m.componentId, before, after });
  }
  return changes;
}

async function bumpLock(tx: Prisma.TransactionClient, sheet: SheetContext, lockVersion: number, data: Prisma.MarkSheetUpdateManyMutationInput = {}) {
  const res = await tx.markSheet.updateMany({ where: { id: sheet.id, lockVersion }, data: { ...data, lockVersion: { increment: 1 } } });
  if (res.count === 0) {
    throw conflict('This mark sheet was changed by someone else. Reload to see the latest version.', { currentLockVersion: sheet.lockVersion });
  }
}

export async function markSheetRoutes(app: FastifyInstance) {
  // ---------- list ----------
  app.get('/marksheets', { preHandler: [allow('marksheet.read')] }, async (req) => {
    const q = parse(listQuery, req.query);
    const sheets = await prisma.markSheet.findMany({
      where: {
        AND: [
          q.status ? { status: q.status } : {},
          q.semesterId ? { moduleOffering: { semesterId: q.semesterId } } : {},
          offeringScope(req) ? { moduleOffering: offeringScope(req) } : {},
        ],
      },
      include: {
        moduleOffering: {
          select: {
            id: true,
            module: { select: { code: true, title: true } },
            semester: { select: { number: true, intake: { select: { label: true, programme: { select: { code: true } } } } } },
            lecturer: { select: { name: true } },
            _count: { select: { enrollments: true } },
          },
        },
        submittedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        _count: { select: { marks: true, results: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return sheets;
  });

  // ---------- create (new sheet or correction version) ----------
  app.post('/offerings/:id/marksheets', { preHandler: [allow('marksheet.edit')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const offering = await prisma.moduleOffering.findFirst({
      where: { AND: [{ id }, offeringScope(req) ?? {}] },
      include: { components: true, markSheets: { orderBy: { version: 'desc' }, include: { marks: true } } },
    });
    if (!offering) throw notFound('Module offering not found');
    if (offering.components.length === 0) throw badRequest('Configure assessment components before creating a mark sheet');
    const weight = offering.components.reduce((s, c) => s + c.weight, 0);
    if (weight !== 100) throw badRequest(`Component weights sum to ${weight}, not 100`);

    const latest = offering.markSheets[0];
    if (latest && OPEN_STATES.includes(latest.status)) throw conflict(`An open mark sheet (v${latest.version}, ${latest.status}) already exists`);
    if (latest && latest.status === 'PUBLISHED') throw conflict('This offering has a published mark sheet; request a correction to open a new version');

    const scheme = await prisma.gradingScheme.findFirst({ where: { isDefault: true } });
    const sheet = await prisma.$transaction(async (tx) => {
      const s = await tx.markSheet.create({
        data: {
          moduleOfferingId: id,
          version: latest ? latest.version + 1 : 1,
          gradingSchemeId: scheme?.id ?? null,
          status: 'DRAFT',
        },
      });
      if (latest?.status === 'CORRECTION_REQUESTED' && latest.marks.length) {
        await tx.mark.createMany({
          data: latest.marks.map((m) => ({ markSheetId: s.id, enrollmentId: m.enrollmentId, componentId: m.componentId, rawMark: m.rawMark, isAbsent: m.isAbsent, note: m.note })),
        });
      }
      await audit(tx, { ...actorOf(req), action: 'marksheet.create', entityType: 'MarkSheet', entityId: s.id, after: { version: s.version, copiedFrom: latest?.id ?? null } });
      return s;
    });
    reply.code(201);
    return sheet;
  });

  // ---------- detail ----------
  app.get('/marksheets/:id', { preHandler: [allow('marksheet.read')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const sheet = await loadSheet(prisma, id);
    assertScope(req, sheet);
    const rows = buildRows(sheet);
    const [{ flags, stats }, auditLog, importBatches] = await Promise.all([
      flagsFor(prisma, sheet, rows),
      prisma.auditLog.findMany({ where: { entityType: 'MarkSheet', entityId: id }, orderBy: { createdAt: 'desc' }, take: 50, include: { actor: { select: { name: true, role: true } } } }),
      prisma.importBatch.findMany({ where: { markSheetId: id }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, fileName: true, status: true, rowsTotal: true, rowsValid: true, rowsInvalid: true, createdAt: true } }),
    ]);
    const { marks: _m, results: _r, moduleOffering, ...meta } = sheet;
    const { enrollments: _e, ...offering } = moduleOffering;
    return {
      sheet: meta,
      offering,
      rows,
      validation: validateForSubmit(sheet, rows),
      flags,
      stats,
      actions: availableActions(sheet.status, req.user!.role),
      editable: sheet.status === 'DRAFT',
      audit: auditLog,
      importBatches,
    };
  });

  // ---------- save marks (grid) ----------
  app.put('/marksheets/:id/marks', { preHandler: [allow('marksheet.edit')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(saveMarksBody, req.body);
    const sheet = await loadSheet(prisma, id);
    assertScope(req, sheet);
    if (sheet.status !== 'DRAFT') throw conflict(`Marks can only be edited while the sheet is DRAFT (currently ${sheet.status})`);

    const changed = await prisma.$transaction(async (tx) => {
      await bumpLock(tx, sheet, body.lockVersion);
      const changes = await applyMarks(tx, sheet, body.marks);
      if (changes.length) {
        await audit(tx, { ...actorOf(req), action: 'marks.update', entityType: 'MarkSheet', entityId: id, before: changes.map((c) => ({ ...c, after: undefined })), after: changes.map((c) => ({ ...c, before: undefined })) });
      }
      return changes.length;
    });
    return { changed, lockVersion: sheet.lockVersion + 1 };
  });

  // ---------- template ----------
  app.get('/marksheets/:id/template.csv', { preHandler: [allow('marksheet.edit')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const sheet = await loadSheet(prisma, id);
    assertScope(req, sheet);
    const csv = buildTemplateCsv(
      sheet.moduleOffering.components,
      sheet.moduleOffering.enrollments.map((e) => ({ id: e.id, studentId: e.student.studentId, name: e.student.name })),
    );
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${sheet.moduleOffering.module.code}-marks-template.csv"`);
    return csv;
  });

  // ---------- import: preview ----------
  app.post('/marksheets/:id/import', { preHandler: [allow('marksheet.edit')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const sheet = await loadSheet(prisma, id);
    assertScope(req, sheet);
    if (sheet.status !== 'DRAFT') throw conflict('Imports are only allowed while the sheet is DRAFT');

    const file = await req.file({ limits: { fileSize: 5 * 1024 * 1024 } });
    if (!file) throw badRequest('Upload a CSV or XLSX file in the "file" field');
    const ext = (file.filename.split('.').pop() ?? '').toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext)) throw badRequest('Only .csv, .xlsx or .xls files are accepted');
    const buffer = await file.toBuffer();

    const parsed = parseSpreadsheet(buffer);
    if (parsed.rows.length === 0) throw badRequest('The file has no data rows');
    const preview = validateImport(
      parsed,
      sheet.moduleOffering.components,
      sheet.moduleOffering.enrollments.map((e) => ({ id: e.id, studentId: e.student.studentId, name: e.student.name })),
    );
    const batch = await prisma.importBatch.create({
      data: {
        markSheetId: id,
        fileName: file.filename,
        uploadedById: req.user!.id,
        rowsTotal: preview.summary.total,
        rowsValid: preview.summary.ok + preview.summary.warnings,
        rowsInvalid: preview.summary.errors,
        errors: preview.rows.filter((r) => r.level !== 'ok').map((r) => ({ row: r.rowNumber, studentId: r.studentId, level: r.level, messages: r.messages })) as Prisma.InputJsonValue,
        rows: preview.rows as unknown as Prisma.InputJsonValue,
        status: 'PREVIEW',
      },
    });
    await audit(prisma, { ...actorOf(req), action: 'import.preview', entityType: 'MarkSheet', entityId: id, after: { batchId: batch.id, fileName: file.filename, ...preview.summary } });
    reply.code(201);
    return { batchId: batch.id, fileName: file.filename, ...preview };
  });

  // ---------- import: commit valid rows ----------
  app.post('/marksheets/:id/import/:batchId/commit', { preHandler: [allow('marksheet.edit')] }, async (req) => {
    const { id, batchId } = parse(z.object({ id: z.string(), batchId: z.string() }), req.params);
    const { lockVersion } = parse(z.object({ lockVersion: z.number().int().min(0) }), req.body);
    const sheet = await loadSheet(prisma, id);
    assertScope(req, sheet);
    if (sheet.status !== 'DRAFT') throw conflict('Imports are only allowed while the sheet is DRAFT');
    const batch = await prisma.importBatch.findFirst({ where: { id: batchId, markSheetId: id } });
    if (!batch) throw notFound('Import batch not found');
    if (batch.status !== 'PREVIEW') throw conflict(`Batch already ${batch.status}`);

    const rows = batch.rows as unknown as ImportRowResult[];
    const accepted = rows.filter((r) => r.level !== 'error' && r.enrollmentId);
    const marks = accepted.flatMap((r) => r.marks.map((m) => ({ enrollmentId: r.enrollmentId!, componentId: m.componentId, rawMark: m.rawMark, isAbsent: m.isAbsent })));

    const changed = await prisma.$transaction(async (tx) => {
      await bumpLock(tx, sheet, lockVersion);
      const changes = await applyMarks(tx, sheet, marks);
      await tx.importBatch.update({ where: { id: batchId }, data: { status: 'COMMITTED' } });
      await audit(tx, { ...actorOf(req), action: 'import.commit', entityType: 'MarkSheet', entityId: id, after: { batchId, rowsCommitted: accepted.length, rowsSkipped: rows.length - accepted.length, cellsChanged: changes.length } });
      return changes.length;
    });
    return { rowsCommitted: accepted.length, rowsSkipped: rows.length - accepted.length, cellsChanged: changed, lockVersion: sheet.lockVersion + 1 };
  });

  app.post('/marksheets/:id/import/:batchId/discard', { preHandler: [allow('marksheet.edit')] }, async (req) => {
    const { id, batchId } = parse(z.object({ id: z.string(), batchId: z.string() }), req.params);
    const batch = await prisma.importBatch.findFirst({ where: { id: batchId, markSheetId: id, status: 'PREVIEW' } });
    if (!batch) throw notFound('Import batch not found');
    await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'DISCARDED' } });
    return { ok: true };
  });

  // ---------- state transitions ----------
  app.post('/marksheets/:id/transition', { preHandler: [requireRole(...STAFF)] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(transitionBody, req.body);
    const sheet = await loadSheet(prisma, id);
    assertScope(req, sheet);
    const role = req.user!.role;

    let to: MarkSheetStatus;
    try {
      to = assertTransition(sheet.status, body.action as TransitionAction, role, body.reason);
    } catch (e) {
      if (e instanceof TransitionError) {
        if (e.code === 'FORBIDDEN') throw forbidden(e.message);
        if (e.code === 'REASON_REQUIRED') throw badRequest(e.message);
        throw conflict(e.message);
      }
      throw e;
    }

    const rows = buildRows(sheet);
    if (body.action === 'submit') {
      const v = validateForSubmit(sheet, rows);
      if (v.errors.length) throw badRequest('The mark sheet is not complete', { errors: v.errors, warnings: v.warnings });
    }
    if (body.action === 'publish' && body.scheduledPublishAt && body.scheduledPublishAt.getTime() < Date.now() - 60_000) {
      throw badRequest('scheduledPublishAt must be in the future');
    }

    const now = new Date();
    const data: Prisma.MarkSheetUpdateManyMutationInput = { status: to };
    if (body.action === 'submit') Object.assign(data, { submittedById: req.user!.id, submittedAt: now, rejectReason: null });
    if (body.action === 'approve') Object.assign(data, { approvedById: req.user!.id, approvedAt: now });
    if (body.action === 'reject') Object.assign(data, { rejectReason: body.reason, approvedById: null, approvedAt: null });
    if (body.action === 'publish') {
      const publishedAt = body.scheduledPublishAt && body.scheduledPublishAt > now ? body.scheduledPublishAt : now;
      Object.assign(data, { publishedById: req.user!.id, publishedAt, scheduledPublishAt: body.scheduledPublishAt ?? null });
    }

    const offering = sheet.moduleOffering;
    const code = offering.module.code;
    await prisma.$transaction(async (tx) => {
      await bumpLock(tx, sheet, body.lockVersion, data);
      if (body.action === 'submit' || body.action === 'approve') await storeResults(tx, sheet, rows);
      await audit(tx, { ...actorOf(req), action: `marksheet.${body.action}`, entityType: 'MarkSheet', entityId: id, before: { status: sheet.status }, after: { status: to, scheduledPublishAt: body.scheduledPublishAt ?? null }, reason: body.reason ?? null });

      const sheetPayload = { markSheetId: id, offeringId: offering.id, module: code };
      if (body.action === 'submit') {
        const leaderId = offering.module.moduleLeaderId;
        if (leaderId) await notifyUsers(tx, [leaderId], { type: 'marksheet.submitted', title: `${code} marks submitted for review`, body: `${req.user!.name} submitted the ${code} mark sheet (v${sheet.version}).`, payload: sheetPayload });
        else await notifyRole(tx, 'MODULE_LEADER', { type: 'marksheet.submitted', title: `${code} marks submitted for review`, body: `${req.user!.name} submitted the ${code} mark sheet (v${sheet.version}).`, payload: sheetPayload });
      }
      if (body.action === 'approve') {
        await notifyRole(tx, 'ADMIN', { type: 'marksheet.approved', title: `${code} approved — ready to publish`, body: `${req.user!.name} approved the ${code} mark sheet.`, payload: sheetPayload });
      }
      if (body.action === 'reject') {
        const targets = [offering.lecturer?.id, sheet.submittedBy?.id].filter((x): x is string => !!x);
        await notifyUsers(tx, targets, { type: 'marksheet.rejected', title: `${code} mark sheet returned`, body: `Reason: ${body.reason}`, payload: sheetPayload });
      }
      if (body.action === 'request_correction') {
        const targets = [offering.lecturer?.id, offering.module.moduleLeaderId].filter((x): x is string => !!x);
        await notifyUsers(tx, targets, { type: 'marksheet.correction_requested', title: `${code}: correction requested`, body: `Reason: ${body.reason}. Open a new version to make the correction.`, payload: sheetPayload });
      }
      if (body.action === 'publish') {
        const publishedAt = (data.publishedAt as Date) ?? now;
        const studentUserIds = offering.enrollments.map((e) => e.student.userId).filter((x): x is string => !!x);
        const isCorrection = sheet.version > 1;
        await notifyUsers(tx, studentUserIds, {
          type: isCorrection ? 'result.updated' : 'result.published',
          title: isCorrection ? `${code} result updated` : `${code} result published`,
          body: publishedAt > now ? `Your ${code} result will be visible from ${publishedAt.toISOString()}.` : `Your ${code} result is now available.`,
          payload: sheetPayload,
        });
        if (publishedAt <= now) await refreshStanding(tx, offering.enrollments.map((e) => e.studentId));
      }
    });

    const updated = await loadSheet(prisma, id);
    return { status: updated.status, lockVersion: updated.lockVersion, version: updated.version, publishedAt: updated.publishedAt };
  });

  // ---------- audit trail ----------
  app.get('/marksheets/:id/audit', { preHandler: [allow('marksheet.read')] }, async (req) => {
    const { id } = parse(idParam, req.params);
    const sheet = await loadSheet(prisma, id);
    assertScope(req, sheet);
    return prisma.auditLog.findMany({ where: { entityType: 'MarkSheet', entityId: id }, orderBy: { createdAt: 'desc' }, include: { actor: { select: { name: true, role: true } } } });
  });

  // ---------- export to Excel ----------
  app.get('/marksheets/:id/export.xlsx', { preHandler: [allow('marksheet.read')] }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const sheet = await loadSheet(prisma, id);
    assertScope(req, sheet);
    const rows = buildRows(sheet);
    const comps = sheet.moduleOffering.components;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${sheet.moduleOffering.module.code} v${sheet.version}`);
    ws.columns = [
      { header: 'Student ID', key: 'sid', width: 14 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Attempt', key: 'attempt', width: 9 },
      ...comps.map((c) => ({ header: `${c.name} (/${c.maxMark}, ${c.weight}%)`, key: c.id, width: 18 })),
      { header: 'Overall', key: 'overall', width: 10 },
      { header: 'Grade', key: 'grade', width: 8 },
      { header: 'Outcome', key: 'outcome', width: 10 },
    ];
    for (const r of rows) {
      const line: Record<string, unknown> = { sid: r.student.studentId, name: r.student.name, attempt: r.isResit ? `${r.attempt} (resit)` : r.attempt };
      for (const c of comps) line[c.id] = r.marks[c.id].isAbsent ? 'ABS' : r.marks[c.id].rawMark;
      const g = r.stored ?? r.computed;
      line.overall = g?.overallMark ?? '';
      line.grade = g?.grade ?? '';
      line.outcome = g?.outcome ?? '';
      ws.addRow(line);
    }
    ws.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition', `attachment; filename="${sheet.moduleOffering.module.code}-v${sheet.version}-marks.xlsx"`);
    return Buffer.from(buf);
  });

  // ---------- notifications (any authenticated user) ----------
  app.get('/notifications', async (req) => {
    const items = await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { items, unread: items.filter((n) => !n.readAt).length };
  });
  app.post('/notifications/read', async (req) => {
    const { ids } = parse(z.object({ ids: z.array(z.string()).max(200).optional() }), req.body ?? {});
    await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
    return { ok: true };
  });
}
