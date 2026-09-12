'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, downloadWithAuth } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ImportPreview, MarkSheetDetail } from '@/lib/types';

const LEVEL_STYLE = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
};

export function ImportPanel({ detail }: { detail: MarkSheetDetail }) {
  const qc = useQueryClient();
  const { sheet, offering, editable } = detail;
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<ImportPreview>(`/api/marksheets/${sheet.id}/import`, { method: 'POST', formData: fd });
    },
    onSuccess: (p) => setPreview(p),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Upload failed'),
  });

  const commit = useMutation({
    mutationFn: () =>
      api<{ rowsCommitted: number; rowsSkipped: number; cellsChanged: number }>(`/api/marksheets/${sheet.id}/import/${preview!.batchId}/commit`, {
        method: 'POST',
        body: { lockVersion: sheet.lockVersion },
      }),
    onSuccess: (r) => {
      toast.success(`Imported ${r.rowsCommitted} row${r.rowsCommitted === 1 ? '' : 's'} (${r.cellsChanged} cells changed, ${r.rowsSkipped} skipped)`);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
      void qc.invalidateQueries({ queryKey: ['marksheet', sheet.id] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Commit failed');
      void qc.invalidateQueries({ queryKey: ['marksheet', sheet.id] });
    },
  });

  const discard = useMutation({
    mutationFn: () => api(`/api/marksheets/${sheet.id}/import/${preview!.batchId}/discard`, { method: 'POST', body: {} }),
    onSuccess: () => {
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    },
  });

  const valid = preview ? preview.summary.ok + preview.summary.warnings : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => downloadWithAuth(`/api/marksheets/${sheet.id}/template.csv`, `${offering.module.code}-marks-template.csv`).catch((e) => toast.error(e.message))}>
          <Download className="mr-1 h-4 w-4" /> Download template (.csv)
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          disabled={!editable || upload.isPending}
          className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
          }}
        />
        {upload.isPending && <span className="text-sm text-muted-foreground">Validating…</span>}
      </div>
      {!editable && <p className="text-sm text-muted-foreground">Imports are only possible while the sheet is DRAFT.</p>}
      <p className="text-xs text-muted-foreground">
        Columns: <code>Student ID</code>, optional <code>Name</code>, then one column per component ({offering.components.map((c) => c.name).join(', ')}). Use <code>ABS</code> for absent. Nothing is written until you commit; rows with errors are never written.
      </p>

      {preview && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{preview.fileName}</span>
            <Badge variant="outline" className={cn('border-transparent', LEVEL_STYLE.ok)}>{preview.summary.ok} ok</Badge>
            <Badge variant="outline" className={cn('border-transparent', LEVEL_STYLE.warning)}>{preview.summary.warnings} warnings</Badge>
            <Badge variant="outline" className={cn('border-transparent', LEVEL_STYLE.error)}>{preview.summary.errors} errors</Badge>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => discard.mutate()}>Discard</Button>
              <Button size="sm" disabled={valid === 0 || commit.isPending} onClick={() => commit.mutate()}>
                <Upload className="mr-1 h-4 w-4" /> Commit {valid} valid row{valid === 1 ? '' : 's'}
              </Button>
            </div>
          </div>

          {preview.missingColumns.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle>Missing columns</AlertTitle>
              <AlertDescription>The file has no column for: {preview.missingColumns.join(', ')}. Download the template to see the expected headers.</AlertDescription>
            </Alert>
          )}
          {!preview.studentIdColumn && (
            <Alert variant="destructive"><AlertTitle>No student ID column</AlertTitle><AlertDescription>Add a “Student ID” column so rows can be matched to enrolled students.</AlertDescription></Alert>
          )}

          <div className="overflow-x-auto rounded-md border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Student ID</TableHead>
                  <TableHead>Name</TableHead>
                  {offering.components.map((c) => <TableHead key={c.id}>{c.name}</TableHead>)}
                  <TableHead>Status</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r) => (
                  <TableRow key={r.rowNumber} className={r.level === 'error' ? 'bg-red-50/60 dark:bg-red-950/20' : r.level === 'warning' ? 'bg-amber-50/60 dark:bg-amber-950/20' : undefined}>
                    <TableCell className="font-mono text-xs">{r.rowNumber}</TableCell>
                    <TableCell className="font-mono text-xs">{r.studentId || '—'}</TableCell>
                    <TableCell>{r.name ?? '—'}</TableCell>
                    {offering.components.map((c) => {
                      const m = r.marks.find((x) => x.componentId === c.id);
                      return <TableCell key={c.id} className="font-mono text-xs">{!m ? '✗' : m.isAbsent ? 'ABS' : m.rawMark ?? '—'}</TableCell>;
                    })}
                    <TableCell><Badge variant="outline" className={cn('border-transparent', LEVEL_STYLE[r.level])}>{r.level}</Badge></TableCell>
                    <TableCell className="text-xs">{r.messages.join(' · ') || <span className="text-muted-foreground">Matched</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {detail.importBatches.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Recent imports: {detail.importBatches.map((b) => `${b.fileName} (${b.status.toLowerCase()}, ${b.rowsValid} valid / ${b.rowsInvalid} invalid)`).join(' · ')}
        </div>
      )}
    </div>
  );
}
