'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Download, FileSpreadsheet, TriangleAlert, Upload, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { API_URL, downloadWithAuth, getTokens } from '@/lib/api';
import { cn } from '@/lib/utils';

type Kind = 'timetable' | 'students' | 'teachers';

interface PreviewRow {
  rowNumber: number;
  level: 'ok' | 'warning' | 'error';
  message: string;
}
interface Preview {
  filename: string;
  headers: string[];
  total: number;
  ok: number;
  warnings: number;
  errors: number;
  rows: PreviewRow[];
}

const KINDS: { kind: Kind; title: string; blurb: string; columns: string }[] = [
  {
    kind: 'timetable',
    title: 'Timetable',
    blurb: 'One row per class, the same shape as the resource-allocation sheet. Times may be written 0630 or 06:30, and a lecture may list several groups joined with a plus.',
    columns: 'Day · Time Start · Time End · Class Type · Module Code · Lecturer · Group · Room',
  },
  { kind: 'students', title: 'Students', blurb: 'New students are created with a login; anyone whose ID already exists has their name and group updated instead.', columns: 'Student ID · Name · Email · Programme · Intake · Group' },
  { kind: 'teachers', title: 'Teachers', blurb: 'Staff are matched on email. An existing address is updated rather than duplicated.', columns: 'Name · Email · Role' },
];

/** Upload runs through fetch directly: the shared api() helper sends JSON, not multipart. */
async function send(kind: Kind, step: 'preview' | 'commit', file: File) {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`${API_URL}/api/import/${kind}/${step}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${getTokens()?.accessToken ?? ''}` },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { message?: string }).message ?? `Upload failed (${res.status})`);
  return json;
}

export default function ImportPage() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>('timetable');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const check = useMutation({
    mutationFn: (f: File) => send(kind, 'preview', f) as Promise<Preview>,
    onSuccess: (p) => setPreview(p),
    onError: (e: Error) => toast.error(e.message),
  });

  const commit = useMutation({
    mutationFn: (f: File) => send(kind, 'commit', f) as Promise<{ created: number; updated: number; skipped: number }>,
    onSuccess: (r) => {
      setPreview(null);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      qc.invalidateQueries();
      toast.success(`Imported: ${r.created} created, ${r.updated} updated`, { description: r.skipped ? `${r.skipped} rows skipped because they had errors.` : undefined, duration: 8000 });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const active = KINDS.find((k) => k.kind === kind)!;

  return (
    <div className="space-y-4">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Import from a spreadsheet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring an existing routine, roll or staff list straight in. Every file is checked row by row first and nothing is written until you accept it, so a bad column cannot half-load your data.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <Button
            key={k.kind}
            size="sm"
            variant={k.kind === kind ? 'default' : 'outline'}
            onClick={() => {
              setKind(k.kind);
              setPreview(null);
              setFile(null);
              if (inputRef.current) inputRef.current.value = '';
            }}
          >
            {k.title}
          </Button>
        ))}
      </div>

      <Card className="rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{active.title}</CardTitle>
          <CardDescription>{active.blurb}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            <span className="text-muted-foreground">Columns: </span>
            <span className="font-mono text-xs">{active.columns}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadWithAuth(`/api/import/${kind}/template.csv`, `${kind}-template.csv`).catch((e: Error) => toast.error(e.message))}>
              <Download className="mr-1 h-4 w-4" /> Download the template
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="text-sm file:mr-3 file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm hover:file:bg-accent"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPreview(null);
                if (f) check.mutate(f);
              }}
            />
            {check.isPending ? <span className="text-sm text-muted-foreground">Checking…</span> : null}
          </div>
        </CardContent>
      </Card>

      {preview ? (
        <Card className="rounded-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{preview.filename}</CardTitle>
            <CardDescription>
              {preview.total} rows · {preview.ok} ready · {preview.warnings} to update · {preview.errors} with errors
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {preview.errors > 0 ? (
              <Alert variant="destructive" className="rounded-none">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription>{preview.errors} rows will be skipped. Fix them in the file and upload again if you need them.</AlertDescription>
              </Alert>
            ) : null}

            <div className="max-h-96 overflow-auto border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow><TableHead className="w-16">Row</TableHead><TableHead className="w-24">Status</TableHead><TableHead>What will happen</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((r) => (
                    <TableRow key={r.rowNumber} className={cn(r.level === 'error' && 'bg-destructive/5')}>
                      <TableCell className="tabular-nums text-muted-foreground">{r.rowNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('rounded-none', r.level === 'ok' && 'text-emerald-700 dark:text-emerald-400', r.level === 'warning' && 'text-amber-700 dark:text-amber-400', r.level === 'error' && 'text-destructive')}>
                          {r.level === 'ok' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : r.level === 'warning' ? <TriangleAlert className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
                          {r.level === 'ok' ? 'New' : r.level === 'warning' ? 'Update' : 'Error'}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-normal text-sm">{r.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={!file || commit.isPending || preview.ok + preview.warnings === 0} onClick={() => file && commit.mutate(file)}>
                <Upload className="mr-1 h-4 w-4" />
                {commit.isPending ? 'Importing…' : `Import ${preview.ok + preview.warnings} rows`}
              </Button>
              <Button variant="outline" onClick={() => setPreview(null)}>Cancel</Button>
              {preview.ok + preview.warnings === 0 ? <span className="text-sm text-muted-foreground">Nothing in this file can be imported.</span> : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-none">
          <CardContent className="py-10 text-center">
            <FileSpreadsheet className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">Choose a file above and it will be checked before anything is written.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
