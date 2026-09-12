'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StandingBadge, StatusBadge } from '@/components/status-badges';
import { api, qs } from '@/lib/api';
import type { Paged, Programme, StudentSummary } from '@/lib/types';

const STATUSES = ['ACTIVE', 'DEFERRED', 'WITHDRAWN', 'GRADUATED'];
const STANDINGS = ['GOOD', 'RESIT', 'REVIEW'];

export default function StudentsPage() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [programmeId, setProgrammeId] = useState('all');
  const [intakeId, setIntakeId] = useState('all');
  const [status, setStatus] = useState('all');
  const [standing, setStanding] = useState('all');
  const [semesterNumber, setSemesterNumber] = useState('all');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  /** Filter setters reset pagination; changing programme also clears the intake. */
  const filter = (setter: (v: string) => void, alsoResetIntake = false) => (v: string | null) => {
    setter(v ?? 'all');
    if (alsoResetIntake) setIntakeId('all');
    setPage(1);
  };

  const programmes = useQuery({ queryKey: ['programmes'], queryFn: () => api<Programme[]>('/api/programmes') });
  const intakes = useMemo(
    () => programmes.data?.find((p) => p.id === programmeId)?.intakes ?? [],
    [programmes.data, programmeId],
  );

  // Base UI Select renders the raw value unless it is given an items map.
  const programmeItems = { all: 'All programmes', ...Object.fromEntries((programmes.data ?? []).map((p) => [p.id, `${p.code} · ${p.name}`])) };
  const intakeItems = { all: 'All intakes', ...Object.fromEntries(intakes.map((i) => [i.id, i.label])) };
  const semesterItems = { all: 'Any semester', ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [String(n), `Semester ${n}`])) };
  const statusItems = { all: 'Any status', ...Object.fromEntries(STATUSES.map((s) => [s, s])) };
  const standingItems = { all: 'Any standing', ...Object.fromEntries(STANDINGS.map((s) => [s, s])) };

  const query = qs({ q: debounced, programmeId, intakeId, status, standing, semesterNumber, page, pageSize });
  const students = useQuery({
    queryKey: ['students', query],
    queryFn: () => api<Paged<StudentSummary>>(`/api/students${query}`),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Student directory</h1>
        <p className="text-sm text-muted-foreground">Search and filter the central student record. Click a row for the full academic profile.</p>
      </div>

      <div className="grid gap-2 md:grid-cols-6">
        <div className="relative md:col-span-2">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search ID, name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={programmeId} onValueChange={filter(setProgrammeId, true)} items={programmeItems}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Programme" /></SelectTrigger>
          <SelectContent>
            {Object.entries(programmeItems).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={intakeId} onValueChange={filter(setIntakeId)} disabled={programmeId === 'all'} items={intakeItems}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Intake" /></SelectTrigger>
          <SelectContent>
            {Object.entries(intakeItems).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={semesterNumber} onValueChange={filter(setSemesterNumber)} items={semesterItems}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Semester" /></SelectTrigger>
          <SelectContent>
            {Object.entries(semesterItems).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Select value={status} onValueChange={filter(setStatus)} items={statusItems}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              {Object.entries(statusItems).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={standing} onValueChange={filter(setStanding)} items={standingItems}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Standing" /></SelectTrigger>
            <SelectContent>
              {Object.entries(standingItems).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {students.isError && (
        <Alert variant="destructive"><AlertDescription>{(students.error as Error).message}</AlertDescription></Alert>
      )}

      <div className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Programme</TableHead>
              <TableHead>Intake</TableHead>
              <TableHead>Semester</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Standing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.isPending &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))}
            {students.data && students.data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No students match these filters.
                </TableCell>
              </TableRow>
            )}
            {students.data?.items.map((s) => (
              <TableRow key={s.id} className="cursor-pointer">
                <TableCell className="font-mono text-xs">
                  <Link href={`/students/${s.id}`} className="block">{s.studentId}</Link>
                </TableCell>
                <TableCell><Link href={`/students/${s.id}`} className="block font-medium">{s.name}</Link></TableCell>
                <TableCell>{s.programme.code}</TableCell>
                <TableCell>{s.intake.label}</TableCell>
                <TableCell>{s.currentSemester ? `Sem ${s.currentSemester.number}` : '—'}</TableCell>
                <TableCell><StatusBadge status={s.status} /></TableCell>
                <TableCell><StandingBadge standing={s.standing} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {students.data && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {students.data.total} student{students.data.total === 1 ? '' : 's'} · page {students.data.page} of {students.data.pages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= students.data.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
