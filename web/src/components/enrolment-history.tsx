'use client';

import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Receipt } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, downloadWithAuth } from '@/lib/api';
import type { StudentProfile } from '@/lib/types';

interface Invoice {
  id: string;
  semester: { number: number } | null;
  amount: number | null;
  status: 'UNPAID' | 'PAID' | 'WAIVED';
  dueDate: string | null;
  paidAt: string | null;
  reference: string | null;
}

const FEE_TONE: Record<Invoice['status'], string> = {
  PAID: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  UNPAID: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  WAIVED: 'bg-muted text-muted-foreground',
};

/**
 * Where the student sits in the programme, everything they have ever been enrolled on, and what
 * they owe.
 *
 * The results tables answer how a semester went. They do not answer the questions the office is
 * actually asked at the counter — which semester is this person in, when does it end, have they
 * ever taken this module before, and is their fee settled — so those live here in one place.
 */
export function EnrolmentHistory({ profile, forStudent }: { profile: StudentProfile; forStudent?: boolean }) {
  const s = profile.student;

  // A student reads their own invoices through their own endpoint; the ledger route is staff-only
  // and asking for it from a student account would fail for a reason that is not a fault.
  const fees = useQuery({
    queryKey: ['student-fees', s.id, forStudent],
    queryFn: () =>
      forStudent
        ? api<{ invoices: Invoice[] }>('/api/fees/me').then((r) => r.invoices)
        : api<{ items: Invoice[] }>(`/api/fees?studentId=${s.id}`).then((r) => r.items),
    retry: false,
  });

  const rows = profile.semesters
    .flatMap((sem) => sem.modules.map((m) => ({ ...m, semesterNumber: sem.number })))
    .sort((a, b) => a.semesterNumber - b.semesterNumber || a.module.code.localeCompare(b.module.code));

  const totalCredits = rows.filter((r) => r.result && r.result.outcome !== 'FAIL').reduce((n, r) => n + r.module.credits, 0);
  const attempted = rows.reduce((n, r) => n + r.module.credits, 0);
  const unpaid = (fees.data ?? []).filter((f) => f.status === 'UNPAID');

  return (
    <div className="space-y-4">
      <Card className="rounded-none">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-base">Where they are</CardTitle>
              <CardDescription>Programme position and credit standing.</CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              data-print-hide
              onClick={() => downloadWithAuth(`/api/students/${s.id}/export.xlsx`, `${s.studentId}-academic-record.xlsx`).catch((e: Error) => toast.error(e.message))}
            >
              <Download className="mr-1 h-4 w-4" /> Academic record (Excel)
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-muted-foreground">Intake</dt><dd className="font-medium">{s.intake.label}</dd></div>
            <div>
              <dt className="text-muted-foreground">Current semester</dt>
              <dd className="font-medium">{s.currentSemester ? `Semester ${s.currentSemester.number}` : 'Not in a semester'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Semester runs</dt>
              <dd className="font-medium">
                {s.currentSemester
                  ? `${new Date(s.currentSemester.startDate).toLocaleDateString()} – ${new Date(s.currentSemester.endDate).toLocaleDateString()}`
                  : '—'}
              </dd>
            </div>
            <div><dt className="text-muted-foreground">Semesters on record</dt><dd className="font-medium">{profile.semesters.length}</dd></div>
            <div><dt className="text-muted-foreground">Credits achieved</dt><dd className="font-medium">{totalCredits} of {attempted} attempted</dd></div>
            <div><dt className="text-muted-foreground">Enrolled since</dt><dd className="font-medium">{new Date(s.createdAt).toLocaleDateString()}</dd></div>
          </dl>
        </CardContent>
      </Card>

      <Card className="rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Module enrolment history</CardTitle>
          <CardDescription>Every module they have been enrolled on, including repeats and resits.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Not enrolled on anything yet.</p>
          ) : (
            <div className="overflow-x-auto border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Semester</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead className="w-20 text-right">Credits</TableHead>
                    <TableHead className="w-20">Attempt</TableHead>
                    <TableHead>Lecturer</TableHead>
                    <TableHead>Outcome</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.enrollmentId}>
                      <TableCell className="tabular-nums">{r.semesterNumber}</TableCell>
                      <TableCell className="max-w-[22rem] truncate">
                        <span className="font-mono text-xs">{r.module.code}</span> {r.module.title}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.module.credits}</TableCell>
                      <TableCell>
                        {r.attempt}
                        {r.isResit && <Badge variant="outline" className="ml-1 rounded-none">Resit</Badge>}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-muted-foreground">{r.lecturer ?? '—'}</TableCell>
                      <TableCell>{r.result ? `${r.result.outcome} (${r.result.overallMark})` : 'Awaiting publication'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Fees</CardTitle>
          <CardDescription>
            {fees.isError
              ? 'You do not have access to the fee ledger.'
              : unpaid.length
                ? `${unpaid.length} invoice${unpaid.length === 1 ? '' : 's'} outstanding — an admit card cannot be issued while one is unpaid.`
                : 'Nothing outstanding.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fees.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {fees.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              <Receipt className="mr-1 inline h-4 w-4" />
              No invoice has been raised yet. A newly enrolled student is billed when fees are generated for their semester.
            </p>
          )}
          {(fees.data ?? []).length > 0 && (
            <div className="overflow-x-auto border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Semester</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(fees.data ?? []).map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>{f.semester ? `Semester ${f.semester.number}` : '—'}</TableCell>
                      {/* RTE sees that a fee exists and whether it is settled; the sums are finance's. */}
                      <TableCell className="text-right font-mono">{f.amount === null ? 'xxxxxx' : f.amount.toLocaleString()}</TableCell>
                      <TableCell>{f.dueDate ? new Date(f.dueDate).toLocaleDateString() : '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`rounded-none border-transparent ${FEE_TONE[f.status]}`}>{f.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{f.paidAt ? new Date(f.paidAt).toLocaleDateString() : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
