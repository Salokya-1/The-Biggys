import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { MarkSheetStatus, Outcome, Standing, StudentStatus } from '@/lib/types';

const STATUS_STYLE: Record<StudentStatus, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  DEFERRED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  WITHDRAWN: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  GRADUATED: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
};

const STANDING_STYLE: Record<Standing, string> = {
  GOOD: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  RESIT: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  REVIEW: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
};

const OUTCOME_STYLE: Record<Outcome, string> = {
  PASS: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  FAIL: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  RESIT: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  DEFERRED: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

const SHEET_STYLE: Record<MarkSheetStatus, string> = {
  DRAFT: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  SUBMITTED: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  UNDER_REVIEW: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  APPROVED: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
  PUBLISHED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  CORRECTION_REQUESTED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
};

const base = 'border-transparent font-medium';

export const StatusBadge = ({ status }: { status: StudentStatus }) => (
  <Badge variant="outline" className={cn(base, STATUS_STYLE[status])}>{status}</Badge>
);
export const StandingBadge = ({ standing }: { standing: Standing }) => (
  <Badge variant="outline" className={cn(base, STANDING_STYLE[standing])}>{standing}</Badge>
);
export const OutcomeBadge = ({ outcome }: { outcome: Outcome }) => (
  <Badge variant="outline" className={cn(base, OUTCOME_STYLE[outcome])}>{outcome}</Badge>
);
export const SheetStatusBadge = ({ status }: { status: MarkSheetStatus }) => (
  <Badge variant="outline" className={cn(base, SHEET_STYLE[status])}>{status.replace('_', ' ')}</Badge>
);
