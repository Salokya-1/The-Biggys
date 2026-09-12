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
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SeatGrid } from '@/components/seat-grid';
import { RoomDesigner } from '@/components/room-designer';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CellKind, RoomLayout, Venue } from '@/lib/types';

const ADJ = { ROW: 'Left / right only', ROW_AND_COLUMN: 'Left / right + front / back' };
type Form = { id?: string; name: string; building: string; rows: number; cols: number; adjacencyMode: 'ROW' | 'ROW_AND_COLUMN'; isClassroom: boolean; layout: RoomLayout };
const empty: Form = { name: '', building: '', rows: 5, cols: 6, adjacencyMode: 'ROW', isClassroom: true, layout: { cells: {}, labelMode: 'ROW_LETTER' } };

/** Disabled seats derived from the drawing, so the preview matches what the API will store. */
const offCells = (layout: RoomLayout, rows: number, cols: number) => {
  const out: { row: number; col: number }[] = [];
  for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) if ((layout.cells?.[`${r}:${c}`] as CellKind | undefined) && layout.cells![`${r}:${c}`] !== 'DESK') out.push({ row: r, col: c });
  return out;
};

export default function VenuesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const venues = useQuery({ queryKey: ['venues'], queryFn: () => api<Venue[]>('/api/venues') });
  const [form, setForm] = useState<Form | null>(null);
  const editable = can('venue.write');

  const save = useMutation({
    mutationFn: (f: Form) => {
      const body = {
        name: f.name,
        building: f.building,
        rows: Number(f.rows),
        cols: Number(f.cols),
        adjacencyMode: f.adjacencyMode,
        isClassroom: f.isClassroom,
        layout: f.layout.cells && Object.keys(f.layout.cells).length ? f.layout : null,
        disabledSeats: [],
      };
      return f.id ? api(`/api/venues/${f.id}`, { method: 'PATCH', body }) : api('/api/venues', { method: 'POST', body });
    },
    onSuccess: () => {
      toast.success('Room saved');
      setForm(null);
      void qc.invalidateQueries({ queryKey: ['venues'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rooms & halls</h1>
          <p className="text-sm text-muted-foreground">Draw each room the way it really is: desks, aisles, broken seats and where the invigilator stands. Seating and class capacity follow the drawing.</p>
        </div>
        {editable && <Button size="sm" onClick={() => setForm(empty)}><Plus className="mr-1 h-4 w-4" /> New room</Button>}
      </div>

      {venues.isPending && <Skeleton className="h-40 w-full" />}
      <div className="grid gap-4 lg:grid-cols-2">
        {venues.data?.map((v) => (
          <Card key={v.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{v.name} <span className="font-normal text-muted-foreground">· {v.building}</span></CardTitle>
                  <CardDescription>
                    {v.rows} × {v.cols} · capacity {v.capacity} · {ADJ[v.adjacencyMode]} · {v.isClassroom ? 'classroom' : 'exam hall'} · used in {v._count?.examSessions ?? 0} session{(v._count?.examSessions ?? 0) === 1 ? '' : 's'}
                  </CardDescription>
                </div>
                {editable && (
                  <Button size="sm" variant="outline" onClick={() => setForm({ id: v.id, name: v.name, building: v.building, rows: v.rows, cols: v.cols, adjacencyMode: v.adjacencyMode, isClassroom: v.isClassroom, layout: (v.layout as RoomLayout | null) ?? { cells: Object.fromEntries(v.disabledSeats.map((s) => [`${s.row}:${s.col}`, 'OFF' as CellKind])), labelMode: 'ROW_LETTER' } })}>
                    Edit layout
                  </Button>
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
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? `Edit ${form.name}` : 'New room'}</DialogTitle>
            <DialogDescription>Pick a tool, then click or drag across the grid to draw the room. Only cells left as desks can be seated.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="LB-104" /></div>
                <div className="space-y-1"><Label>Building</Label><Input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} placeholder="London Block" /></div>
                <div className="space-y-1">
                  <Label>Exam separation rule</Label>
                  <Select value={form.adjacencyMode} onValueChange={(v) => setForm({ ...form, adjacencyMode: (v ?? 'ROW') as Form['adjacencyMode'] })} items={ADJ}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(ADJ).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <label className="mt-6 flex items-center gap-2 text-sm">
                  <Checkbox checked={form.isClassroom} onCheckedChange={(c) => setForm({ ...form, isClassroom: !!c })} />
                  Usable as a classroom in the weekly routine
                </label>
              </div>
              <RoomDesigner
                rows={form.rows}
                cols={form.cols}
                layout={form.layout}
                onChange={(layout) => setForm({ ...form, layout })}
                onSize={(rows, cols) => setForm({ ...form, rows, cols })}
              />
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Exam preview (blocked cells are not seated)</div>
                <SeatGrid rows={form.rows} cols={form.cols} disabledSeats={offCells(form.layout, form.rows, form.cols)} seats={[]} modules={[]} compact />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button disabled={!form?.name || !form?.building || save.isPending} onClick={() => form && save.mutate(form)}>{save.isPending ? 'Saving…' : 'Save room'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
