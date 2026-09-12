'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BellRing, CheckCircle2, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface AtRisk {
  threshold: number;
  afterWeek: number;
  count: number;
  students: { id: string; studentId: string; name: string; programme: string; group: string | null; held: number; attended: number; percent: number }[];
}

export default function AttendancePage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [threshold, setThreshold] = useState(50);

  const q = useQuery({
    queryKey: ['at-risk', threshold],
    queryFn: () => api<AtRisk>(`/api/attendance/at-risk?threshold=${threshold}`),
  });

  const notify = useMutation({
    mutationFn: (ids: string[]) => api<{ notified: number }>('/api/attendance/at-risk/notify', { method: 'POST', body: { studentIds: ids } }),
    onSuccess: (r) => {
      toast.success(`Told ${r.notified} student${r.notified === 1 ? '' : 's'}`);
      void qc.invalidateQueries({ queryKey: ['at-risk'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data?.students ?? [];

  return (
    <div className="space-y-4">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone whose attendance has fallen below the line once enough of the term has run. Weeks are counted from each semester&apos;s own start, so a module that began late is not judged on a fortnight of data.
        </p>
      </div>

      <Card className="rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Below the line</CardTitle>
          <CardDescription>
            {q.data ? `Under ${q.data.threshold}% after week ${q.data.afterWeek}. ${q.data.count} student${q.data.count === 1 ? '' : 's'}.` : 'Loading…'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40 space-y-1">
              <Label htmlFor="thr">Threshold (%)</Label>
              <Input id="thr" type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(Math.min(100, Math.max(1, Number(e.target.value) || 50)))} />
            </div>
            {can('attendance.write') && rows.length > 0 && (
              <Button size="sm" disabled={notify.isPending} onClick={() => notify.mutate(rows.map((r) => r.id))}>
                <BellRing className="mr-1 h-4 w-4" />
                {notify.isPending ? 'Sending…' : `Tell all ${rows.length}`}
              </Button>
            )}
          </div>

          {q.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!q.isPending && rows.length === 0 && (
            <Alert className="rounded-none">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Nobody is below {threshold}% yet. Either attendance is holding up, or no registers have been taken far enough into a semester to judge.
              </AlertDescription>
            </Alert>
          )}

          {rows.length > 0 && (
            <div className="overflow-x-auto border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Programme</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead className="text-right">Attended</TableHead>
                    <TableHead className="text-right">Held</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="max-w-[16rem] truncate">
                        <span className="font-medium">{s.name}</span>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">{s.studentId}</span>
                      </TableCell>
                      <TableCell>{s.programme}</TableCell>
                      <TableCell>{s.group ?? '—'}</TableCell>
                      <TableCell className="text-right font-mono">{s.attended}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{s.held}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={`rounded-none border-transparent ${s.percent < 30 ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'}`}>
                          {s.percent}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {can('attendance.write') && (
                          <Button size="xs" variant="outline" onClick={() => notify.mutate([s.id])}><UserX className="mr-1 h-3 w-3" /> Tell them</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
