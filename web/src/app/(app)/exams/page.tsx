'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ExamSessionListItem, Venue } from '@/lib/types';

interface Offering {
  id: string;
  module: { code: string; title: string };
  semester: { number: number; intake: { label: string; programme: { code: string } } };
  _count: { enrollments: number };
}

export default function ExamsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const exams = useQuery({ queryKey: ['exams'], queryFn: () => api<ExamSessionListItem[]>('/api/exams') });
  const [open, setOpen] = useState(false);
  const offerings = useQuery({ queryKey: ['offerings'], queryFn: () => api<Offering[]>('/api/offerings'), enabled: open });
  const venues = useQuery({ queryKey: ['venues'], queryFn: () => api<Venue[]>('/api/venues'), enabled: open });
  const [form, setForm] = useState({ title: '', date: '', startTime: '09:00', durationMin: 120, seed: 1, offeringIds: [] as string[], venueIds: [] as string[] });

  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/api/exams', { method: 'POST', body: { ...form, durationMin: Number(form.durationMin), seed: Number(form.seed) } }),
    onSuccess: () => {
      toast.success('Exam session created');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['exams'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const toggle = (key: 'offeringIds' | 'venueIds', id: string, on: boolean) =>
    setForm((f) => ({ ...f, [key]: on ? [...f[key], id] : f[key].filter((x) => x !== id) }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Exam sessions</h1>
          <p className="text-sm text-muted-foreground">Sessions group module offerings sitting together. Generate seating per session; print sheets and door lists per venue.</p>
        </div>
        {user?.role === 'ADMIN' && (
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> New session</Button>
        )}
      </div>

      {exams.isError && <Alert variant="destructive"><AlertDescription>{(exams.error as Error).message}</AlertDescription></Alert>}

      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Session</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Modules</TableHead>
              <TableHead>Venues</TableHead>
              <TableHead className="text-right">Candidates</TableHead>
              <TableHead className="text-right">Capacity</TableHead>
              <TableHead>Seating</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {exams.isPending && Array.from({ length: 3 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>)}
            {exams.data?.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No exam sessions yet.</TableCell></TableRow>}
            {exams.data?.map((e) => (
              <TableRow key={e.id}>
                <TableCell><Link href={`/exams/${e.id}`} className="font-medium hover:underline">{e.title}</Link></TableCell>
                <TableCell className="text-sm">{new Date(e.date).toLocaleDateString()} {e.startTime} · {e.durationMin} min</TableCell>
                <TableCell className="text-xs">{e.offerings.map((o) => o.module.code).join(', ')}</TableCell>
                <TableCell className="text-xs">{e.venues.map((v) => v.name).join(', ')}</TableCell>
                <TableCell className="text-right">{e.candidates}</TableCell>
                <TableCell className="text-right">{e.capacity}</TableCell>
                <TableCell>
                  {e.seated > 0 ? (
                    <Badge variant="outline" className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">{e.seated} seated</Badge>
                  ) : e.candidates > e.capacity ? (
                    <Badge variant="outline" className="border-transparent bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">Over capacity</Badge>
                  ) : (
                    <Badge variant="outline" className="border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Pending</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New exam session</DialogTitle>
            <DialogDescription>Pick the module offerings sitting together and the venues available. Seating is generated afterwards.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2"><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Semester 2 Exams — Databases & Marketing" /></div>
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div className="space-y-1"><Label>Start time</Label><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
            <div className="space-y-1"><Label>Duration (min)</Label><Input type="number" min={15} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })} /></div>
            <div className="space-y-1"><Label>Seed (reproducibility)</Label><Input type="number" min={1} value={form.seed} onChange={(e) => setForm({ ...form, seed: Number(e.target.value) })} /></div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Module offerings</Label>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
                {offerings.data?.map((o) => (
                  <label key={o.id} className="flex items-center gap-2">
                    <Checkbox checked={form.offeringIds.includes(o.id)} onCheckedChange={(c) => toggle('offeringIds', o.id, !!c)} />
                    <span>{o.module.code} · {o.module.title} — {o.semester.intake.programme.code} {o.semester.intake.label} Sem {o.semester.number} ({o._count.enrollments})</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Venues</Label>
              <div className="space-y-1 rounded-md border p-2 text-sm">
                {venues.data?.map((v) => (
                  <label key={v.id} className="flex items-center gap-2">
                    <Checkbox checked={form.venueIds.includes(v.id)} onCheckedChange={(c) => toggle('venueIds', v.id, !!c)} />
                    <span>{v.name} ({v.building}) — {v.rows}×{v.cols}, capacity {v.capacity}, {v.adjacencyMode === 'ROW' ? 'left/right' : 'left/right + front/back'} separation</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={create.isPending || !form.title || !form.date || form.offeringIds.length === 0 || form.venueIds.length === 0} onClick={() => create.mutate()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
