'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { OutcomeBadge } from '@/components/status-badges';
import { api, ApiError } from '@/lib/api';
import type { MarkSheetDetail } from '@/lib/types';

type Cell = { rawMark: number | null; isAbsent: boolean };
const key = (e: string, c: string) => `${e}:${c}`;

export function MarksGrid({ detail }: { detail: MarkSheetDetail }) {
  const qc = useQueryClient();
  const { offering, rows, editable, sheet } = detail;
  const [edits, setEdits] = useState<Record<string, Cell>>({});
  const dirty = Object.keys(edits).length;

  const cellValue = (enrollmentId: string, componentId: string): Cell => {
    const e = edits[key(enrollmentId, componentId)];
    if (e) return e;
    const m = rows.find((r) => r.enrollmentId === enrollmentId)!.marks[componentId];
    return { rawMark: m.rawMark, isAbsent: m.isAbsent };
  };

  const setCell = (enrollmentId: string, componentId: string, next: Cell) => {
    const original = rows.find((r) => r.enrollmentId === enrollmentId)!.marks[componentId];
    setEdits((prev) => {
      const copy = { ...prev };
      if (next.rawMark === original.rawMark && next.isAbsent === original.isAbsent) delete copy[key(enrollmentId, componentId)];
      else copy[key(enrollmentId, componentId)] = next;
      return copy;
    });
  };

  const save = useMutation({
    mutationFn: () =>
      api<{ changed: number; lockVersion: number }>(`/api/marksheets/${sheet.id}/marks`, {
        method: 'PUT',
        body: {
          lockVersion: sheet.lockVersion,
          marks: Object.entries(edits).map(([k, v]) => {
            const [enrollmentId, componentId] = k.split(':');
            return { enrollmentId, componentId, rawMark: v.isAbsent ? null : v.rawMark, isAbsent: v.isAbsent };
          }),
        },
      }),
    onSuccess: (res) => {
      toast.success(`Saved ${res.changed} change${res.changed === 1 ? '' : 's'}`);
      setEdits({});
      void qc.invalidateQueries({ queryKey: ['marksheet', sheet.id] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        toast.error('Someone else changed this sheet. Reloading the latest version — your unsaved edits are kept.');
        void qc.invalidateQueries({ queryKey: ['marksheet', sheet.id] });
      } else toast.error(err instanceof Error ? err.message : 'Save failed');
    },
  });

  /** Client-side overall preview so lecturers see the effect before saving. */
  const preview = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const r of rows) {
      let total = 0;
      let any = false;
      for (const c of offering.components) {
        const v = cellValue(r.enrollmentId, c.id);
        if (v.isAbsent) {
          any = true;
          continue;
        }
        if (v.rawMark === null) continue;
        any = true;
        total += (v.rawMark / c.maxMark) * c.weight;
      }
      out[r.enrollmentId] = any ? Math.round(total * 100) / 100 : null;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, edits, offering.components]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {editable ? 'Enter marks per component, or tick Abs for absent. Overall updates live; grade and outcome are computed on save.' : `Read-only: the sheet is ${sheet.status.replace('_', ' ')}.`}
        </p>
        {editable && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!dirty} onClick={() => setEdits({})}><Undo2 className="mr-1 h-4 w-4" /> Discard</Button>
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Save className="mr-1 h-4 w-4" /> Save {dirty ? `(${dirty})` : ''}</Button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">Student</TableHead>
              <TableHead>Attempt</TableHead>
              {offering.components.map((c) => (
                <TableHead key={c.id} className="min-w-[150px]">
                  {c.name}
                  <div className="text-[10px] font-normal text-muted-foreground">/{c.maxMark} · {c.weight}%{c.componentPassMark != null ? ` · min ${c.componentPassMark}` : ''}</div>
                </TableHead>
              ))}
              <TableHead className="text-right">Overall</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={5 + offering.components.length} className="py-8 text-center text-muted-foreground">No students enrolled.</TableCell></TableRow>
            )}
            {rows.map((r) => {
              const changed = offering.components.some((c) => edits[key(r.enrollmentId, c.id)]);
              return (
                <TableRow key={r.enrollmentId} className={changed ? 'bg-amber-50 dark:bg-amber-950/20' : undefined}>
                  <TableCell>
                    <div className="font-medium">{r.student.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{r.student.studentId}</div>
                  </TableCell>
                  <TableCell>{r.attempt}{r.isResit && <Badge variant="outline" className="ml-1">Resit</Badge>}</TableCell>
                  {offering.components.map((c) => {
                    const v = cellValue(r.enrollmentId, c.id);
                    const invalid = v.rawMark !== null && (v.rawMark < 0 || v.rawMark > c.maxMark);
                    return (
                      <TableCell key={c.id}>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={c.maxMark}
                            step="0.5"
                            className={`h-8 w-24 ${invalid ? 'border-destructive' : ''}`}
                            disabled={!editable || v.isAbsent}
                            value={v.isAbsent ? '' : v.rawMark ?? ''}
                            placeholder={v.isAbsent ? 'ABS' : '—'}
                            onChange={(e) => {
                              const raw = e.target.value === '' ? null : Number(e.target.value);
                              setCell(r.enrollmentId, c.id, { rawMark: raw, isAbsent: false });
                            }}
                          />
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Checkbox
                              disabled={!editable}
                              checked={v.isAbsent}
                              onCheckedChange={(checked) => setCell(r.enrollmentId, c.id, { rawMark: checked ? null : v.rawMark, isAbsent: !!checked })}
                            />
                            Abs
                          </label>
                        </div>
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right font-mono">{preview[r.enrollmentId] ?? '—'}</TableCell>
                  <TableCell>{changed ? <span className="text-xs text-muted-foreground">save to compute</span> : r.computed?.grade ?? '—'}</TableCell>
                  <TableCell>{changed ? '' : r.computed ? <OutcomeBadge outcome={r.computed.outcome} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
