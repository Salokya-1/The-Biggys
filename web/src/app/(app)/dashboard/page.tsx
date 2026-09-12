'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiStatus } from '@/components/api-status';
import { api } from '@/lib/api';
import type { Paged, Programme, StudentSummary } from '@/lib/types';

export default function DashboardPage() {
  const programmes = useQuery({ queryKey: ['programmes'], queryFn: () => api<Programme[]>('/api/programmes') });
  const students = useQuery({
    queryKey: ['students', 'count'],
    queryFn: () => api<Paged<StudentSummary>>('/api/students?pageSize=1'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operations dashboard</h1>
        <p className="text-sm text-muted-foreground">Live overview for RTE leadership. Result funnel, exam readiness and data-quality tiles land with the result pipeline.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Programmes</CardDescription>
            <CardTitle className="text-3xl">{programmes.data ? programmes.data.length : '—'}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {programmes.data?.reduce((n, p) => n + p.intakes.length, 0) ?? 0} intakes
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Students on record</CardDescription>
            <CardTitle className="text-3xl">{students.data ? students.data.total : '—'}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Link href="/students" className="underline">Open directory</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Modules</CardDescription>
            <CardTitle className="text-3xl">{programmes.data?.reduce((n, p) => n + (p._count?.modules ?? 0), 0) ?? '—'}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <Link href="/modules" className="underline">Open modules</Link>
          </CardContent>
        </Card>
      </div>

      <div className="max-w-md">
        <ApiStatus />
      </div>
    </div>
  );
}
