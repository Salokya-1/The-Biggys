'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Mail, MailWarning, Video, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ReasonField } from '@/components/reason-field';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CameraRequestList, EmailOutbox, ExamSessionListItem, Venue } from '@/lib/types';

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  SENT: 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100',
  APPROVED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100',
  DENIED: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100',
};

interface Form {
  examSessionId: string;
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
}
const EMPTY: Form = { examSessionId: '', venueId: '', date: '', startTime: '09:00', endTime: '11:00', reason: '' };

export default function CameraAccessPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);

  const list = useQuery({ queryKey: ['camera-requests'], queryFn: () => api<CameraRequestList>('/api/camera-requests') });
  const exams = useQuery({ queryKey: ['exams', 'for-camera'], queryFn: () => api<ExamSessionListItem[]>('/api/exams') });
  const venues = useQuery({ queryKey: ['venues'], queryFn: () => api<Venue[]>('/api/venues') });

  const create = useMutation({
    mutationFn: (f: Form) =>
      api<{ reference: string; status: string; email: { to: string; status: string } }>('/api/camera-requests', {
        method: 'POST',
        body: f.examSessionId
          ? { examSessionId: f.examSessionId, reason: f.reason }
          : { venueId: f.venueId, date: f.date, startTime: f.startTime, endTime: f.endTime, reason: f.reason },
      }),
    onSuccess: (r) => {
      setForm(null);
      qc.invalidateQueries({ queryKey: ['camera-requests'] });
      toast.success(`${r.reference} raised`, { description: r.email.status === 'SENT' ? `Emailed to ${r.email.to}` : `Queued for ${r.email.to} — set SMTP_URL to deliver it` });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVED' | 'DENIED' }) => api(`/api/camera-requests/${id}/decide`, { method: 'POST', body: { decision } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['camera-requests'] });
      toast.success('Recorded');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (list.isPending) return <div className="space-y-3"><Skeleton className="h-8 w-80" /><Skeleton className="h-64 w-full" /></div>;
  if (list.isError) return <Alert variant="destructive"><AlertDescription>{(list.error as Error).message}</AlertDescription></Alert>;

  const d = list.data;
  const examItems = Object.fromEntries((exams.data ?? []).map((e) => [e.id, `${e.title} · ${e.date.slice(0, 10)} ${e.startTime}`]));
  const venueItems = Object.fromEntries((venues.data ?? []).map((v) => [v.id, `${v.name} · ${v.building}`]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Camera access</h1>
          <p className="text-sm text-muted-foreground">
            Requests to IT support for a recorded view of a room, for the length of one exam or class. Only the RTE admin can raise one, and every request is emailed and kept on the record.
          </p>
        </div>
        {can('camera.request') ? <Button onClick={() => setForm(EMPTY)}><Video className="mr-1 h-4 w-4" /> New request</Button> : null}
      </div>

      <Alert className="rounded-none">
        {d.mailerConfigured ? <Mail className="h-4 w-4" /> : <MailWarning className="h-4 w-4" />}
        <AlertDescription>
          Requests go to <span className="font-medium">{d.itSupportEmail}</span>.{' '}
          {d.mailerConfigured
            ? 'Mail delivery is configured, so each request is sent as it is raised.'
            : 'No mail server is configured (SMTP_URL is empty), so messages are written to the outbox and marked queued rather than being silently dropped.'}
        </AlertDescription>
      </Alert>

      <Card className="rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Requests</CardTitle>
          <CardDescription>{d.items.length} on record</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>When</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.venue.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.date.slice(0, 10)} {r.startTime}–{r.endTime}</TableCell>
                  <TableCell className="max-w-[16rem] truncate">
                    {r.examSession ? r.examSession.title : r.slot ? `${r.slot.moduleOffering.module.code} section ${r.slot.section.name}` : '—'}
                  </TableCell>
                  <TableCell className="max-w-[18rem] truncate text-muted-foreground" title={r.reason}>{r.reason}</TableCell>
                  <TableCell>
                    <Badge className={`rounded-none ${STATUS_STYLE[r.status]}`}>{r.status}</Badge>
                    {r.notifiedAt ? <span className="ml-2 text-xs text-muted-foreground">emailed</span> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status === 'APPROVED' || r.status === 'DENIED' ? (
                      <span className="text-xs text-muted-foreground">{r.decidedAt?.slice(0, 10)}</span>
                    ) : can('camera.request') ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: 'APPROVED' })}>
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: 'DENIED' })}>
                          <XCircle className="mr-1 h-3.5 w-3.5" /> Deny
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {d.items.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No camera access has been requested.</TableCell></TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {can('users.manage') ? <Outbox /> : null}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Request camera access</DialogTitle>
            <DialogDescription>
              Pick the exam and the window is taken from it, so access can never be asked for longer than the sitting. Otherwise name a room and a time yourself.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Exam session</Label>
                <Select value={form.examSessionId} onValueChange={(v) => setForm({ ...form, examSessionId: v ?? '' })} items={examItems}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose an exam, or leave empty for a room and time" /></SelectTrigger>
                  <SelectContent>{Object.entries(examItems).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {!form.examSessionId && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <Label>Room</Label>
                    <Select value={form.venueId} onValueChange={(v) => setForm({ ...form, venueId: v ?? '' })} items={venueItems}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Choose a room" /></SelectTrigger>
                      <SelectContent>{Object.entries(venueItems).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>From</Label><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
                    <div className="space-y-1"><Label>To</Label><Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></div>
                  </div>
                </div>
              )}

              <ReasonField
                value={form.reason}
                onChange={(reason) => setForm({ ...form, reason })}
                label="Why is a camera needed?"
                placeholder="Invigilation cover is short for this hall and we need a recorded view of the back rows for the full sitting."
              />
              <p className="text-xs text-muted-foreground">
                This will be emailed to {d.itSupportEmail} with your name against it.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button
              disabled={!form || create.isPending || form.reason.trim().length < 10 || (!form.examSessionId && (!form.venueId || !form.date))}
              onClick={() => form && create.mutate(form)}
            >
              {create.isPending ? 'Sending…' : 'Send to IT support'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * What the system has actually sent. Kept visible because a request that quietly failed to leave
 * the building is worse than one that was never made — you would believe IT support had been told.
 */
function Outbox() {
  const q = useQuery({ queryKey: ['emails'], queryFn: () => api<EmailOutbox>('/api/emails?limit=20') });
  if (q.isPending || q.isError || !q.data.items.length) return null;
  return (
    <Card className="rounded-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Outbox</CardTitle>
        <CardDescription>Every message the system has sent, and whether it left the building</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Sent</TableHead><TableHead>To</TableHead><TableHead>Subject</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {q.data.items.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</TableCell>
                <TableCell className="whitespace-nowrap">{m.to}</TableCell>
                <TableCell className="max-w-[26rem] truncate" title={m.body}>{m.subject}</TableCell>
                <TableCell>
                  <Badge className={`rounded-none ${m.status === 'SENT' ? STATUS_STYLE.APPROVED : m.status === 'FAILED' ? STATUS_STYLE.DENIED : STATUS_STYLE.PENDING}`}>{m.status}</Badge>
                  {m.error ? <span className="ml-2 text-xs text-destructive">{m.error}</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
