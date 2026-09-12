'use client';

import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SheetStatusBadge } from '@/components/status-badges';
import { api } from '@/lib/api';
import type { MarkSheetStatus } from '@/lib/types';

interface Offering {
  id: string;
  module: { code: string; title: string; credits: number; programme: { code: string }; moduleLeader: { name: string } | null };
  semester: { number: number; intake: { label: string; programme: { code: string } } };
  lecturer: { name: string } | null;
  components: { name: string; weight: number }[];
  markSheets: { id: string; status: MarkSheetStatus; version: number }[];
  _count: { enrollments: number };
}

export default function ModulesPage() {
  const offerings = useQuery({ queryKey: ['offerings'], queryFn: () => api<Offering[]>('/api/offerings') });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Module offerings</h1>
        <p className="text-sm text-muted-foreground">Modules running this semester, scoped to what you teach or lead. Mark sheets attach here.</p>
      </div>
      {offerings.isError && (
        <Alert variant="destructive"><AlertDescription>{(offerings.error as Error).message}</AlertDescription></Alert>
      )}
      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Module</TableHead>
              <TableHead>Cohort</TableHead>
              <TableHead>Lecturer</TableHead>
              <TableHead>Assessment</TableHead>
              <TableHead className="text-right">Enrolled</TableHead>
              <TableHead>Mark sheet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {offerings.isPending &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
              ))}
            {offerings.data?.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No module offerings in your scope.</TableCell></TableRow>
            )}
            {offerings.data?.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <div className="font-medium">{o.module.code} · {o.module.title}</div>
                  <div className="text-xs text-muted-foreground">{o.module.credits} credits · leader {o.module.moduleLeader?.name ?? '—'}</div>
                </TableCell>
                <TableCell>{o.semester.intake.programme.code} · {o.semester.intake.label} · Sem {o.semester.number}</TableCell>
                <TableCell>{o.lecturer?.name ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                <TableCell className="text-xs">{o.components.map((c) => `${c.name} ${c.weight}%`).join(' · ') || <span className="text-muted-foreground">Not configured</span>}</TableCell>
                <TableCell className="text-right">{o._count.enrollments}</TableCell>
                <TableCell>{o.markSheets[0] ? <SheetStatusBadge status={o.markSheets[0].status} /> : <span className="text-muted-foreground">None</span>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
