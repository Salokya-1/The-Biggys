'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  payload: { markSheetId?: string; examSessionId?: string } | null;
  readAt: string | null;
  createdAt: string;
}

function hrefFor(n: Notification, isStudent: boolean): string | null {
  if (n.payload?.markSheetId && !isStudent) return `/marksheets/${n.payload.markSheetId}`;
  if (n.type.startsWith('result.') && isStudent) return '/me';
  if (n.type === 'seat.allocated') return isStudent ? '/me/exams' : n.payload?.examSessionId ? `/exams/${n.payload.examSessionId}` : null;
  return null;
}

export function NotificationsBell({ isStudent }: { isStudent: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: Notification[]; unread: number }>('/api/notifications'), refetchInterval: 20_000 });
  const markRead = useMutation({
    mutationFn: () => api('/api/notifications/read', { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = q.data?.unread ?? 0;

  return (
    <div className="relative">
      <Button variant="ghost" size="sm" className="relative w-full justify-start" onClick={() => setOpen((o) => !o)}>
        <Bell className="mr-2 h-4 w-4" /> Notifications
        {unread > 0 && <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">{unread}</span>}
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-80 rounded-md border bg-background p-2 shadow-lg">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-xs font-medium">Recent</span>
            <button className="text-xs text-muted-foreground hover:underline" disabled={unread === 0} onClick={() => markRead.mutate()}>Mark all read</button>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {q.data?.items.length === 0 && <p className="p-2 text-xs text-muted-foreground">No notifications.</p>}
            {q.data?.items.slice(0, 20).map((n) => {
              const href = hrefFor(n, isStudent);
              const inner = (
                <div className={`rounded-md p-2 text-xs ${n.readAt ? 'text-muted-foreground' : 'bg-muted font-medium'}`}>
                  <div>{n.title}</div>
                  <div className="font-normal text-muted-foreground">{n.body}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</div>
                </div>
              );
              return href ? <Link key={n.id} href={href} onClick={() => setOpen(false)}>{inner}</Link> : <div key={n.id}>{inner}</div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
