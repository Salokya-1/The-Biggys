'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ReasonCheck } from '@/lib/types';

/**
 * Free-text reason with an automatic quality check. Keyboard mashing is refused by the API,
 * so the writer sees the verdict here before they submit rather than after.
 */
export function ReasonField({
  value,
  onChange,
  onVerdict,
  label = 'Reason',
  placeholder = 'e.g. Medical appointment at Bir Hospital on Monday morning',
}: {
  value: string;
  onChange: (v: string) => void;
  onVerdict?: (v: ReasonCheck['verdict'] | null) => void;
  label?: string;
  placeholder?: string;
}) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 400);
    return () => clearTimeout(t);
  }, [value]);

  const check = useQuery({
    queryKey: ['reason-check', debounced],
    queryFn: () => api<ReasonCheck>('/api/requests/check-reason', { method: 'POST', body: { reason: debounced } }),
    enabled: debounced.trim().length >= 3,
    staleTime: 300_000,
  });

  const verdict = debounced.trim().length >= 3 ? check.data?.verdict ?? null : null;
  useEffect(() => {
    onVerdict?.(verdict ?? null);
  }, [verdict, onVerdict]);

  const style =
    verdict === 'GIBBERISH'
      ? { cls: 'text-destructive', Icon: AlertTriangle, head: 'This does not read as a reason' }
      : verdict === 'WEAK'
        ? { cls: 'text-amber-600 dark:text-amber-400', Icon: Info, head: 'Add a little more detail' }
        : verdict === 'OK'
          ? { cls: 'text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2, head: 'Looks like a genuine reason' }
          : null;

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(verdict === 'GIBBERISH' && 'border-destructive focus-visible:border-destructive')}
        rows={3}
      />
      {style && check.data && (
        <div className={cn('flex items-start gap-1.5 text-xs', style.cls)}>
          <style.Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {style.head}
            {check.data.category ? ` · ${check.data.category}` : ''} · score {check.data.score}/100
            {check.data.notes.length > 0 && verdict !== 'OK' ? ` — ${check.data.notes[0]}` : ''}
          </span>
        </div>
      )}
      {verdict === 'GIBBERISH' && <p className="text-xs text-muted-foreground">Write what actually stops you attending; the RTE office reads every request.</p>}
    </div>
  );
}
