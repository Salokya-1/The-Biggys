'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Loader2, Send, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface Action {
  tool: string;
  status: number;
  ok: boolean;
  summary: string;
}
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  actions?: Action[];
  error?: boolean;
}

const SUGGESTIONS: Record<string, string[]> = {
  ADMIN: ['Which mark sheets are overdue and who holds them?', 'Generate seating for the resit exam session', 'Show me students with unpaid fees this semester', "Cancel section A's Programming class tomorrow — the room is being repaired"],
  MODULE_LEADER: ['What is waiting for my review?', 'Summarise the flags on CS4004 mark sheet', 'What does my week look like?'],
  LECTURER: ['What am I teaching this week?', 'Which of my mark sheets are still draft?', 'Report that I am absent on Friday for the 08:00 class'],
  STUDENT: ['What are my results so far?', 'Where is my next exam seat?', 'Have I paid my semester fee?', 'Show my timetable for this week'],
};

/** Floating chat: the model acts through the API with the signed-in user's own permissions. */
export function Assistant() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  // Re-checked when the tab regains focus and every minute while it is open: the answer changes
  // the moment a key is added on the API, and a five-minute cache made a working assistant look
  // permanently switched off.
  const status = useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: () => api<{ enabled: boolean; model: string }>('/api/assistant/status'),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: (q) => (q.state.data?.enabled ? false : 60_000),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  if (!user) return null;

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await api<{ reply: string; actions: Action[]; model: string }>('/api/assistant/chat', {
        method: 'POST',
        body: { messages: next.slice(-20).map((m) => ({ role: m.role, content: m.content })) },
      });
      setMessages((m) => [...m, { role: 'assistant', content: res.reply || '(no reply)', actions: res.actions }]);
      if (res.actions.some((a) => a.ok && a.summary.startsWith('GET') === false)) void qc.invalidateQueries();
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: e instanceof ApiError ? e.message : 'The assistant could not be reached.', error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Open assistant (Ctrl+K)"
        title="Assistant (Ctrl+K)"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90"
      >
        {open ? <X className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-40 flex h-[min(640px,80vh)] w-[min(420px,calc(100vw-2.5rem))] flex-col border bg-card text-card-foreground shadow-2xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <div>
                <div className="text-sm font-semibold">RTE assistant</div>
                <div className="text-[11px] text-muted-foreground">{status.data?.enabled ? `Acts as you (${user.role.replace('_', ' ').toLowerCase()}) · ${status.data.model.split('/').pop()?.replace(':free', '')}` : 'Not configured'}</div>
              </div>
            </div>
            <button className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)} aria-label="Close"><X className="h-4 w-4" /></button>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-muted-foreground">Ask questions or give instructions. Every action runs through the same permission checks as the screens, and is written to the audit log.</p>
                <div className="flex flex-wrap gap-1.5">
                  {(SUGGESTIONS[user.role] ?? []).map((s) => (
                    <button key={s} className="border bg-muted px-2 py-1 text-left text-xs hover:bg-accent" onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[90%] whitespace-pre-wrap px-3 py-2', m.role === 'user' ? 'bg-primary text-primary-foreground' : m.error ? 'border border-destructive/40 bg-destructive/10' : 'bg-muted')}>
                  {m.content}
                  {m.actions && m.actions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.actions.map((a, j) => (
                        <span key={j} className={cn('border px-1.5 py-0.5 font-mono text-[10px]', a.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200')} title={a.summary}>
                          {a.tool} · {a.status}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Working… the free model can take 20–60 s per step.</div>
            )}
          </div>

          <form
            className="flex items-end gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={status.data?.enabled === false ? 'Assistant disabled: set OPENROUTER_API_KEY on the API' : 'Ask or instruct… (Enter to send, Shift+Enter for a new line)'}
              disabled={busy || status.data?.enabled === false}
              className="min-h-[44px] max-h-32 resize-none text-sm"
              rows={1}
            />
            <Button type="submit" size="icon" disabled={busy || !input.trim() || status.data?.enabled === false} aria-label="Send"><Send className="h-4 w-4" /></Button>
          </form>
        </div>
      )}
    </>
  );
}
