'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, ApiError, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface Req {
  id: string;
  kind: 'TEACHER_ABSENCE' | 'STUDENT_ABSENCE' | 'SECTION_SWAP';
  date: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requesterId?: string;
  createdAt: string;
  decisionNote: string | null;
  requester: { id: string; name: string; role: string; student: { studentId: string; section: { name: string } | null } | null };
  decidedBy: { name: string } | null;
  slot: { id: string; dayOfWeek: number; startTime: string; endTime: string; section: { name: string }; moduleOffering: { module: { code: string; title: string } }; teacher: { id: string; name: string } } | null;
  targetSection: { name: string } | null;
}

const KIND: Record<Req['kind'], string> = { TEACHER_ABSENCE: 'Teacher absence', STUDENT_ABSENCE: 'Student absence', SECTION_SWAP: 'Section change' };
const STATUS_STYLE: Record<Req['status'], string> = {
  CANCELLED: 'bg-muted text-muted-foreground',
  PENDING: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200',
  APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  REJECTED: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
};

export default function RequestsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canDecide = user?.role === 'ADMIN' || user?.role === 'MODULE_LEADER';
  // Whoever raised a request can withdraw it while nobody has decided it yet.
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/api/requests/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      toast.success('Request withdrawn');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [status, setStatus] = useState<'ALL' | Req['status']>(canDecide ? 'PENDING' : 'ALL');
  const list = useQuery({ queryKey: ['requests', status], queryFn: () => api<Req[]>(`/api/requests${qs({ status: status === 'ALL' ? undefined : status })}`) });
  const teachers = useQuery({ queryKey: ['tt', 'teachers'], queryFn: () => api<{ id: string; name: string }[]>('/api/timetable/teachers'), enabled: canDecide });
  const [deciding, setDeciding] = useState<{ r: Req; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [note, setNote] = useState('');
  const [cover, setCover] = useState('');

  const decide = useMutation({
    mutationFn: () => api(`/api/requests/${deciding!.r.id}/decide`, { method: 'POST', body: { decision: deciding!.decision, note: note || undefined, coverTeacherId: cover || undefined } }),
    onSuccess: () => {
      toast.success(`Request ${deciding?.decision.toLowerCase()}`);
      setDeciding(null);
      setNote('');
      setCover('');
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['tt'] });
    },
    onError: (e) => toast.error(e instanceof ApiError && e.details && typeof e.details === 'object' && 'conflicts' in e.details ? `${e.message}: ${(e.details as { conflicts: string[] }).conflicts.join('; ')}` : e instanceof Error ? e.message : 'Failed'),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{canDecide ? 'Requests' : 'My requests'}</h1>
        <p className="text-sm text-muted-foreground">{canDecide ? 'Teacher absences (assign cover or cancel the class), student absences and section changes.' : 'Absence and section-change requests you have made, with the RTE decision.'}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((s) => <Button key={s} size="sm" variant={s === status ? 'default' : 'outline'} onClick={() => setStatus(s)}>{s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}</Button>)}
      </div>
      {list.isError && <Alert variant="destructive"><AlertDescription>{(list.error as Error).message}</AlertDescription></Alert>}
      <div className="overflow-x-auto border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Kind</TableHead><TableHead>Who</TableHead><TableHead>Class / target</TableHead><TableHead>Date</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {list.isPending && Array.from({ length: 3 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>)}
            {list.data?.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No requests.</TableCell></TableRow>}
            {list.data?.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{KIND[r.kind]}</TableCell>
                <TableCell>{r.requester.name}<div className="text-xs text-muted-foreground">{r.requester.student ? `${r.requester.student.studentId}${r.requester.student.section ? ` · section ${r.requester.student.section.name}` : ''}` : r.requester.role.replace('_', ' ').toLowerCase()}</div></TableCell>
                <TableCell className="text-sm">{r.slot ? `${r.slot.moduleOffering.module.code} · section ${r.slot.section.name} · ${r.slot.startTime}–${r.slot.endTime}` : r.targetSection ? `→ Section ${r.targetSection.name}` : '—'}</TableCell>
                <TableCell className="text-sm">{r.date.slice(0, 10)}</TableCell>
                <TableCell className="max-w-xs text-sm">{r.reason}{r.decisionNote && <div className="text-xs text-muted-foreground">Decision: {r.decisionNote}</div>}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('border-transparent', STATUS_STYLE[r.status])}>{r.status}</Badge>
                  {r.decidedBy && <div className="text-xs text-muted-foreground">{r.decidedBy.name}</div>}
                  {!canDecide && (
                    <div className="mt-0.5 max-w-[14rem] text-xs text-muted-foreground">
                      {r.status === 'PENDING' && 'Sent — waiting for a decision'}
                      {r.status === 'APPROVED' && 'Accepted'}
                      {r.status === 'REJECTED' && 'Turned down'}
                      {r.status === 'CANCELLED' && 'You withdrew this'}
                      {r.decisionNote ? ` · “${r.decisionNote}”` : ''}
                    </div>
                  )}
                </TableCell>
                {!canDecide && (
                  <TableCell className="text-right">
                    {r.status === 'PENDING' ? (
                      <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>Withdraw</Button>
                    ) : null}
                  </TableCell>
                )}
                {canDecide && (
                  <TableCell className="text-right">
                    {r.status === 'PENDING' && (
                      <div className="flex justify-end gap-1">
                        <Button size="xs" onClick={() => setDeciding({ r, decision: 'APPROVED' })}>Approve</Button>
                        <Button size="xs" variant="outline" onClick={() => setDeciding({ r, decision: 'REJECTED' })}>Reject</Button>
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!deciding} onOpenChange={(o) => !o && setDeciding(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{deciding?.decision === 'APPROVED' ? 'Approve' : 'Reject'} {deciding ? KIND[deciding.r.kind].toLowerCase() : ''}</DialogTitle>
            <DialogDescription>{deciding?.r.requester.name} · {deciding?.r.date.slice(0, 10)} · {deciding?.r.reason}</DialogDescription>
          </DialogHeader>
          {deciding?.decision === 'APPROVED' && deciding.r.kind === 'TEACHER_ABSENCE' && (
            <div className="space-y-1">
              <Label>Cover teacher (leave empty to cancel the class)</Label>
              <Select value={cover} onValueChange={(v) => setCover(v ?? '')} items={{ '': 'No cover — cancel the class', ...Object.fromEntries((teachers.data ?? []).filter((t) => t.id !== deciding.r.slot?.teacher.id).map((t) => [t.id, t.name])) }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="No cover — cancel the class" /></SelectTrigger>
                <SelectContent>{(teachers.data ?? []).filter((t) => t.id !== deciding.r.slot?.teacher.id).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">The cover teacher must be free at that time; clashes are rejected.</p>
            </div>
          )}
          {deciding?.decision === 'APPROVED' && deciding.r.kind === 'SECTION_SWAP' && <p className="text-sm text-muted-foreground">The student moves to section {deciding.r.targetSection?.name} and follows that section&apos;s routine from now on.</p>}
          <div className="space-y-1"><Label>Note to the requester (optional)</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>Back</Button>
            <Button variant={deciding?.decision === 'REJECTED' ? 'destructive' : 'default'} disabled={decide.isPending} onClick={() => decide.mutate()}>{decide.isPending ? 'Working…' : 'Confirm'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
