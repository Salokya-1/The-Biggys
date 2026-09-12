'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, HelpCircle, MessageCircleQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';

interface Ticket {
  id: string;
  category: string;
  subject: string;
  body: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  answer: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
  createdAt: string;
  raisedBy: string;
  raisedByRole: string;
  raisedByStudentId: string | null;
  canAnswer: boolean;
  mine: boolean;
}

const STATUS_STYLE: Record<Ticket['status'], string> = {
  OPEN: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  ANSWERED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  CLOSED: 'bg-muted text-muted-foreground',
};

export default function QueriesPage() {
  const qc = useQueryClient();
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const cats = useQuery({ queryKey: ['query-categories'], queryFn: () => api<string[]>('/api/queries/categories') });
  const list = useQuery({ queryKey: ['queries'], queryFn: () => api<Ticket[]>('/api/queries') });

  const raise = useMutation({
    mutationFn: () => api('/api/queries', { method: 'POST', body: { category, subject, body } }),
    onSuccess: () => {
      toast.success('Sent to the RTE office');
      setSubject('');
      setBody('');
      void qc.invalidateQueries({ queryKey: ['queries'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const answer = useMutation({
    mutationFn: (id: string) => api(`/api/queries/${id}/answer`, { method: 'POST', body: { answer: answers[id] } }),
    onSuccess: (_r, id) => {
      setAnswers((p) => ({ ...p, [id]: '' }));
      void qc.invalidateQueries({ queryKey: ['queries'] });
      toast.success('Answered');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const close = useMutation({
    mutationFn: (id: string) => api(`/api/queries/${id}/close`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['queries'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const ready = !!category && subject.trim().length >= 3 && body.trim().length >= 3;
  const open = (list.data ?? []).filter((t) => t.status !== 'CLOSED');
  const closed = (list.data ?? []).filter((t) => t.status === 'CLOSED');

  return (
    <div className="space-y-4">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Queries</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Questions that need an answer rather than a decision. A request asks for something to be approved; this asks how something works, and keeping the two apart stops the requests that need acting on from being buried.
        </p>
      </div>

      <Card className="rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ask the RTE office</CardTitle>
          <CardDescription>Pick the area so it reaches the right desk.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
            <div className="min-w-0 space-y-1">
              <Label>Area</Label>
              <Select value={category} onValueChange={(v) => setCategory(v ?? '')}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>{(cats.data ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="q-subject">Question</Label>
              <Input id="q-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="When does the resit window open?" maxLength={140} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="q-body">Detail</Label>
            <Textarea id="q-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="Anything that would help answer it — module code, dates, what you have already tried." />
          </div>
          <Button disabled={!ready || raise.isPending} onClick={() => raise.mutate()}>
            <MessageCircleQuestion className="mr-1 h-4 w-4" />
            {raise.isPending ? 'Sending…' : 'Send query'}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-none">
        <CardHeader className="pb-2"><CardTitle className="text-base">Open ({open.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {list.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!list.isPending && open.length === 0 && (
            <Alert className="rounded-none"><HelpCircle className="h-4 w-4" /><AlertDescription>Nothing open.</AlertDescription></Alert>
          )}
          {open.map((t) => (
            <div key={t.id} className="rounded-none border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words">{t.subject}</p>
                  <p className="mt-1 text-sm break-words whitespace-pre-wrap text-muted-foreground">{t.body}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-none">{t.category}</Badge>
                  <Badge variant="outline" className={`rounded-none border-transparent ${STATUS_STYLE[t.status]}`}>{t.status === 'OPEN' ? 'Waiting' : 'Answered'}</Badge>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t.raisedBy}{t.raisedByStudentId ? ` · ${t.raisedByStudentId}` : ''} · {new Date(t.createdAt).toLocaleString()}
              </p>

              {t.answer && (
                <div className="mt-3 border-l-2 border-emerald-500 bg-emerald-50 p-2 text-sm dark:bg-emerald-950/20">
                  <p className="break-words whitespace-pre-wrap">{t.answer}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t.answeredBy} · {t.answeredAt ? new Date(t.answeredAt).toLocaleString() : ''}</p>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-end gap-2">
                {t.canAnswer && (
                  <>
                    <Textarea
                      className="min-w-0 flex-1"
                      rows={2}
                      placeholder={t.answer ? 'Add to the answer' : 'Answer'}
                      value={answers[t.id] ?? ''}
                      onChange={(e) => setAnswers((p) => ({ ...p, [t.id]: e.target.value }))}
                    />
                    <Button size="sm" disabled={!(answers[t.id] ?? '').trim() || answer.isPending} onClick={() => answer.mutate(t.id)}>Answer</Button>
                  </>
                )}
                {(t.mine || t.canAnswer) && (
                  <Button size="sm" variant="outline" onClick={() => close.mutate(t.id)}>
                    <CheckCircle2 className="mr-1 h-4 w-4" /> Close
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {closed.length > 0 && (
        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">Closed ({closed.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {closed.slice(0, 20).map((t) => (
              <div key={t.id} className="rounded-none border p-2 text-sm">
                <span className="font-medium break-words">{t.subject}</span>
                <span className="ml-2 text-xs text-muted-foreground">{t.category} · {new Date(t.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
