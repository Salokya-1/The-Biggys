'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { OutcomeBadge } from '@/components/status-badges';
import { api, downloadWithAuth } from '@/lib/api';
import type { ClassList, Outcome } from '@/lib/types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function ClassListPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['class-list', id], queryFn: () => api<ClassList>(`/api/offerings/${id}/class-list`) });

  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-8 w-96" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError) return <Alert variant="destructive"><AlertDescription>{(q.error as Error).message}</AlertDescription></Alert>;
  const d = q.data;
  const o = d.offering;

  return (
    <div className="space-y-4">
      <Link href="/modules" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline print:hidden"><ArrowLeft className="h-4 w-4" /> Modules</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{o.module.code} · {o.module.title}</h1>
          <p className="text-sm text-muted-foreground">
            Class list · {o.semester.intake.programme.code} {o.semester.intake.label} · Semester {o.semester.number} ({o.semester.term.toLowerCase()}) · {o.module.credits} credits
            {o.lecturer ? ` · taught by ${o.lecturer.name}` : ''}{o.module.moduleLeader ? ` · led by ${o.module.moduleLeader.name}` : ''}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button size="sm" variant="outline" onClick={() => downloadWithAuth(`/api/offerings/${id}/class-list.csv`, `${o.module.code}-class-list.csv`).catch((e) => toast.error(e.message))}>
            <Download className="mr-1 h-4 w-4" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" /> Print</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Students', value: d.total },
          { label: 'Sections', value: d.sections.length },
          { label: 'Resit attempts', value: d.resits },
          { label: 'Special-needs seating', value: d.specialNeeds },
        ].map((t) => (
          <Card key={t.label} className="rounded-none"><CardHeader className="pb-1"><CardDescription>{t.label}</CardDescription><CardTitle className="text-2xl">{t.value}</CardTitle></CardHeader></Card>
        ))}
      </div>

      {d.sections.map((s) => (
        <Card key={s.section}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Section {s.section} <span className="font-normal text-muted-foreground">· {s.students.length} students</span></CardTitle>
            <CardDescription>
              {s.classes.length ? s.classes.map((c) => `${DAYS[c.dayOfWeek - 1]} ${c.startTime}–${c.endTime}${c.venue ? ` ${c.venue}` : ''} (${c.teacher})`).join(' · ') : 'No weekly classes scheduled for this section yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead className="w-10">#</TableHead><TableHead>Student ID</TableHead><TableHead>Name</TableHead><TableHead>Attempt</TableHead><TableHead>Status</TableHead><TableHead>Latest result</TableHead></TableRow></TableHeader>
              <TableBody>
                {s.students.map((r, i) => (
                  <TableRow key={r.enrollmentId}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs"><Link href={`/students/${r.studentRecordId}`} className="hover:underline">{r.studentId}</Link></TableCell>
                    <TableCell>{r.name}{r.specialNeedsSeating && <Badge variant="outline" className="ml-2 text-[10px]">SN</Badge>}</TableCell>
                    <TableCell>{r.attempt}{r.isResit && <Badge variant="outline" className="ml-1 text-[10px]">resit</Badge>}</TableCell>
                    <TableCell className="text-xs">{r.status}</TableCell>
                    <TableCell>{r.result ? <span className="flex items-center gap-2"><span className="font-mono text-xs">{r.result.overallMark.toFixed(1)}</span> {r.result.grade} <OutcomeBadge outcome={r.result.outcome as Outcome} />{!r.result.published && <span className="text-[10px] text-muted-foreground">unpublished</span>}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
