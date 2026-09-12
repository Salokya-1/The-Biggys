'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SheetStatusBadge } from '@/components/status-badges';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { MarkSheetStatus } from '@/lib/types';

interface Offering {
  id: string;
  module: { code: string; title: string; credits: number; programme: { code: string }; moduleLeader: { id: string; name: string } | null };
  semester: { number: number; intake: { label: string; programme: { code: string } } };
  lecturer: { id: string; name: string } | null;
  components: { name: string; weight: number }[];
  markSheets: { id: string; status: MarkSheetStatus; version: number }[];
  _count: { enrollments: number };
}

const OPEN: MarkSheetStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED'];

export default function ModulesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const offerings = useQuery({ queryKey: ['offerings'], queryFn: () => api<Offering[]>('/api/offerings') });

  const create = useMutation({
    mutationFn: (offeringId: string) => api<{ id: string }>(`/api/offerings/${offeringId}/marksheets`, { method: 'POST', body: {} }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ['offerings'] });
      void qc.invalidateQueries({ queryKey: ['marksheets'] });
      router.push(`/marksheets/${s.id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create mark sheet'),
  });

  const canCreate = (o: Offering) => {
    if (!user) return false;
    if (user.role === 'ADMIN') return true;
    if (user.role === 'LECTURER') return o.lecturer?.id === user.id;
    if (user.role === 'MODULE_LEADER') return o.lecturer?.id === user.id || o.module.moduleLeader?.id === user.id;
    return false;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Module offerings</h1>
        <p className="text-sm text-muted-foreground">Modules running per semester, scoped to what you teach or lead. Each offering carries one mark sheet per version.</p>
      </div>
      {offerings.isError && (
        <Alert variant="destructive"><AlertDescription>{(offerings.error as Error).message}</AlertDescription></Alert>
      )}
      {/* Boxed and scrolled in place: 74 offerings should not make the page itself a mile long. */}
      <div className="max-h-[calc(100dvh-16rem)] overflow-auto rounded-md border bg-background">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead>Module</TableHead>
              <TableHead>Cohort</TableHead>
              <TableHead>Lecturer</TableHead>
              <TableHead>Assessment</TableHead>
              <TableHead className="text-right">Enrolled</TableHead>
              <TableHead>Mark sheet</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {offerings.isPending &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
              ))}
            {offerings.data?.length === 0 && (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No module offerings in your scope.</TableCell></TableRow>
            )}
            {offerings.data?.map((o) => {
              const latest = o.markSheets[0];
              const hasOpen = latest && OPEN.includes(latest.status);
              const canOpenNew = !latest || latest.status === 'CORRECTION_REQUESTED';
              return (
                <TableRow key={o.id}>
                  <TableCell>
                    <div className="font-medium">{o.module.code} · {o.module.title}</div>
                    <div className="text-xs text-muted-foreground">{o.module.credits} credits · leader {o.module.moduleLeader?.name ?? '—'}</div>
                  </TableCell>
                  <TableCell>{o.semester.intake.programme.code} · {o.semester.intake.label} · Sem {o.semester.number}</TableCell>
                  <TableCell>{o.lecturer?.name ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                  <TableCell className="text-xs">{o.components.map((c) => `${c.name} ${c.weight}%`).join(' · ') || <span className="text-muted-foreground">Not configured</span>}</TableCell>
                  <TableCell className="text-right">{o._count.enrollments}</TableCell>
                  <TableCell>
                    {latest ? (
                      <Link href={`/marksheets/${latest.id}`} className="inline-flex items-center gap-2 hover:underline">
                        <SheetStatusBadge status={latest.status} /><span className="text-xs text-muted-foreground">v{latest.version}</span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="mr-1" onClick={() => router.push(`/modules/${o.id}/overview`)}>Overview</Button>
                    <Button size="sm" variant="ghost" className="mr-1" onClick={() => router.push(`/modules/${o.id}/class-list`)}>Class list</Button>
                    {hasOpen ? (
                      <Button size="sm" variant="outline" onClick={() => router.push(`/marksheets/${latest.id}`)}>Open</Button>
                    ) : canOpenNew && canCreate(o) && o.components.length > 0 ? (
                      <Button size="sm" disabled={create.isPending} onClick={() => create.mutate(o.id)}>
                        {latest ? 'New version' : 'Create mark sheet'}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
