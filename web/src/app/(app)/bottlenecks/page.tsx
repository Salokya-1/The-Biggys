'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Clock, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';

interface Bottleneck {
  kind: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  consequence: string;
  count: number;
  worstAgeDays: number | null;
  href: string;
  examples: string[];
}
interface Report {
  checkedAt: string;
  clear: boolean;
  high: number;
  bottlenecks: Bottleneck[];
}

const TONE: Record<Bottleneck['severity'], { badge: string; edge: string; label: string }> = {
  high: { badge: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200', edge: 'border-l-red-500', label: 'Acting now' },
  medium: { badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', edge: 'border-l-amber-500', label: 'This week' },
  low: { badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200', edge: 'border-l-sky-500', label: 'Watch' },
};

export default function BottlenecksPage() {
  const q = useQuery({ queryKey: ['bottlenecks'], queryFn: () => api<Report>('/api/bottlenecks'), refetchInterval: 120_000 });
  const d = q.data;

  return (
    <div className="space-y-4">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Where things are stuck</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The dashboard says how much there is. This says what is jammed and what it is costing — a sheet approved but never published is not a queue length, it is students who cannot see a result and awards that cannot be assessed.
        </p>
      </div>

      {q.isPending && <p className="text-sm text-muted-foreground">Checking…</p>}

      {d?.clear && (
        <Alert className="rounded-none">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>Nothing is holding anything up. Every mark sheet is moving, every exam has seats, no class is uncovered and nothing has been waiting for an answer.</AlertDescription>
        </Alert>
      )}

      {d && d.high > 0 && (
        <Alert variant="destructive" className="rounded-none">
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription>
            {d.high} {d.high === 1 ? 'blockage needs' : 'blockages need'} acting on now. Left alone these delay published results, which is what progression and scholarship decisions are read from.
          </AlertDescription>
        </Alert>
      )}

      {(d?.bottlenecks ?? []).map((b) => (
        <Card key={b.kind} className={`rounded-none border-l-4 ${TONE[b.severity].edge}`}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="text-base break-words">{b.title}</CardTitle>
                <CardDescription className="break-words">{b.detail}</CardDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {b.worstAgeDays !== null && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{b.worstAgeDays}d</span>
                )}
                <Badge variant="outline" className={`rounded-none border-transparent ${TONE[b.severity].badge}`}>{TONE[b.severity].label}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium">{b.consequence}</p>
            {b.examples.length > 0 && (
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {b.examples.map((e, i) => <li key={i} className="min-w-0 break-words">· {e}</li>)}
                {b.count > b.examples.length && <li className="text-xs">…and {b.count - b.examples.length} more</li>}
              </ul>
            )}
            <Link href={b.href} className="inline-flex items-center gap-1 text-sm font-medium underline">
              Go and clear it <ChevronRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>
      ))}

      {d && <p className="text-xs text-muted-foreground">Checked {new Date(d.checkedAt).toLocaleTimeString()}. Refreshes on its own every couple of minutes.</p>}
    </div>
  );
}
