'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StudentProfileView } from '@/components/student-profile';
import { api } from '@/lib/api';
import type { StudentProfile } from '@/lib/types';

export default function StudentPage() {
  const { id } = useParams<{ id: string }>();
  const profile = useQuery({ queryKey: ['student', id], queryFn: () => api<StudentProfile>(`/api/students/${id}`) });

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
    </div>
  );
}
