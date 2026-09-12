'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarOff, Plus, Search, Trash2 } from 'lucide-react';
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
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import type { TeacherOverview } from '@/lib/types';

const DAYS = [
  { value: 7, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
];

export default function TeachersPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [block, setBlock] = useState<{ teacherId: string; name: string; dayOfWeek: number; startTime: string; endTime: string; reason: string } | null>(null);

  const list = useQuery({ queryKey: ['teachers-overview', q], queryFn: () => api<TeacherOverview[]>(`/api/teachers/overview${qs({ q: q || undefined })}`) });

  const addBlock = useMutation({
    mutationFn: (b: NonNullable<typeof block>) =>
      api<{ affectedClasses: string[] }>(`/api/teachers/${b.teacherId}/unavailability`, { method: 'POST', body: { dayOfWeek: b.dayOfWeek, startTime: b.startTime, endTime: b.endTime, reason: b.reason || undefined } }),
    onSuccess: (r) => {
      setBlock(null);
      qc.invalidateQueries({ queryKey: ['teachers-overview'] });
      toast.success('Unavailable hours recorded', {
        description: r.affectedClasses.length ? `${r.affectedClasses.length} class(es) already sit in that window: ${r.affectedClasses.join(', ')}. Regenerate or move them.` : 'The generator will work around it.',
        duration: r.affectedClasses.length ? 10000 : 4000,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeBlock = useMutation({
    mutationFn: (id: string) => api(`/api/teachers/unavailability/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teachers-overview'] });
      toast.success('Removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totals = useMemo(() => {
    const rows = list.data ?? [];
    return {
      staff: rows.length,
      teaching: rows.filter((r) => r.classCount > 0).length,
      hours: Math.round(rows.reduce((n, r) => n + r.contactHours, 0) * 10) / 10,
      blocked: rows.filter((r) => r.blocked.length > 0).length,
    };
  }, [list.data]);

  if (list.isPending) return <div className="space-y-3"><Skeleton className="h-8 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (list.isError) return <Alert variant="destructive"><AlertDescription>{(list.error as Error).message}</AlertDescription></Alert>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Teachers</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Everyone who stands in front of a class, what they carry, and the hours they cannot be given one. Part-time staff and standing commitments are recorded here, and the generator works around them.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Teaching staff', value: totals.staff },
          { label: 'With classes', value: totals.teaching },
          { label: 'Contact hours a week', value: totals.hours },
          { label: 'With blocked hours', value: totals.blocked },
        ].map((s) => (
          <Card key={s.label} className="rounded-none">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a teacher by name" />
      </div>

      <Card className="rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Who teaches what</CardTitle>
          <CardDescription>Click a row to see the week they actually work</CardDescription>
        </CardHeader>
        <CardContent className="max-h-[calc(100dvh-26rem)] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Teacher</TableHead>
                <TableHead>Modules</TableHead>
                <TableHead className="text-right">Classes</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Unavailable</TableHead>
                <TableHead className="sticky right-0 bg-card text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data ?? []).map((t) => (
                <>
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => setOpen(open === t.id ? null : t.id)}>
                    <TableCell>
                      <span className="font-medium">{t.name}</span>
                      <span className="block text-xs text-muted-foreground">{t.role === 'MODULE_LEADER' ? 'Module leader' : 'Lecturer'}{t.leads.length ? ` · leads ${t.leads.join(', ')}` : ''}</span>
                    </TableCell>
                    <TableCell className="max-w-[16rem] whitespace-normal text-sm">{t.modules.join(', ') || <span className="text-muted-foreground">none</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.classCount}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', t.contactHours > 20 && 'font-semibold text-brand-orange')}>{t.contactHours}</TableCell>
                    <TableCell className="text-xs">{t.daysUsed.length}/6</TableCell>
                    <TableCell className="text-xs">
                      {t.blocked.length === 0 ? <span className="text-muted-foreground">—</span> : t.blocked.map((b) => `${b.day.slice(0, 3)} ${b.startTime}–${b.endTime}`).join(', ')}
                    </TableCell>
                    <TableCell className="sticky right-0 bg-card text-right">
                      {can('timetable.write') ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBlock({ teacherId: t.id, name: t.name, dayOfWeek: 7, startTime: '09:00', endTime: '12:00', reason: '' });
                          }}
                        >
                          <CalendarOff className="mr-1 h-3.5 w-3.5" /> Block hours
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                  {open === t.id ? (
                    <TableRow key={`${t.id}-detail`}>
                      <TableCell colSpan={7} className="bg-muted/30">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <p className="mb-1 text-sm font-medium">Weekly classes</p>
                            {t.classes.length === 0 ? (
                              <p className="text-sm text-muted-foreground">Nothing timetabled.</p>
                            ) : (
                              <ul className="space-y-1 text-sm">
                                {t.classes.map((c) => (
                                  <li key={c.id}>
                                    <span className="tabular-nums text-muted-foreground">{c.day.slice(0, 3)} {c.startTime}–{c.endTime}</span>{' '}
                                    <Badge variant="outline" className="rounded-none">{c.kindLabel}</Badge>{' '}
                                    {c.module.code} · {c.groups.join('+')} {c.venue ? `· ${c.venue}` : ''}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <p className="mb-1 text-sm font-medium">Unavailable hours</p>
                            {t.blocked.length === 0 ? (
                              <p className="text-sm text-muted-foreground">None recorded — assumed free all week.</p>
                            ) : (
                              <ul className="space-y-1 text-sm">
                                {t.blocked.map((b) => (
                                  <li key={b.id} className="flex items-center gap-2">
                                    <span className="tabular-nums">{b.day} {b.startTime}–{b.endTime}</span>
                                    {b.reason ? <span className="text-muted-foreground">· {b.reason}</span> : null}
                                    {can('timetable.write') ? (
                                      <Button size="xs" variant="ghost" onClick={() => removeBlock.mutate(b.id)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {t.invigilations.length > 0 ? (
                              <p className="mt-2 text-xs text-muted-foreground">Invigilating {t.invigilations.length} exam{t.invigilations.length === 1 ? '' : 's'}.</p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </>
              ))}
              {(list.data ?? []).length === 0 ? <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No teacher matches “{q}”.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!block} onOpenChange={(o) => !o && setBlock(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hours {block?.name} cannot teach</DialogTitle>
            <DialogDescription>The generator will not place a class in this window. Existing classes are not moved, but you will be told which ones now sit inside it.</DialogDescription>
          </DialogHeader>
          {block && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Day</Label>
                <Select value={String(block.dayOfWeek)} onValueChange={(v) => setBlock({ ...block, dayOfWeek: Number(v ?? 7) })} items={Object.fromEntries(DAYS.map((d) => [String(d.value), d.label]))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{DAYS.map((d) => <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label>From</Label><Input type="time" value={block.startTime} onChange={(e) => setBlock({ ...block, startTime: e.target.value })} /></div>
                <div className="space-y-1"><Label>To</Label><Input type="time" value={block.endTime} onChange={(e) => setBlock({ ...block, endTime: e.target.value })} /></div>
              </div>
              <div className="space-y-1">
                <Label>Reason (optional)</Label>
                <Input value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} placeholder="Part-time — industry work" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlock(null)}>Cancel</Button>
            <Button disabled={!block || addBlock.isPending} onClick={() => block && addBlock.mutate(block)}><Plus className="mr-1 h-4 w-4" /> {addBlock.isPending ? 'Saving…' : 'Block these hours'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
