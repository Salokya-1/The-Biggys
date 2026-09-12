'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileDown, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { MODULE_PALETTE, SeatGrid } from '@/components/seat-grid';
import { RoomChooser } from '@/components/room-chooser';
import { api, downloadWithAuth } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import type { ExamDetail } from '@/lib/types';

export default function ExamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['exam', id], queryFn: () => api<ExamDetail>(`/api/exams/${id}`) });
  const [seed, setSeed] = useState<number | ''>('');
  const [lookup, setLookup] = useState('');
  const [found, setFound] = useState<{ venueId: string; row: number; col: number; seatLabel: string; venueName: string; name: string } | null>(null);

  const generate = useMutation({
    mutationFn: () => api<{ seated: number; unseated: unknown[]; violations: unknown[] }>(`/api/exams/${id}/seating/generate`, { method: 'POST', body: seed ? { seed: Number(seed) } : {} }),
    onSuccess: (r) => {
      toast.success(`Seated ${r.seated} students · ${r.unseated.length} unseated · ${r.violations.length} clashes`);
      setFound(null);
      void qc.invalidateQueries({ queryKey: ['exam', id] });
      void qc.invalidateQueries({ queryKey: ['exams'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Generation failed'),
  });

  const doLookup = async () => {
    if (!lookup.trim()) return;
    try {
      const a = await api<{ venueId: string; row: number; col: number; seatLabel: string; venue: { name: string }; student: { name: string } }>(`/api/exams/${id}/lookup?studentId=${encodeURIComponent(lookup.trim())}`);
      setFound({ venueId: a.venueId, row: a.row, col: a.col, seatLabel: a.seatLabel, venueName: a.venue.name, name: a.student.name });
    } catch (e) {
      setFound(null);
      toast.error(e instanceof Error ? e.message : 'Not found');
    }
  };

  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-8 w-96" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError) return <Alert variant="destructive"><AlertDescription>{(q.error as Error).message}</AlertDescription></Alert>;
  const d = q.data;
  const modules = d.session.offerings.map((o) => o.module.code);
  const violationSeats = new Set(d.violations.flatMap((v) => [`${v.venueId}:${v.seatA}`, `${v.venueId}:${v.seatB}`]));

  return (
    <div className="space-y-4">
      <Link href="/exams" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-4 w-4" /> Exam sessions</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{d.session.title}</h1>
          <p className="text-sm text-muted-foreground">{new Date(d.session.date).toLocaleDateString()} · {d.session.startTime} · {d.session.durationMin} min · {d.candidates} candidates · seed {d.session.seed}{d.session.kind ? ` · ${d.session.kind.replace('_', ' ').toLowerCase()}` : ''}{d.session.seatingMode === 'BY_ID' ? ' · seated by section in ascending ID order' : ''}</p>
          {(d.session.invigilators?.length || d.session.sections?.length) ? (
            <p className="text-xs text-muted-foreground">
              {d.session.sections?.length ? `Sections ${d.session.sections.map((s) => s.name).join(', ')} · ` : ''}
              {d.session.invigilators?.length ? `Invigilators: ${d.session.invigilators.map((i) => `${i.user.name} (${i.venue.name})`).join(', ')}` : 'No invigilators assigned'}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {modules.map((m, i) => <Badge key={m} variant="outline" className={cn('border-transparent', MODULE_PALETTE[i % MODULE_PALETTE.length])}>{m}</Badge>)}
            <Badge variant="outline">◆ special needs</Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d.generated && (
            <Button variant="outline" size="sm" onClick={() => downloadWithAuth(`/api/exams/${id}/seating.pdf`, `seating-${d.session.date.slice(0, 10)}.pdf`).catch((e) => toast.error(e.message))}>
              <FileDown className="mr-1 h-4 w-4" /> Seating sheets + door lists (PDF)
            </Button>
          )}
          {user?.role === 'ADMIN' && (
            <>
              <Input type="number" min={1} className="w-24" placeholder={`seed ${d.session.seed}`} value={seed} onChange={(e) => setSeed(e.target.value === '' ? '' : Number(e.target.value))} />
              <Button size="sm" disabled={generate.isPending} onClick={() => generate.mutate()}>
                <RefreshCw className={cn('mr-1 h-4 w-4', generate.isPending && 'animate-spin')} /> {d.generated ? 'Regenerate seating' : 'Generate seating'}
              </Button>
            </>
          )}
        </div>
      </div>

      {!d.generated && (
        <Alert>
          <AlertTitle>No seating yet</AlertTitle>
          <AlertDescription>Capacity {d.venues.reduce((n, v) => n + v.capacity, 0)} across {d.venues.length} venue{d.venues.length === 1 ? '' : 's'} for {d.candidates} candidates. {user?.role === 'ADMIN' ? 'Generate seating to allocate seats.' : 'Ask the RTE admin to generate seating.'}</AlertDescription>
        </Alert>
      )}
      {d.unseated.length > 0 && (
        <>
          <Alert variant="destructive">
            <AlertTitle>{d.unseated.length} student{d.unseated.length === 1 ? '' : 's'} could not be seated</AlertTitle>
            <AlertDescription>
              There are more candidates than seats. Pick more rooms below, then generate seating again.
              <details className="mt-2">
                <summary className="cursor-pointer text-xs underline-offset-4 hover:underline">Who is unseated ({d.unseated.length})</summary>
                <p className="mt-1 max-h-40 overflow-y-auto text-xs">{d.unseated.map((u) => `${u.label} (${u.moduleCode})`).join(', ')}</p>
              </details>
            </AlertDescription>
          </Alert>
          <RoomChooser examId={id} canEdit={can('exam.create')} />
        </>
      )}
      {d.violations.length > 0 && (
        <Alert>
          <AlertTitle>{d.violations.length} adjacency clash{d.violations.length === 1 ? '' : 'es'}</AlertTitle>
          <AlertDescription>Same-module neighbours could not be fully avoided (a module is larger than half a venue). Clashing seats are outlined in red.</AlertDescription>
        </Alert>
      )}

      {d.generated && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Seat lookup</CardTitle><CardDescription>Find a student&apos;s seat by ID — the same lookup students get on their phones.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Input className="w-56" placeholder="Student ID e.g. 25010001" value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doLookup()} />
            <Button size="sm" variant="outline" onClick={doLookup}><Search className="mr-1 h-4 w-4" /> Find</Button>
            {found && <span className="text-sm">{found.name}: <strong>{found.venueName} · {found.seatLabel}</strong> (highlighted below)</span>}
          </CardContent>
        </Card>
      )}

      {d.venues.map((v) => (
        <Card key={v.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{v.name} <span className="font-normal text-muted-foreground">· {v.building} · {v.rows}×{v.cols} · {v.adjacencyMode === 'ROW' ? 'left/right' : 'left/right + front/back'} separation</span></CardTitle>
            <CardDescription>{v.used} / {v.capacity} seats used{v.violations ? ` · ${v.violations} clashes` : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            <SeatGrid
              rows={v.rows}
              cols={v.cols}
              disabledSeats={v.disabledSeats}
              modules={modules}
              highlight={found && found.venueId === v.id ? { row: found.row, col: found.col } : null}
              seats={d.allocations.filter((a) => a.venueId === v.id).map((a) => ({
                row: a.row,
                col: a.col,
                seatLabel: a.seatLabel,
                moduleCode: a.moduleCode,
                studentId: a.student.studentId,
                name: a.student.name,
                specialNeeds: a.student.specialNeedsSeating,
                violation: violationSeats.has(`${v.id}:${a.seatLabel}`),
              }))}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
