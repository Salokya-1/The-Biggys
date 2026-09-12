'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Merge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';

interface Candidate {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  groups: string[];
  teacher: string;
  venue: string | null;
  headcount: number;
  course: string | null;
  sameCourse: boolean;
}
interface Combinable {
  slot: Omit<Candidate, 'headcount' | 'sameCourse'>;
  kind: string;
  module: { code: string; title: string };
  currentHeadcount: number;
  candidates: Candidate[];
  rooms: { id: string; name: string; building: string; seats: number }[];
}

/**
 * Merge groups being taught the same thing separately into one class.
 *
 * Five groups, five rooms and five hours of a lecturer's week for one lecture is the waste this
 * removes. Everybody keeps their place in the timetable; the room is booked once.
 */
export function CombineClasses({ slotId, onDone }: { slotId: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [venueId, setVenueId] = useState('');

  const q = useQuery({ queryKey: ['combinable', slotId], queryFn: () => api<Combinable>(`/api/timetable/slots/${slotId}/combinable`), enabled: open });

  const combine = useMutation({
    mutationFn: () => api(`/api/timetable/slots/combine`, { method: 'POST', body: { slotIds: [slotId, ...picked], venueId: venueId || undefined } }),
    onSuccess: () => {
      setOpen(false);
      setPicked(new Set());
      void qc.invalidateQueries({ queryKey: ['tt'] });
      toast.success('Classes combined into one');
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = q.data;
  const total = (d?.currentHeadcount ?? 0) + (d?.candidates ?? []).filter((c) => picked.has(c.id)).reduce((n, c) => n + c.headcount, 0);
  const room = d?.rooms.find((r) => r.id === venueId);
  const tooSmall = room ? room.seats < total : false;

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}><Merge className="mr-1 h-3 w-3" /> Combine</Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Combine {d ? `${d.module.code} classes` : 'classes'}</DialogTitle>
            <DialogDescription>
              The groups you tick join this class. Everyone ends up in one room at one time, so pick a room that holds them all. The other bookings are released. Another course taking the same module can join; a different module cannot.
            </DialogDescription>
          </DialogHeader>

          {q.isPending ? <p className="text-sm text-muted-foreground">Looking for classes that could join…</p> : null}
          {d && d.candidates.length === 0 ? (
            <Alert className="rounded-none"><AlertDescription>No other {d.kind.toLowerCase()} of {d.module.code} is timetabled, so there is nothing to combine with.</AlertDescription></Alert>
          ) : null}

          {d && d.candidates.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm">
                Keeping <span className="font-medium">{d.slot.groups.join('+')}</span> on {d.slot.day} {d.slot.startTime}–{d.slot.endTime}
                <span className="text-muted-foreground"> · {d.currentHeadcount} students</span>
              </p>
              <div className="max-h-56 space-y-1 overflow-y-auto border p-2">
                {d.candidates.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-3 px-1 py-1 text-sm hover:bg-accent">
                    <Checkbox
                      checked={picked.has(c.id)}
                      onCheckedChange={(on) =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (on) next.add(c.id);
                          else next.delete(c.id);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{c.groups.join('+')}</span>
                      {!c.sameCourse && c.course ? (
                        <span className="ml-2 rounded border px-1 py-0.5 text-[11px] text-muted-foreground">{c.course}</span>
                      ) : null}
                      <span className="ml-2 text-muted-foreground">{c.day} {c.startTime}–{c.endTime}{c.venue ? ` · ${c.venue}` : ''} · {c.teacher}</span>
                    </span>
                    <span className="tabular-nums text-muted-foreground">{c.headcount}</span>
                  </label>
                ))}
              </div>

              <div className="space-y-1">
                <Label>Room for the combined class</Label>
                <Select value={venueId} onValueChange={(v) => setVenueId(v ?? '')} items={Object.fromEntries(d.rooms.map((r) => [r.id, `${r.name} — ${r.seats} seats`]))}>
                  <SelectTrigger className="w-full"><SelectValue placeholder={d.slot.venue ? `Keep ${d.slot.venue}` : 'Choose a room'} /></SelectTrigger>
                  <SelectContent>{d.rooms.map((r) => <SelectItem key={r.id} value={r.id}>{r.name} ({r.building}) — {r.seats} seats</SelectItem>)}</SelectContent>
                </Select>
              </div>

              <p className={`text-sm ${tooSmall ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                {total} students in one room{room ? ` · ${room.name} seats ${room.seats}` : ''}
                {tooSmall ? ' — too small, pick a bigger one.' : ''}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={picked.size === 0 || tooSmall || combine.isPending} onClick={() => combine.mutate()}>
              {combine.isPending ? 'Combining…' : `Combine ${picked.size + 1} classes`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
