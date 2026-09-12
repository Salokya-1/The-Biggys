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
/** A chair seen from the side: back, seat and legs. Drawn so it stays crisp at any cell size. */
function Chair({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={className} aria-hidden>
      <path d="M6 4v8m12-8v8M4 12h16M7 12v8m10-8v8" />
    </svg>
  );
}

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
                <div key={key} className={cn(size, 'relative flex items-start justify-start rounded border border-border p-0.5 text-muted-foreground/60', isHl && 'ring-2 ring-primary')}>
                  <Chair className="pointer-events-none absolute inset-0 m-auto h-1/2 w-1/2 opacity-25" />
                  <span className="relative">{!compact && seatLabel(row, col)}</span>
                </div>
              );
            }
            const colour = MODULE_PALETTE[Math.max(0, modules.indexOf(s.moduleCode)) % MODULE_PALETTE.length];
            return (
              <div
                key={key}
                className={cn(size, 'relative flex flex-col justify-between overflow-hidden rounded border p-0.5 leading-tight', colour, s.violation ? 'border-red-500 ring-1 ring-red-500' : 'border-transparent', isHl && 'ring-2 ring-primary')}
                title={`${s.seatLabel} · ${s.studentId} ${s.name} · ${s.moduleCode}${s.specialNeeds ? ' · special needs' : ''}${s.violation ? ' · adjacency clash' : ''}`}
              >
                <Chair className="pointer-events-none absolute right-0.5 bottom-0.5 h-3 w-3 opacity-40" />
                {!compact && (
                  <>
                    <span className="relative font-semibold">{s.seatLabel}{s.specialNeeds ? ' ◆' : ''}</span>
                    <span className="relative truncate font-mono">{s.studentId}</span>
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
