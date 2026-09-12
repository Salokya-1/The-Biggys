'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Megaphone, Send, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Audience = 'EVERYONE' | 'STUDENTS' | 'STAFF' | 'PROGRAMME';

interface Sent {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  programme: string | null;
  recipients: number;
  sender: string;
  createdAt: string;
}

const AUDIENCE_LABEL: Record<Audience, string> = {
  EVERYONE: 'Everyone',
  STUDENTS: 'All students',
  STAFF: 'All staff',
  PROGRAMME: 'One programme',
};

export default function AnnouncementsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const maySend = can('broadcast.send');

  const [audience, setAudience] = useState<Audience>('EVERYONE');
  const [programmeId, setProgrammeId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const sentQ = useQuery({ queryKey: ['broadcasts'], queryFn: () => api<Sent[]>('/api/broadcasts') });
  const programmesQ = useQuery({
    queryKey: ['programmes'],
    queryFn: () => api<{ id: string; code: string; name: string }[]>('/api/programmes'),
    enabled: maySend,
  });
  const sizeQ = useQuery({
    queryKey: ['audience-size', audience, programmeId],
    queryFn: () => api<{ count: number }>(`/api/broadcasts/audience-size?audience=${audience}${programmeId ? `&programmeId=${programmeId}` : ''}`),
    enabled: maySend && (audience !== 'PROGRAMME' || !!programmeId),
  });

  const send = useMutation({
    mutationFn: () => api<{ recipients: number }>('/api/broadcasts', { method: 'POST', body: { audience, programmeId: programmeId || undefined, title, body } }),
    onSuccess: (r) => {
      toast.success(`Sent to ${r.recipients} ${r.recipients === 1 ? 'person' : 'people'}`);
      setTitle('');
      setBody('');
      void qc.invalidateQueries({ queryKey: ['broadcasts'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/broadcasts/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['broadcasts'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const ready = title.trim().length >= 3 && body.trim().length >= 3 && (audience !== 'PROGRAMME' || !!programmeId);

  return (
    <div className="space-y-4">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Announcements</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One message to everybody who needs it. A change of exam hall, a closure, a deadline moving — it lands in every recipient&apos;s notifications and stays here as a record of what was said and to whom.
        </p>
      </div>

      {maySend && (
        <Card className="rounded-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">New announcement</CardTitle>
            <CardDescription>Everyone in the audience is notified straight away. There is no recall, so read it back before sending.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <Label>Who it goes to</Label>
                <Select value={audience} onValueChange={(v) => setAudience((v as Audience) ?? 'EVERYONE')}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => (
                      <SelectItem key={a} value={a}>{AUDIENCE_LABEL[a]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {audience === 'PROGRAMME' && (
                <div className="min-w-0 space-y-1">
                  <Label>Programme</Label>
                  <Select value={programmeId} onValueChange={(v) => setProgrammeId(v ?? '')}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Choose a programme" /></SelectTrigger>
                    <SelectContent>
                      {(programmesQ.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="a-title">Subject</Label>
              <Input id="a-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Monday's exams move to Kumari Hall 1" maxLength={120} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="a-body">Message</Label>
              <Textarea id="a-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} placeholder="What people need to know, and what they should do about it." />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={!ready || send.isPending} onClick={() => send.mutate()}>
                <Send className="mr-1 h-4 w-4" />
                {send.isPending ? 'Sending…' : 'Send announcement'}
              </Button>
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                {sizeQ.data ? `${sizeQ.data.count} recipients` : audience === 'PROGRAMME' && !programmeId ? 'Choose a programme' : 'Counting…'}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sent</CardTitle>
          <CardDescription>The last fifty announcements.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {sentQ.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {sentQ.data?.length === 0 && (
            <Alert className="rounded-none"><Megaphone className="h-4 w-4" /><AlertDescription>Nothing has been announced yet.</AlertDescription></Alert>
          )}
          {(sentQ.data ?? []).map((b) => (
            <div key={b.id} className="rounded-none border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium break-words">{b.title}</p>
                  <p className="mt-1 text-sm break-words whitespace-pre-wrap text-muted-foreground">{b.body}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="rounded-none">{b.programme ?? AUDIENCE_LABEL[b.audience]}</Badge>
                  {maySend && (
                    <Button size="xs" variant="ghost" onClick={() => remove.mutate(b.id)} aria-label="Remove from the record">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {b.sender} · {b.recipients} recipients · {new Date(b.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
