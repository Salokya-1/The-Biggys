'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, CreditCard, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StudentProfileView } from '@/components/student-profile';
import { api, downloadWithAuth } from '@/lib/api';
import type { StudentProfile } from '@/lib/types';

interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: 'UNPAID' | 'PAID' | 'WAIVED';
  dueDate: string;
  semesterId: string;
  semester: { number: number; term: string; intake: { label: string } };
  admitCard: { id: string; cardNo: string; issuedAt: string } | null;
}

/** Admit card first: it is the thing students come here for during the exam window. */
function AdmitCardPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me', 'fees'], queryFn: () => api<{ invoices: Invoice[] }>('/api/fees/me') });
  // The card matters when there is an exam to sit, so the panel follows the next exam rather than
  // whichever invoice happens to be newest.
  const exams = useQuery({ queryKey: ['me', 'exams'], queryFn: () => api<{ id: string; title: string; date: string; startTime: string; semesterId?: string }[]>('/api/exams/me') });
  const today = new Date().toISOString().slice(0, 10);
  const nextExam = (exams.data ?? []).filter((e) => e.date.slice(0, 10) >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const invoices = q.data?.invoices ?? [];
  const current = (nextExam?.semesterId ? invoices.find((i) => i.semesterId === nextExam.semesterId) : undefined) ?? invoices[0];
  const daysAway = nextExam ? Math.round((new Date(nextExam.date.slice(0, 10)).getTime() - new Date(today).getTime()) / 86400e3) : null;

  const issue = useMutation({
    mutationFn: (inv: Invoice) => api<{ cardNo: string }>('/api/admit-cards/issue', { method: 'POST', body: { semesterId: inv.semesterId } }),
    onSuccess: (c) => {
      toast.success(`Admit card ${c.cardNo} issued`);
      void qc.invalidateQueries({ queryKey: ['me', 'fees'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not issue the card'),
  });

  if (q.isPending) return <Skeleton className="h-28 w-full" />;
  if (!current) return null;

  return (
    <Card className={current.admitCard ? 'border-emerald-300 dark:border-emerald-800' : current.status === 'UNPAID' ? 'border-destructive/50' : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Exam admit card · Semester {current.semester.number}
          {nextExam ? <span className="ml-2 text-xs font-normal text-muted-foreground">next exam {nextExam.date.slice(0, 10)} at {nextExam.startTime}{daysAway !== null && daysAway <= 14 ? ` · in ${daysAway === 0 ? 'today' : `${daysAway} day${daysAway === 1 ? '' : 's'}`}` : ''}</span> : null}
        </CardTitle>
        <CardDescription>
          {current.admitCard
            ? `Issued ${current.admitCard.issuedAt.slice(0, 10)} · card ${current.admitCard.cardNo}. Bring it to every examination with your student ID.`
            : current.status === 'UNPAID'
              ? `Your semester fee of ${current.currency} ${current.amount.toLocaleString()} is unpaid (due ${current.dueDate.slice(0, 10)}). The admit card is released as soon as it is paid.`
              : nextExam
                ? `You have ${nextExam.title} on ${nextExam.date.slice(0, 10)}. Your fee is settled — issue your admit card now.`
                : 'Your fee is settled — issue your admit card now.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {current.admitCard ? (
          <Button size="sm" onClick={() => downloadWithAuth(`/api/admit-cards/${current.admitCard!.id}.pdf`, `admit-card-${current.admitCard!.cardNo}.pdf`).catch((e) => toast.error(e.message))}>
            <FileDown className="mr-1 h-4 w-4" /> Download admit card
          </Button>
        ) : current.status === 'UNPAID' ? (
          <Button size="sm" render={<Link href="/me/fees" />}><CreditCard className="mr-1 h-4 w-4" /> Pay the semester fee</Button>
        ) : (
          <Button size="sm" disabled={issue.isPending} onClick={() => issue.mutate(current)}><BadgeCheck className="mr-1 h-4 w-4" /> Issue my admit card</Button>
        )}
        <Button size="sm" variant="outline" render={<Link href="/me/fees" />}>Fees & payments</Button>
        <Button size="sm" variant="outline" render={<Link href="/me/exams" />}>My exam seats</Button>
        <Button size="sm" variant="outline" render={<Link href="/timetable" />}>My timetable</Button>
      </CardContent>
    </Card>
  );
}

export default function MePage() {
  const profile = useQuery({ queryKey: ['me', 'profile'], queryFn: () => api<StudentProfile>('/api/students/me') });

  return (
    <div className="space-y-4">
      <AdmitCardPanel />
      {profile.isPending && (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {profile.isError && <Alert variant="destructive"><AlertDescription>{(profile.error as Error).message}</AlertDescription></Alert>}
      {profile.data && <StudentProfileView profile={profile.data} forStudent />}
    </div>
  );
}
