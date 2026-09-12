'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageSquare, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Person { id: string; name: string; role: string; studentId: string | null; programme: string | null }
interface Thread { id: string; name: string; role: string; last: string; at: string; unread: number }
interface Conversation {
  person: { id: string; name: string; role: string };
  messages: { id: string; body: string; createdAt: string; mine: boolean }[];
}

const ROLE_LABEL: Record<string, string> = { ADMIN: 'RTE Admin', MODULE_LEADER: 'Module Leader', LECTURER: 'Lecturer', STUDENT: 'Student' };

export default function MessagesPage() {
  const qc = useQueryClient();
  const [openWith, setOpenWith] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const threads = useQuery({ queryKey: ['threads'], queryFn: () => api<Thread[]>('/api/messages/threads'), refetchInterval: 30_000 });
  const people = useQuery({
    queryKey: ['people', search],
    queryFn: () => api<Person[]>(`/api/messages/people?q=${encodeURIComponent(search)}`),
    enabled: search.trim().length >= 2,
  });
  const convo = useQuery({
    queryKey: ['convo', openWith],
    queryFn: () => api<Conversation>(`/api/messages/with/${openWith}`),
    enabled: !!openWith,
    refetchInterval: 15_000,
  });

  const send = useMutation({
    mutationFn: () => api('/api/messages', { method: 'POST', body: { toId: openWith, body: draft } }),
    onSuccess: () => {
      setDraft('');
      void qc.invalidateQueries({ queryKey: ['convo', openWith] });
      void qc.invalidateQueries({ queryKey: ['threads'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [convo.data?.messages.length]);

  return (
    <div className="space-y-4">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Find a person and say something to them. Search by name, email or student ID — no group chats, no threads to manage, just the messages between the two of you.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <Card className="rounded-none">
          <CardHeader className="pb-2"><CardTitle className="text-base">People</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute top-2.5 left-2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Name, email or student ID" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>

            {search.trim().length >= 2 ? (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {people.isPending && <p className="text-sm text-muted-foreground">Searching…</p>}
                {people.data?.length === 0 && <p className="text-sm text-muted-foreground">Nobody matches that.</p>}
                {(people.data ?? []).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setOpenWith(p.id); setSearch(''); }}
                    className="block w-full min-w-0 rounded-none border px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {ROLE_LABEL[p.role] ?? p.role}{p.studentId ? ` · ${p.studentId}` : ''}{p.programme ? ` · ${p.programme}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="max-h-[26rem] space-y-1 overflow-y-auto">
                {threads.data?.length === 0 && <p className="text-sm text-muted-foreground">No conversations yet. Search for somebody above.</p>}
                {(threads.data ?? []).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setOpenWith(t.id)}
                    className={cn('block w-full min-w-0 rounded-none border px-2 py-1.5 text-left text-sm hover:bg-accent', openWith === t.id && 'bg-accent')}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{t.name}</span>
                      {t.unread > 0 && <Badge className="shrink-0 rounded-none">{t.unread}</Badge>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{t.last}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-[28rem] flex-col rounded-none">
          {!openWith ? (
            <CardContent className="flex flex-1 flex-col items-center justify-center py-16 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">Pick somebody on the left, or search for them.</p>
            </CardContent>
          ) : (
            <>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {convo.data?.person.name ?? 'Loading…'}
                  {convo.data && <span className="ml-2 text-sm font-normal text-muted-foreground">{ROLE_LABEL[convo.data.person.role] ?? convo.data.person.role}</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto border p-3">
                  {convo.data?.messages.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet. Say something.</p>}
                  {(convo.data?.messages ?? []).map((m) => (
                    <div key={m.id} className={cn('flex', m.mine ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[80%] min-w-0 rounded-md px-3 py-2 text-sm break-words whitespace-pre-wrap', m.mine ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                        {m.body}
                        <div className={cn('mt-1 text-[10px]', m.mine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                          {new Date(m.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>

                <div className="flex items-end gap-2">
                  <Textarea
                    className="min-h-[2.5rem] flex-1"
                    rows={2}
                    value={draft}
                    placeholder="Write a message"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter sends, shift+enter starts a new line — what people expect from a chat box.
                      if (e.key === 'Enter' && !e.shiftKey && draft.trim()) {
                        e.preventDefault();
                        send.mutate();
                      }
                    }}
                  />
                  <Button disabled={!draft.trim() || send.isPending} onClick={() => send.mutate()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
