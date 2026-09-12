'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

interface Register {
  slot: { id: string; startTime: string; endTime: string; kind: string };
  module: { code: string; title: string };
  date: string;
  marked: boolean;
  students: { id: string; studentId: string; name: string; group: string | null; status: Status | null }[];
}

const CYCLE: Status[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
const LABEL: Record<Status, string> = { PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', EXCUSED: 'Excused' };
const STYLE: Record<Status, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  ABSENT: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  LATE: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  EXCUSED: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
};

/**
 * Take the register for one class on one day.
 *
 * Everybody starts present, because in a room of twenty that is nineteen taps saved; tapping a
 * name cycles it. A register submitted twice replaces the first, since they get corrected far more
 * often than they get filed once and nobody should have to delete one to fix a name.
 */
export function TakeRegister({ slotId, date, onDone }: { slotId: string; date: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState<Record<string, Status>>({});

  const q = useQuery({
    queryKey: ['register', slotId, date],
    queryFn: () => api<Register>(`/api/timetable/slots/${slotId}/register?date=${date}`),
    enabled: open,
  });

  const statusOf = (id: string, fallback: Status | null): Status => marks[id] ?? fallback ?? 'PRESENT';

  const save = useMutation({
    mutationFn: () =>
      api<{ marked: number }>(`/api/timetable/slots/${slotId}/register`, {
        method: 'POST',
        body: {
          date,
          entries: (q.data?.students ?? []).map((s) => ({ studentId: s.id, status: statusOf(s.id, s.status) })),
        },
      }),
    onSuccess: (r) => {
      toast.success(`Register taken for ${r.marked} students`);
      setOpen(false);
      setMarks({});
      void qc.invalidateQueries({ queryKey: ['at-risk'] });
      void qc.invalidateQueries({ queryKey: ['attendance'] });
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const students = q.data?.students ?? [];
  const absent = students.filter((s) => statusOf(s.id, s.status) === 'ABSENT').length;

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}><ClipboardList className="mr-1 h-3 w-3" /> Register</Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{q.data ? `${q.data.module.code} register` : 'Register'}</DialogTitle>
            <DialogDescription>
              {q.data
                ? `${new Date(date).toLocaleDateString()} ${q.data.slot.startTime}–${q.data.slot.endTime}. Everyone starts present — tap a name to change it.`
                : 'Loading the class list…'}
            </DialogDescription>
          </DialogHeader>

          {q.data?.marked && <p className="text-sm text-muted-foreground">This register has already been taken. Saving replaces it.</p>}

          <div className="max-h-[50dvh] space-y-1 overflow-y-auto border p-2">
            {students.length === 0 && !q.isPending && <p className="p-2 text-sm text-muted-foreground">Nobody is in this class.</p>}
            {students.map((s) => {
              const st = statusOf(s.id, s.status);
              return (
                <button
                  key={s.id}
                  className="flex w-full min-w-0 items-center justify-between gap-2 border px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => setMarks((p) => ({ ...p, [s.id]: CYCLE[(CYCLE.indexOf(st) + 1) % CYCLE.length] }))}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs text-muted-foreground">{s.studentId}</span> {s.name}
                    {s.group ? <span className="ml-1 text-xs text-muted-foreground">{s.group}</span> : null}
                  </span>
                  <span className={cn('shrink-0 px-2 py-0.5 text-xs font-medium', STYLE[st])}>{LABEL[st]}</span>
                </button>
              );
            })}
          </div>

          <p className="text-sm text-muted-foreground">{students.length - absent} present · {absent} absent</p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={students.length === 0 || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save register'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
