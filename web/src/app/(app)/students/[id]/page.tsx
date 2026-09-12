'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StudentProfileView } from '@/components/student-profile';
import { api } from '@/lib/api';
import type { StudentProfile } from '@/lib/types';

interface SeatRow {
  id: string;
  seatLabel: string;
  examSession: { id: string; title: string; date: string; startTime: string };
  venue: { name: string };
}

export default function StudentPage() {
  const { id } = useParams<{ id: string }>();
  const profile = useQuery({ queryKey: ['student', id], queryFn: () => api<StudentProfile>(`/api/students/${id}`) });
  const seats = useQuery({ queryKey: ['student', id, 'seats'], queryFn: () => api<SeatRow[]>(`/api/students/${id}/seats`) });

  return (
    <div className="space-y-4">
      <Link href="/students" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="h-4 w-4" /> Directory
      </Link>
      {profile.isPending && (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {profile.isError && (
        <Alert variant="destructive"><AlertDescription>{(profile.error as Error).message}</AlertDescription></Alert>
      )}
      {profile.data && <StudentProfileView profile={profile.data} />}
      {seats.data && seats.data.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Exam seats</CardTitle>
            <CardDescription>Allocated seats for this student</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {seats.data.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <Link href={`/exams/${s.examSession.id}`} className="font-medium hover:underline">{s.examSession.title}</Link>
                <span className="text-muted-foreground">{new Date(s.examSession.date).toLocaleDateString()} {s.examSession.startTime}</span>
                <span className="font-semibold">{s.venue.name} · {s.seatLabel}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
