'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, CreditCard, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, downloadWithAuth } from '@/lib/api';

interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: 'UNPAID' | 'PAID' | 'WAIVED';
  dueDate: string;
  paidAt: string | null;
  method: string | null;
  reference: string | null;
  semesterId: string;
  semester: { id: string; number: number; term: string; intake: { label: string; programme: { code: string } } };
  admitCard: { id: string; cardNo: string; issuedAt: string } | null;
}
const METHODS = { eSewa: 'eSewa', Khalti: 'Khalti', 'Bank transfer': 'Bank transfer' };

export default function MyFeesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me', 'fees'], queryFn: () => api<{ invoices: Invoice[] }>('/api/fees/me') });
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [method, setMethod] = useState('eSewa');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['me', 'fees'] });

  const pay = useMutation({
    mutationFn: (inv: Invoice) => api<Invoice>(`/api/fees/${inv.id}/pay`, { method: 'POST', body: { method } }),
    onSuccess: (r) => {
      toast.success(`Payment received (ref ${r.reference})`);
      setPaying(null);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Payment failed'),
  });
  const issue = useMutation({
    mutationFn: (inv: Invoice) => api<{ id: string; cardNo: string }>('/api/admit-cards/issue', { method: 'POST', body: { semesterId: inv.semesterId } }),
    onSuccess: (c) => {
      toast.success(`Admit card ${c.cardNo} issued`);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not issue'),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fees & admit card</h1>
        <p className="text-sm text-muted-foreground">Your exam admit card is issued as soon as the semester fee is paid. Payment here is a demo gateway.</p>
      </div>
      {q.isPending && <Skeleton className="h-40 w-full" />}
      {q.isError && <Alert variant="destructive"><AlertDescription>{(q.error as Error).message}</AlertDescription></Alert>}
      {q.data?.invoices.length === 0 && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No invoices yet.</CardContent></Card>}
      {q.data?.invoices.map((inv) => (
        <Card key={inv.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Semester {inv.semester.number} · {inv.semester.intake.programme.code} {inv.semester.intake.label}</CardTitle>
            <CardDescription>{inv.currency} {inv.amount.toLocaleString()} · due {inv.dueDate.slice(0, 10)} · <span className={inv.status === 'UNPAID' ? 'font-semibold text-destructive' : 'font-semibold text-emerald-600 dark:text-emerald-400'}>{inv.status}</span>{inv.paidAt ? ` on ${inv.paidAt.slice(0, 10)} via ${inv.method} (ref ${inv.reference})` : ''}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {inv.status === 'UNPAID' && <Button size="sm" onClick={() => setPaying(inv)}><CreditCard className="mr-1 h-4 w-4" /> Pay {inv.currency} {inv.amount.toLocaleString()}</Button>}
            {inv.status !== 'UNPAID' && !inv.admitCard && <Button size="sm" disabled={issue.isPending} onClick={() => issue.mutate(inv)}><BadgeCheck className="mr-1 h-4 w-4" /> Issue admit card</Button>}
            {inv.admitCard && (
              <Button size="sm" variant="outline" onClick={() => downloadWithAuth(`/api/admit-cards/${inv.admitCard!.id}.pdf`, `admit-card-${inv.admitCard!.cardNo}.pdf`).catch((e) => toast.error(e.message))}>
                <FileDown className="mr-1 h-4 w-4" /> Download admit card {inv.admitCard.cardNo}
              </Button>
            )}
            {inv.status === 'UNPAID' && <span className="self-center text-xs text-muted-foreground">Admit card locked until the fee is paid.</span>}
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pay semester fee</DialogTitle><DialogDescription>{paying ? `${paying.currency} ${paying.amount.toLocaleString()} for Semester ${paying.semester.number}. Demo gateway — no real money moves.` : ''}</DialogDescription></DialogHeader>
          <Select value={method} onValueChange={(v) => setMethod(v ?? 'eSewa')} items={METHODS}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(METHODS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
          <DialogFooter><Button variant="outline" onClick={() => setPaying(null)}>Cancel</Button><Button disabled={pay.isPending} onClick={() => paying && pay.mutate(paying)}>{pay.isPending ? 'Paying…' : 'Pay now'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
