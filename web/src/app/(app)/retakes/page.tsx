'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

interface Retakes {
  year: number;
  totalStudents: number;
  candidates: { code: string; title: string; students: { studentId: string; name: string; attempt: number }[] }[];
  summers: { id: string; number: number; startDate: string; examStart: string | null; intake: { label: string; programme: { code: string } }; offerings: { id: string; module: { code: string; title: string }; _count: { enrollments: number } }[]; examSessions: { id: string; title: string; date: string; startTime: string }[] }[];
}

export default function RetakesPage() {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear() - (now.getUTCMonth() < 8 ? 1 : 0));
  const q = useQuery({ queryKey: ['retakes', year], queryFn: () => api<Retakes>(`/api/retakes?year=${year}`) });
  const gen = useMutation({
    mutationFn: () => api<{ intakes: { intake: string; offerings: number; enrolments: number; exams: number }[] }>('/api/retakes/generate', { method: 'POST', body: { year } }),
    onSuccess: (r) => {
      toast.success(`Summer retakes generated: ${r.intakes.map((i) => `${i.intake} — ${i.offerings} modules, ${i.enrolments} enrolments, ${i.exams} exams`).join('; ')}`);
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Summer retakes</h1>
          <p className="text-sm text-muted-foreground">Students with an outstanding RESIT from the academic year are enrolled on a summer semester (6 teaching weeks + exam window) with resit exams scheduled automatically.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="number" className="w-28" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          <span className="text-sm text-muted-foreground">academic year {year}/{year + 1}</span>
          <Button size="sm" disabled={gen.isPending || !q.data?.totalStudents} onClick={() => confirm(`Create summer retakes for ${q.data?.totalStudents} students?`) && gen.mutate()}><Sun className="mr-1 h-4 w-4" /> Generate summer retakes</Button>
        </div>
      </div>
      {q.isPending && <Skeleton className="h-40 w-full" />}
      {q.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Candidates</CardTitle><CardDescription>{q.data.totalStudents} students · {q.data.candidates.length} modules</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Module</TableHead><TableHead className="text-right">Students</TableHead><TableHead>Who</TableHead></TableRow></TableHeader>
                <TableBody>
                  {q.data.candidates.length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-muted-foreground">No outstanding resits.</TableCell></TableRow>}
                  {q.data.candidates.map((c) => (
                    <TableRow key={c.code}><TableCell><div className="font-medium">{c.code}</div><div className="text-xs text-muted-foreground">{c.title}</div></TableCell><TableCell className="text-right">{c.students.length}</TableCell><TableCell className="text-xs">{c.students.map((s) => `${s.studentId} (att. ${s.attempt})`).join(', ')}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Summer semesters</CardTitle><CardDescription>Generated retake terms, modules and resit exams</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {q.data.summers.length === 0 && <p className="text-muted-foreground">None generated yet for {year}/{year + 1}.</p>}
              {q.data.summers.map((s) => (
                <div key={s.id} className="border p-3">
                  <div className="font-medium">{s.intake.programme.code} {s.intake.label} · Summer (Sem {s.number})</div>
                  <div className="text-xs text-muted-foreground">Starts {s.startDate.slice(0, 10)}{s.examStart ? ` · exams from ${s.examStart.slice(0, 10)}` : ''}</div>
                  <ul className="mt-1 list-disc pl-4 text-xs">{s.offerings.map((o) => <li key={o.id}>{o.module.code} {o.module.title} — {o._count.enrollments} student{o._count.enrollments === 1 ? '' : 's'}</li>)}</ul>
                  <div className="mt-1 text-xs text-muted-foreground">{s.examSessions.length} resit exam{s.examSessions.length === 1 ? '' : 's'}: {s.examSessions.map((e) => `${e.date.slice(0, 10)} ${e.startTime}`).join(', ')}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
