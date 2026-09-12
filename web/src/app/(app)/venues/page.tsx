'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SeatGrid } from '@/components/seat-grid';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Venue } from '@/lib/types';

const ADJ = { ROW: 'Left / right only', ROW_AND_COLUMN: 'Left / right + front / back' };
type Form = { id?: string; name: string; building: string; rows: number; cols: number; adjacencyMode: 'ROW' | 'ROW_AND_COLUMN'; disabled: string };
const empty: Form = { name: '', building: '', rows: 8, cols: 10, adjacencyMode: 'ROW', disabled: '' };

function parseDisabled(text: string) {
  return text
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const [r, c] = t.split(':').map(Number);
      return { row: r, col: c };
    })
    .filter((s) => Number.isInteger(s.row) && Number.isInteger(s.col));
}

export default function VenuesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const venues = useQuery({ queryKey: ['venues'], queryFn: () => api<Venue[]>('/api/venues') });
  const [form, setForm] = useState<Form | null>(null);

  const save = useMutation({
    mutationFn: (f: Form) => {
      const body = { name: f.name, building: f.building, rows: Number(f.rows), cols: Number(f.cols), adjacencyMode: f.adjacencyMode, disabledSeats: parseDisabled(f.disabled) };
      return f.id ? api(`/api/venues/${f.id}`, { method: 'PATCH', body }) : api('/api/venues', { method: 'POST', body });
    },
    onSuccess: () => {
      toast.success('Venue saved');
      setForm(null);
      void qc.invalidateQueries({ queryKey: ['venues'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Venues</h1>
          <p className="text-sm text-muted-foreground">Room grids used by the seating engine. Mark broken or missing seats as unavailable.</p>
        </div>
        {user?.role === 'ADMIN' && <Button size="sm" onClick={() => setForm(empty)}><Plus className="mr-1 h-4 w-4" /> New venue</Button>}
      </div>

      {venues.isPending && <Skeleton className="h-40 w-full" />}
      <div className="grid gap-4 lg:grid-cols-2">
        {venues.data?.map((v) => (
          <Card key={v.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{v.name} <span className="font-normal text-muted-foreground">· {v.building}</span></CardTitle>
                  <CardDescription>{v.rows} rows × {v.cols} cols · capacity {v.capacity} · {ADJ[v.adjacencyMode]} · used in {v._count?.examSessions ?? 0} session{(v._count?.examSessions ?? 0) === 1 ? '' : 's'}</CardDescription>
                </div>
                {user?.role === 'ADMIN' && (
                  <Button size="sm" variant="outline" onClick={() => setForm({ id: v.id, name: v.name, building: v.building, rows: v.rows, cols: v.cols, adjacencyMode: v.adjacencyMode, disabled: v.disabledSeats.map((s) => `${s.row}:${s.col}`).join(', ') })}>Edit</Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <SeatGrid rows={v.rows} cols={v.cols} disabledSeats={v.disabledSeats} seats={[]} modules={[]} compact />
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? 'Edit venue' : 'New venue'}</DialogTitle>
            <DialogDescription>Rows run front to back; columns left to right. Unavailable seats as row:col, e.g. <code>1:10, 8:1</code>.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-1"><Label>Building</Label><Input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} /></div>
              <div className="space-y-1"><Label>Rows</Label><Input type="number" min={1} max={60} value={form.rows} onChange={(e) => setForm({ ...form, rows: Number(e.target.value) })} /></div>
              <div className="space-y-1"><Label>Columns</Label><Input type="number" min={1} max={60} value={form.cols} onChange={(e) => setForm({ ...form, cols: Number(e.target.value) })} /></div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Separation rule</Label>
                <Select value={form.adjacencyMode} onValueChange={(v) => setForm({ ...form, adjacencyMode: (v ?? 'ROW') as Form['adjacencyMode'] })} items={ADJ}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(ADJ).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2"><Label>Unavailable seats</Label><Input value={form.disabled} onChange={(e) => setForm({ ...form, disabled: e.target.value })} placeholder="1:10, 8:1" /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button disabled={!form?.name || !form?.building || save.isPending} onClick={() => form && save.mutate(form)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
