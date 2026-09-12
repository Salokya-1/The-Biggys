'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SheetStatusBadge } from '@/components/status-badges';
import { MarksGrid } from '@/components/marksheet/marks-grid';
import { ImportPanel } from '@/components/marksheet/import-panel';
import { ReviewPanel } from '@/components/marksheet/review-panel';
import { TransitionBar } from '@/components/marksheet/transition-bar';
import { api, downloadWithAuth } from '@/lib/api';
import type { MarkSheetDetail } from '@/lib/types';

function AuditList({ detail }: { detail: MarkSheetDetail }) {
  if (detail.audit.length === 0) return <p className="text-sm text-muted-foreground">No audit entries yet.</p>;
  return (
    <ol className="space-y-2">
      {detail.audit.map((a) => {
        const before = (a.before as { status?: string } | null)?.status;
        const after = (a.after as { status?: string } | null)?.status;
        return (
          <li key={a.id} className="rounded-md border bg-background p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{a.action}</span>
              <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {a.actor ? `${a.actor.name} (${a.actor.role.replace('_', ' ')})` : 'system'}
              {before && after ? ` · ${before} → ${after}` : ''}
              {a.reason ? ` · reason: “${a.reason}”` : ''}
            </div>
            {a.action === 'marks.update' && Array.isArray(a.after) && (
              <div className="mt-1 text-xs text-muted-foreground">{(a.after as unknown[]).length} cell{(a.after as unknown[]).length === 1 ? '' : 's'} changed (before/after values stored)</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function MarkSheetPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['marksheet', id], queryFn: () => api<MarkSheetDetail>(`/api/marksheets/${id}`) });

  if (q.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (q.isError) return <Alert variant="destructive"><AlertDescription>{(q.error as Error).message}</AlertDescription></Alert>;

  const d = q.data;
  const { sheet, offering } = d;
  const defaultTab = sheet.status === 'DRAFT' ? 'marks' : 'review';

  return (
    <div className="space-y-4">
      <Link href="/marksheets" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-4 w-4" /> Mark sheets</Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{offering.module.code} · {offering.module.title}</h1>
            <SheetStatusBadge status={sheet.status} />
            <span className="text-sm text-muted-foreground">v{sheet.version}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Intake {offering.semester.intake.label} · Semester {offering.semester.number} · Lecturer {offering.lecturer?.name ?? '—'} · {d.rows.length} enrolled · {offering.components.map((c) => `${c.name} ${c.weight}%`).join(', ')}
          </p>
          <p className="text-xs text-muted-foreground">
            {sheet.submittedBy ? `Submitted by ${sheet.submittedBy.name} ${sheet.submittedAt ? new Date(sheet.submittedAt).toLocaleString() : ''}` : 'Not yet submitted'}
            {sheet.approvedBy ? ` · Approved by ${sheet.approvedBy.name}` : ''}
            {sheet.publishedAt ? ` · Published ${new Date(sheet.publishedAt).toLocaleString()}${new Date(sheet.publishedAt) > new Date() ? ' (scheduled)' : ''}` : ''}
            {sheet.rejectReason && sheet.status === 'DRAFT' ? ` · Returned: “${sheet.rejectReason}”` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadWithAuth(`/api/marksheets/${sheet.id}/export.xlsx`, `${offering.module.code}-v${sheet.version}-marks.xlsx`).catch((e) => toast.error(e.message))}>
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Export .xlsx
          </Button>
          <TransitionBar detail={d} />
        </div>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="marks">Marks</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="review">Review {d.validation.errors.length > 0 ? `(${d.validation.errors.length})` : d.flags.some((f) => f.level === 'warning') ? '⚑' : ''}</TabsTrigger>
          <TabsTrigger value="audit">Audit ({d.audit.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="marks" className="pt-3"><MarksGrid key={sheet.lockVersion} detail={d} /></TabsContent>
        <TabsContent value="import" className="pt-3"><ImportPanel detail={d} /></TabsContent>
        <TabsContent value="review" className="pt-3"><ReviewPanel detail={d} /></TabsContent>
        <TabsContent value="audit" className="pt-3"><AuditList detail={d} /></TabsContent>
      </Tabs>
    </div>
  );
}
