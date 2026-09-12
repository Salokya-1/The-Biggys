'use client';

import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { OutcomeBadge } from '@/components/status-badges';
import type { MarkSheetDetail } from '@/lib/types';

export function ReviewPanel({ detail }: { detail: MarkSheetDetail }) {
  const { validation, flags, stats, rows, offering, sheet } = detail;
  const warnings = flags.filter((f) => f.level === 'warning');
  const infos = flags.filter((f) => f.level === 'info');
  const outcomes = rows.reduce<Record<string, number>>((acc, r) => {
    const o = r.computed?.outcome ?? 'PENDING';
    acc[o] = (acc[o] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {validation.errors.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{validation.errors.length} issue{validation.errors.length === 1 ? '' : 's'} block submission</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc pl-4 text-xs">{validation.errors.slice(0, 15).map((e, i) => <li key={i}>{e}</li>)}{validation.errors.length > 15 && <li>…and {validation.errors.length - 15} more</li>}</ul>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Complete</AlertTitle>
          <AlertDescription>Every enrolled student has a mark or an absence for every component. Weights sum to 100. Scheme: {sheet.gradingScheme?.name ?? 'default'} (pass {sheet.gradingScheme?.passMark ?? 40}, resit cap {sheet.gradingScheme?.resitCap ?? 40}).</AlertDescription>
        </Alert>
      )}
      {validation.warnings.length > 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Notes</AlertTitle>
          <AlertDescription><ul className="mt-1 list-disc pl-4 text-xs">{validation.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Statistical flags <span className="text-sm font-normal text-muted-foreground">— explainable, never blocking, never change a mark</span></CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {warnings.length === 0 && infos.length === 0 && <p className="text-muted-foreground">Nothing unusual detected.</p>}
          {warnings.map((f, i) => (
            <div key={i} className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{f.message}</span>
            </div>
          ))}
          {infos.map((f, i) => (
            <div key={i} className="flex items-start gap-2 text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0" /><span>{f.message}</span></div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Component statistics (% of max)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Component</TableHead><TableHead className="text-right">n</TableHead><TableHead className="text-right">Mean</TableHead><TableHead className="text-right">σ</TableHead><TableHead className="text-right">Min</TableHead><TableHead className="text-right">Max</TableHead><TableHead className="text-right">Missing</TableHead><TableHead className="text-right">Absent</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {stats.map((s) => (
                  <TableRow key={s.componentId}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell className="text-right font-mono">{s.n}</TableCell>
                    <TableCell className="text-right font-mono">{s.mean ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">{s.sd ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">{s.min ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">{s.max ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">{s.missing}</TableCell>
                    <TableCell className="text-right font-mono">{s.absent}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Outcome summary</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['PASS', 'RESIT', 'FAIL', 'DEFERRED', 'PENDING'] as const).map((o) => (
              <div key={o} className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">{o}</div>
                <div className="text-2xl font-semibold">{outcomes[o] ?? 0}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Computed results</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                {offering.components.map((c) => <TableHead key={c.id} className="text-right">{c.name}</TableHead>)}
                <TableHead className="text-right">Overall</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.enrollmentId}>
                  <TableCell><div className="font-medium">{r.student.name}</div><div className="font-mono text-xs text-muted-foreground">{r.student.studentId}{r.isResit ? ' · resit' : ''}</div></TableCell>
                  {offering.components.map((c) => <TableCell key={c.id} className="text-right font-mono">{r.marks[c.id].isAbsent ? 'ABS' : r.marks[c.id].rawMark ?? '—'}</TableCell>)}
                  <TableCell className="text-right font-mono">{r.computed ? r.computed.overallMark : '—'}{r.computed && r.computed.uncappedMark !== r.computed.overallMark ? <span className="text-xs text-muted-foreground"> (uncapped {r.computed.uncappedMark})</span> : null}</TableCell>
                  <TableCell>{r.computed?.grade ?? '—'}</TableCell>
                  <TableCell>{r.computed ? <OutcomeBadge outcome={r.computed.outcome} /> : <span className="text-muted-foreground">Pending</span>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.computed?.reasons.join('; ') || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
