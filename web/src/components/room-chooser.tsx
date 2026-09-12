'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DoorOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';

interface Room {
  id: string;
  name: string;
  building: string;
  isExamHall: boolean;
  seats: number;
}
interface FreeRooms {
  window: { date: string; startTime: string; endTime: string };
  candidates: number;
  capacity: number;
  shortfall: number;
  inUse: { id: string; name: string; seats: number }[];
  free: Room[];
  busy: { id: string; name: string; seats: number; why: string }[];
  suggestion: Room[];
  enough: boolean;
}

/**
 * "Capacity is insufficient" is a complaint, not an answer. This lists the rooms that are actually
 * free for that window — nothing holding another exam or a class — says how many seats each one
 * buys, and offers the smallest set that closes the gap.
 */
export function RoomChooser({ examId, canEdit }: { examId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const q = useQuery({ queryKey: ['exam-free-rooms', examId], queryFn: () => api<FreeRooms>(`/api/exams/${examId}/free-rooms`) });

  const add = useMutation({
    mutationFn: (ids: string[]) => api(`/api/exams/${examId}`, { method: 'PATCH', body: { venueIds: [...(q.data?.inUse.map((v) => v.id) ?? []), ...ids] } }),
    onSuccess: () => {
      setPicked(new Set());
      qc.invalidateQueries({ queryKey: ['exam', examId] });
      qc.invalidateQueries({ queryKey: ['exam-free-rooms', examId] });
      toast.success('Rooms added — generate seating again to fill them');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isPending || q.isError) return null;
  const d = q.data;
  const gained = d.free.filter((r) => picked.has(r.id)).reduce((n, r) => n + r.seats, 0);
  const stillShort = Math.max(0, d.shortfall - gained);

  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Card className="rounded-none border-destructive/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Choose more rooms</CardTitle>
        <CardDescription>
          {d.candidates} candidates, {d.capacity} seats across {d.inUse.length} room{d.inUse.length === 1 ? '' : 's'} — short by {d.shortfall}. These rooms are free on {d.window.date.slice(0, 10)} from {d.window.startTime} to {d.window.endTime}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {d.suggestion.length > 0 && picked.size === 0 ? (
          <Alert className="rounded-none">
            <DoorOpen className="h-4 w-4" />
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>
                {d.suggestion.map((r) => r.name).join(' and ')} would cover it (+{d.suggestion.reduce((n, r) => n + r.seats, 0)} seats).
              </span>
              {canEdit ? (
                <Button size="sm" variant="outline" onClick={() => setPicked(new Set(d.suggestion.map((r) => r.id)))}>
                  Select {d.suggestion.length === 1 ? 'it' : 'them'}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {d.free.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-3 border px-3 py-2 text-sm hover:bg-accent">
              <Checkbox checked={picked.has(r.id)} onCheckedChange={(c) => toggle(r.id, !!c)} disabled={!canEdit} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{r.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{r.building}</span>
              </span>
              {r.isExamHall ? <Badge variant="outline" className="rounded-none">exam hall</Badge> : null}
              <span className="tabular-nums text-muted-foreground">{r.seats} seats</span>
            </label>
          ))}
          {d.free.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Every room is taken in that window. Move the sitting, or split it across two times.</p> : null}
        </div>

        {d.busy.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Not offered because they are in use: {d.busy.slice(0, 6).map((b) => `${b.name} (${b.why})`).join(', ')}{d.busy.length > 6 ? ` and ${d.busy.length - 6} more` : ''}.
          </p>
        ) : null}

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={picked.size === 0 || add.isPending} onClick={() => add.mutate([...picked])}>
              {add.isPending ? 'Adding…' : `Add ${picked.size} room${picked.size === 1 ? '' : 's'} (+${gained} seats)`}
            </Button>
            <span className="text-sm text-muted-foreground">{picked.size === 0 ? 'Pick the rooms to add.' : stillShort === 0 ? 'That covers everyone.' : `Still ${stillShort} short.`}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
