'use client';

import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';

interface Attendance {
  overall: number | null;
  held: number;
  attended: number;
  threshold: number;
  modules: { offeringId: string; code: string; title: string; held: number; attended: number; percent: number | null }[];
}

/** How to colour a rate: red well under the line, amber near it, plain above. */
function tone(percent: number | null, threshold: number) {
  if (percent === null) return 'bg-muted text-muted-foreground';
  if (percent < threshold * 0.6) return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200';
  if (percent < threshold) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';
  return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200';
}

/** One student's attendance, module by module, with the shortfall said out loud. */
export function AttendanceCard({ studentId }: { studentId: string }) {
  const q = useQuery({ queryKey: ['attendance', studentId], queryFn: () => api<Attendance>(`/api/students/${studentId}/attendance`) });
  const d = q.data;

  return (
    <Card className="rounded-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Attendance</CardTitle>
        <CardDescription>
          {d && d.held > 0 ? `${d.attended} of ${d.held} classes attended.` : 'No registers have been taken yet.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {q.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}

        {d && d.overall !== null && d.overall < d.threshold && (
          <Alert variant="destructive" className="rounded-none">
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>
              {d.overall}% overall, below the {d.threshold}% required. Progression is at risk while it stays here.
            </AlertDescription>
          </Alert>
        )}

        {d && d.held > 0 && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold tabular-nums">{d.overall}%</span>
              <span className="text-sm text-muted-foreground">overall</span>
            </div>
            <div className="space-y-1">
              {d.modules.map((m) => (
                <div key={m.offeringId} className="flex items-center justify-between gap-2 border p-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs">{m.code}</span> <span className="text-muted-foreground">{m.title}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">{m.attended}/{m.held}</span>
                    <Badge variant="outline" className={`rounded-none border-transparent ${tone(m.percent, d.threshold)}`}>{m.percent ?? '—'}%</Badge>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
