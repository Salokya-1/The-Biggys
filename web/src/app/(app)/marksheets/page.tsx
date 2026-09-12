'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SheetStatusBadge } from '@/components/status-badges';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { MarkSheetListItem, MarkSheetStatus } from '@/lib/types';

const STATUSES: (MarkSheetStatus | 'ALL')[] = ['ALL', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED', 'CORRECTION_REQUESTED'];

export default function MarkSheetsPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<MarkSheetStatus | 'ALL'>('ALL');
  const sheets = useQuery({
    queryKey: ['marksheets', status],
    queryFn: () => api<MarkSheetListItem[]>(`/api/marksheets${qs({ status: status === 'ALL' ? undefined : status })}`),
  });

  const queueHint =
    user?.role === 'MODULE_LEADER'
      ? 'Sheets in SUBMITTED are waiting for your review.'
      : user?.role === 'ADMIN'
        ? 'Sheets in APPROVED are ready to publish.'
        : 'Your DRAFT sheets need marks; submit when complete.';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mark sheets</h1>
        <p className="text-sm text-muted-foreground">Result pipeline: DRAFT → SUBMITTED → UNDER REVIEW → APPROVED → PUBLISHED. {queueHint}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Button key={s} size="sm" variant={s === status ? 'default' : 'outline'} onClick={() => setStatus(s)}>
            {s === 'ALL' ? 'All' : s.replace('_', ' ')}
          </Button>
        ))}
      </div>

      {sheets.isError && (
        <Alert variant="destructive"><AlertDescription>{(sheets.error as Error).message}</AlertDescription></Alert>
      )}

      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Module</TableHead>
              <TableHead>Cohort</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Lecturer</TableHead>
              <TableHead className="text-right">Marks entered</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sheets.isPending &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
              ))}
            {sheets.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No mark sheets{status !== 'ALL' ? ` in ${status.replace('_', ' ')}` : ''}. Create one from the <Link href="/modules" className="underline">Modules</Link> page.
                </TableCell>
              </TableRow>
            )}
            {sheets.data?.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link href={`/marksheets/${s.id}`} className="block font-medium hover:underline">
                    {s.moduleOffering.module.code} · {s.moduleOffering.module.title}
                  </Link>
                </TableCell>
                <TableCell>{s.moduleOffering.semester.intake.programme.code} · {s.moduleOffering.semester.intake.label} · Sem {s.moduleOffering.semester.number}</TableCell>
                <TableCell>v{s.version}</TableCell>
                <TableCell><SheetStatusBadge status={s.status} /></TableCell>
                <TableCell>{s.moduleOffering.lecturer?.name ?? '—'}</TableCell>
                <TableCell className="text-right font-mono text-xs">{s._count.marks} / {s.moduleOffering._count.enrollments}×c</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(s.updatedAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
