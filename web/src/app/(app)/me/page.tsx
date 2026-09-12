'use client';

import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StudentProfileView } from '@/components/student-profile';
import { api } from '@/lib/api';
import type { StudentProfile } from '@/lib/types';

export default function MePage() {
  const profile = useQuery({ queryKey: ['me', 'profile'], queryFn: () => api<StudentProfile>('/api/students/me') });

  return (
    <div className="space-y-4">
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
      {profile.data && <StudentProfileView profile={profile.data} forStudent />}
    </div>
  );
}
