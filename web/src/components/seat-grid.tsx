'use client';

import { cn } from '@/lib/utils';

export const MODULE_PALETTE = [
  'bg-blue-200 dark:bg-blue-900/60',
  'bg-emerald-200 dark:bg-emerald-900/60',
  'bg-amber-200 dark:bg-amber-900/60',
  'bg-pink-200 dark:bg-pink-900/60',
  'bg-indigo-200 dark:bg-indigo-900/60',
  'bg-orange-200 dark:bg-orange-900/60',
  'bg-teal-200 dark:bg-teal-900/60',
  'bg-purple-200 dark:bg-purple-900/60',
];

export function seatLabel(row: number, col: number): string {
  let r = row;
  let letters = '';
  while (r > 0) {
    const rem = (r - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    r = Math.floor((r - 1) / 26);
  }
  return `${letters}${col}`;
}

export interface GridSeat {
  row: number;
  col: number;
  seatLabel: string;
  moduleCode: string;
  studentId: string;
  name: string;
  specialNeeds?: boolean;
  violation?: boolean;
}

interface Props {
  rows: number;
  cols: number;
  disabledSeats: { row: number; col: number }[];
  seats: GridSeat[];
  modules: string[]; // ordered codes for colour assignment
  highlight?: { row: number; col: number } | null;
  compact?: boolean;
}

/** Colour-coded room grid. Front of the room is at the top. */
export function SeatGrid({ rows, cols, disabledSeats, seats, modules, highlight, compact }: Props) {
  const disabled = new Set(disabledSeats.map((d) => `${d.row}:${d.col}`));
  const byPos = new Map(seats.map((s) => [`${s.row}:${s.col}`, s]));
  const size = compact ? 'h-5 w-5 text-[7px]' : 'h-12 w-12 text-[10px]';

  return (
    <div className="space-y-2">
      <div className="text-center text-[10px] uppercase tracking-widest text-muted-foreground">Front</div>
      <div className="overflow-x-auto">
        <div className="inline-grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: rows * cols }, (_, i) => {
            const row = Math.floor(i / cols) + 1;
            const col = (i % cols) + 1;
            const key = `${row}:${col}`;
            const s = byPos.get(key);
            const isHl = highlight && highlight.row === row && highlight.col === col;
            if (disabled.has(key)) {
              return <div key={key} className={cn(size, 'rounded border border-dashed border-muted-foreground/40 bg-muted/60')} title={`${seatLabel(row, col)} unavailable`} />;
            }
            if (!s) {
              return (
                <div key={key} className={cn(size, 'flex items-start justify-start rounded border border-border p-0.5 text-muted-foreground/60', isHl && 'ring-2 ring-primary')}>
                  {!compact && seatLabel(row, col)}
                </div>
              );
            }
            const colour = MODULE_PALETTE[Math.max(0, modules.indexOf(s.moduleCode)) % MODULE_PALETTE.length];
            return (
              <div
                key={key}
                className={cn(size, 'flex flex-col justify-between rounded border p-0.5 leading-tight', colour, s.violation ? 'border-red-500 ring-1 ring-red-500' : 'border-transparent', isHl && 'ring-2 ring-primary')}
                title={`${s.seatLabel} · ${s.studentId} ${s.name} · ${s.moduleCode}${s.specialNeeds ? ' · special needs' : ''}${s.violation ? ' · adjacency clash' : ''}`}
              >
                {!compact && (
                  <>
                    <span className="font-semibold">{s.seatLabel}{s.specialNeeds ? ' ◆' : ''}</span>
                    <span className="truncate font-mono">{s.studentId}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
