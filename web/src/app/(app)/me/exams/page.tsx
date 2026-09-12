'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SeatGrid } from '@/components/seat-grid';
import { api } from '@/lib/api';
import type { MyExamSeat } from '@/lib/types';

export default function MyExamsPage() {
  const q = useQuery({ queryKey: ['me', 'exams'], queryFn: () => api<MyExamSeat[]>('/api/exams/me') });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My exam seats</h1>
        <p className="text-sm text-muted-foreground">Upcoming sessions for your modules. Your seat is highlighted once seating has been generated.</p>
      </div>
      {q.isPending && <Skeleton className="h-40 w-full" />}
      {q.isError && <Alert variant="destructive"><AlertDescription>{(q.error as Error).message}</AlertDescription></Alert>}
      {q.data?.length === 0 && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No upcoming exams.</CardContent></Card>}
      {q.data?.map((s) => (
        <Card key={s.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{s.title}</CardTitle>
            <CardDescription>{new Date(s.date).toLocaleDateString()} · {s.startTime} · {s.durationMin} min · {s.modules.map((m) => m.code).join(', ')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {s.seat ? (
              <>
                <p className="text-lg"><span className="text-muted-foreground">Your seat:</span> <strong>{s.seat.venue.name} · {s.seat.seatLabel}</strong> <span className="text-sm text-muted-foreground">({s.seat.venue.building})</span></p>
                <SeatGrid rows={s.seat.venue.rows} cols={s.seat.venue.cols} disabledSeats={s.seat.venue.disabledSeats} seats={[]} modules={[]} highlight={{ row: s.seat.row, col: s.seat.col }} compact />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Seating not yet released for this session.</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
