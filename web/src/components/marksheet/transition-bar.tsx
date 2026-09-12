'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import type { MarkSheetDetail, TransitionAction } from '@/lib/types';

const LABEL: Record<TransitionAction, { label: string; variant: 'default' | 'outline' | 'destructive' | 'secondary'; needsReason?: boolean; describe: string }> = {
  submit: { label: 'Submit for review', variant: 'default', describe: 'Locks the marks and sends sheet to module leader.' },
  start_review: { label: 'Start review', variant: 'secondary', describe: 'Marks the sheet as under review.' },
  approve: { label: 'Approve', variant: 'default', describe: 'Confirms the computed results; the RTE admin can then publish.' },
  reject: { label: 'Return to lecturer', variant: 'destructive', needsReason: true, describe: 'Sends the sheet back to DRAFT. A reason is required and recorded in audit log.' },
  publish: { label: 'Publish results', variant: 'default', describe: 'Makes results visible to students. Published marks become immutable; changes require a correction version.' },
  request_correction: { label: 'Request correction', variant: 'destructive', needsReason: true, describe: 'Opens the way for a new version. Students will be told their result was updated when version is published.' },
};

export function TransitionBar({ detail }: { detail: MarkSheetDetail }) {
  const qc = useQueryClient();
  const { sheet, actions, validation } = detail;
  const [open, setOpen] = useState<TransitionAction | null>(null);
  const [reason, setReason] = useState('');
  const [schedule, setSchedule] = useState('');

  const run = useMutation({
    mutationFn: (action: TransitionAction) =>
      api<{ status: string }>(`/api/marksheets/${sheet.id}/transition`, {
        method: 'POST',
        body: {
          action,
          lockVersion: sheet.lockVersion,
          reason: reason || undefined,
          scheduledPublishAt: action === 'publish' && schedule ? new Date(schedule).toISOString() : undefined,
        },
      }),
    onSuccess: (r) => {
      toast.success(`Mark sheet is now ${r.status.replace('_', ' ')}`);
      setOpen(null);
      setReason('');
      setSchedule('');
      void qc.invalidateQueries({ queryKey: ['marksheet', sheet.id] });
      void qc.invalidateQueries({ queryKey: ['marksheets'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.details && typeof e.details === 'object' && 'errors' in e.details) {
        const errs = (e.details as { errors: string[] }).errors;
        toast.error(`${e.message}: ${errs.slice(0, 3).join('; ')}${errs.length > 3 ? ` (+${errs.length - 3} more)` : ''}`);
      } else toast.error(e instanceof Error ? e.message : 'Action failed');
      void qc.invalidateQueries({ queryKey: ['marksheet', sheet.id] });
    },
  });

  if (actions.length === 0) return null;
  const current = open ? LABEL[open] : null;

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <Button
          key={a}
          variant={LABEL[a].variant}
          size="sm"
          disabled={run.isPending || (a === 'submit' && validation.errors.length > 0)}
          title={a === 'submit' && validation.errors.length > 0 ? 'Fix the issues in Review tab first' : undefined}
          onClick={() => setOpen(a)}
        >
          {LABEL[a].label}
        </Button>
      ))}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{current?.label}</DialogTitle>
            <DialogDescription>{current?.describe}</DialogDescription>
          </DialogHeader>
          {current?.needsReason && (
            <div className="space-y-2">
              <Label htmlFor="reason">Reason (required, recorded in the audit log)</Label>
              <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Row 12 coursework mark looks transposed" />
            </div>
          )}
          {open === 'publish' && (
            <div className="space-y-2">
              <Label htmlFor="schedule">Schedule (optional) — leave empty to publish now</Label>
              <Input id="schedule" type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
              <p className="text-xs text-muted-foreground">Students see results only once the scheduled time has passed. Notifications are sent now with the release time.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
            <Button
              variant={current?.variant === 'destructive' ? 'destructive' : 'default'}
              disabled={run.isPending || (current?.needsReason && reason.trim().length < 3)}
              onClick={() => open && run.mutate(open)}
            >
              {run.isPending ? 'Working…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
