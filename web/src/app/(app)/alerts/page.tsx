'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, TriangleAlert, UserCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ClassAlertRow } from '@/lib/types';

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100',
  COVER_ASSIGNED: 'bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100',
  RESOLVED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100',
  DISMISSED: 'bg-muted text-muted-foreground',
};
const KIND_LABEL: Record<string, string> = {
  TEACHER_ABSENT: 'No teacher present',
  NO_TEACHER_ASSIGNED: 'No teacher assigned',
  ROOM_PROBLEM: 'Room problem',
};

export default function ClassAlertsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [assign, setAssign] = useState<{ alert: ClassAlertRow; coverId: string } | null>(null);

  const alerts = useQuery({ queryKey: ['class-alerts'], queryFn: () => api<ClassAlertRow[]>('/api/class-alerts'), refetchInterval: 30_000 });
  const teachers = useQuery({ queryKey: ['tt', 'teachers'], queryFn: () => api<{ id: string; name: string }[]>('/api/timetable/teachers') });
  const broadcasts = useQuery({
    queryKey: ['broadcasts'],
    queryFn: () => api<{ id: string; title: string; body: string; sender: string; recipients: number; createdAt: string }[]>('/api/broadcasts'),
  });

  const resolve = useMutation({
    mutationFn: (v: { id: string; status: 'COVER_ASSIGNED' | 'RESOLVED' | 'DISMISSED'; coverId?: string }) =>
      api(`/api/class-alerts/${v.id}/resolve`, { method: 'POST', body: { status: v.status, coverId: v.coverId } }),
    onSuccess: () => {
      setAssign(null);
      qc.invalidateQueries({ queryKey: ['class-alerts'] });
      toast.success('Recorded');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (alerts.isPending) return <div className="space-y-3"><Skeleton className="h-8 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (alerts.isError) return <Alert variant="destructive"><AlertDescription>{(alerts.error as Error).message}</AlertDescription></Alert>;

  const rows = alerts.data;
  const open = rows.filter((r) => r.status === 'OPEN');
  const teacherItems = Object.fromEntries((teachers.data ?? []).map((t) => [t.id, t.name]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Class alerts</h1>
        <p className="text-sm text-muted-foreground">
          Raised by the students in the room when nobody has come to teach. Where a teacher of the same module is free, cover is assigned the moment the alert lands; anything left open needs a person.
        </p>
      </div>

      {open.length > 0 ? (
        <Alert variant="destructive" className="rounded-none">
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription>
            {open.length} {open.length === 1 ? 'class has' : 'classes have'} no cover. Assign someone now.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Announcements land here too: an alerts screen that shows only the alarms misses the
          notices that were sent out precisely so nobody has to raise one. */}
      {(broadcasts.data ?? []).length > 0 && (
        <Card className="rounded-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Announcements</CardTitle>
            <CardDescription>Sent to everyone from the RTE office. <Link href="/announcements" className="underline">Send one</Link>.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(broadcasts.data ?? []).slice(0, 5).map((b) => (
              <div key={b.id} className="min-w-0 border-l-2 border-primary bg-muted/40 p-2 text-sm">
                <p className="font-medium break-words">{b.title}</p>
                <p className="break-words whitespace-pre-wrap text-muted-foreground">{b.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{b.sender} · {b.recipients} recipients · {new Date(b.createdAt).toLocaleString()}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Reports</CardTitle>
          <CardDescription>{rows.length} on record · refreshes every 30 seconds</CardDescription>
        </CardHeader>
        <CardContent className="max-h-[calc(100dvh-22rem)] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Raised</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Problem</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-medium">{r.slot.moduleOffering.module.code}</span> · {r.slot.section.name}
                    <span className="block text-xs text-muted-foreground">scheduled: {r.slot.teacher.name}{r.slot.venue ? ` · ${r.slot.venue.name}` : ''}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{r.date.slice(0, 10)} {r.slot.startTime}–{r.slot.endTime}</TableCell>
                  <TableCell>
                    {KIND_LABEL[r.kind] ?? r.kind}
                    {r.note ? <span className="block max-w-[16rem] truncate text-xs text-muted-foreground" title={r.note}>“{r.note}”</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{r.raisedBy.name}</TableCell>
                  <TableCell>
                    <Badge className={`rounded-none ${STATUS_STYLE[r.status]}`}>{r.status.replace('_', ' ')}</Badge>
                    {r.cover ? <span className="block text-xs text-muted-foreground">{r.cover.name}</span> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {can('timetable.write') && (r.status === 'OPEN' || r.status === 'COVER_ASSIGNED') ? (
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setAssign({ alert: r, coverId: '' })}><UserCheck className="mr-1 h-3.5 w-3.5" /> Assign cover</Button>
                        <Button size="sm" variant="outline" onClick={() => resolve.mutate({ id: r.id, status: 'RESOLVED' })}><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Resolved</Button>
                        <Button size="sm" variant="ghost" onClick={() => resolve.mutate({ id: r.id, status: 'DISMISSED' })}><XCircle className="mr-1 h-3.5 w-3.5" /> Dismiss</Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No class has been reported without a teacher.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!assign} onOpenChange={(o) => !o && setAssign(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign cover</DialogTitle>
            <DialogDescription>
              {assign ? `${assign.alert.slot.moduleOffering.module.code}, group ${assign.alert.slot.section.name}, ${assign.alert.slot.startTime}–${assign.alert.slot.endTime} on ${assign.alert.date.slice(0, 10)}.` : ''}
              {' '}The class is updated for that day only and the teacher is told.
            </DialogDescription>
          </DialogHeader>
          {assign && (
            <div className="space-y-1">
              <Label>Teacher</Label>
              <Select value={assign.coverId} onValueChange={(v) => setAssign({ ...assign, coverId: v ?? '' })} items={teacherItems}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose who covers it" /></SelectTrigger>
                <SelectContent>{Object.entries(teacherItems).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssign(null)}>Cancel</Button>
            <Button disabled={!assign?.coverId || resolve.isPending} onClick={() => assign && resolve.mutate({ id: assign.alert.id, status: 'COVER_ASSIGNED', coverId: assign.coverId })}>
              {resolve.isPending ? 'Assigning…' : 'Assign and notify'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
