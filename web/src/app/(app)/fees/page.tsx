'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, qs } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Invoice {
  id: string;
  amount: string | number | null;
  currency: string;
  status: 'UNPAID' | 'PAID' | 'WAIVED';
  dueDate: string;
  paidAt: string | null;
  method: string | null;
  reference: string | null;
  student: { id: string; studentId: string; name: string; programme: { code: string }; section: { name: string } | null };
  semester: { id: string; number: number; term: string; intake: { label: string; programme: { code: string } } };
}
const STYLE = { UNPAID: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200', PAID: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200', WAIVED: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' };
const fmt = (n: string | number) => `NPR ${Number(n).toLocaleString()}`;

export default function FeesPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const fees = useQuery({ queryKey: ['fees', status, q], queryFn: () => api<{ showAmounts: boolean; items: Invoice[]; summary: { status: string; count: number; amount: number | null }[] }>(`/api/fees${qs({ status, q })}`) });
  // RTE works this ledger on paid or unpaid; the sums belong to finance and are withheld unless
  // the account has been granted "See fee amounts".
  const showAmounts = fees.data?.showAmounts ?? false;
  const money = (v: string | number | null | undefined) => (showAmounts && v !== null && v !== undefined ? fmt(v) : 'xxxxxx');
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Invoice['status'] }) => api(`/api/fees/${id}`, { method: 'PATCH', body: { status, method: status === 'PAID' ? 'Cash' : undefined } }),
    onSuccess: () => {
      toast.success('Invoice updated');
      void qc.invalidateQueries({ queryKey: ['fees'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const summary = Object.fromEntries((fees.data?.summary ?? []).map((s) => [s.status, s]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Semester fees</h1>
        <p className="text-sm text-muted-foreground">Admit cards are issued only against a paid (or waived) invoice. Students pay from their own page; the office can record cash here.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(['PAID', 'UNPAID', 'WAIVED'] as const).map((s) => (
          <Card key={s} className="rounded-none"><CardHeader className="pb-1"><CardDescription>{s.charAt(0) + s.slice(1).toLowerCase()}</CardDescription><CardTitle className="text-2xl">{summary[s]?.count ?? 0} <span className="text-sm font-normal text-muted-foreground">· {money(summary[s]?.amount)}</span></CardTitle></CardHeader></Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="w-64" placeholder="Search ID or name" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={status} onValueChange={(v) => setStatus(v ?? 'all')} items={{ all: 'Any status', UNPAID: 'Unpaid', PAID: 'Paid', WAIVED: 'Waived' }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Any status</SelectItem><SelectItem value="UNPAID">Unpaid</SelectItem><SelectItem value="PAID">Paid</SelectItem><SelectItem value="WAIVED">Waived</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Cohort</TableHead><TableHead>Semester</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead>Payment</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {fees.isPending && Array.from({ length: 5 }).map((_, i) => <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>)}
            {fees.data?.items.length === 0 && <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">No invoices match.</TableCell></TableRow>}
            {fees.data?.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell><div className="font-medium">{i.student.name}</div><div className="font-mono text-xs text-muted-foreground">{i.student.studentId}</div></TableCell>
                <TableCell className="text-xs">{i.semester.intake.programme.code} {i.semester.intake.label}{i.student.section ? ` · ${i.student.section.name}` : ''}</TableCell>
                <TableCell>Sem {i.semester.number}</TableCell>
                <TableCell className="text-right font-mono">{money(i.amount)}</TableCell>
                <TableCell className="text-xs">{i.dueDate.slice(0, 10)}</TableCell>
                <TableCell><Badge variant="outline" className={cn('border-transparent', STYLE[i.status])}>{i.status}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{i.paidAt ? `${i.paidAt.slice(0, 10)} · ${i.method} · ${i.reference}` : '—'}</TableCell>
                <TableCell className="text-right">
                  {i.status === 'UNPAID' ? (
                    <div className="flex justify-end gap-1"><Button size="xs" onClick={() => update.mutate({ id: i.id, status: 'PAID' })}>Record cash</Button><Button size="xs" variant="outline" onClick={() => update.mutate({ id: i.id, status: 'WAIVED' })}>Waive</Button></div>
                  ) : (
                    <Button size="xs" variant="ghost" onClick={() => update.mutate({ id: i.id, status: 'UNPAID' })}>Mark unpaid</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
