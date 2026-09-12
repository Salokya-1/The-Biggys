'use client';

import { useCallback, useMemo, useState } from 'react';
import { Armchair, Eraser, PersonStanding, Route } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { seatLabel } from '@/components/seat-grid';
import type { CellKind, RoomLayout } from '@/lib/types';

const TOOLS: { kind: CellKind; label: string; icon: React.ComponentType<{ className?: string }>; help: string; className: string }[] = [
  { kind: 'DESK', label: 'Desk', icon: Armchair, help: 'A usable seat', className: 'bg-primary/15 border-primary/40' },
  { kind: 'AISLE', label: 'Aisle', icon: Route, help: 'Walkway — never seated', className: 'bg-muted border-dashed' },
  { kind: 'OFF', label: 'Blocked', icon: Eraser, help: 'Broken or missing desk', className: 'bg-destructive/15 border-destructive/40' },
  { kind: 'TEACHER', label: 'Invigilator', icon: PersonStanding, help: 'Front desk / equipment', className: 'bg-brand-orange/25 border-brand-orange' },
];

const kindOf = (layout: RoomLayout, row: number, col: number): CellKind => layout.cells?.[`${row}:${col}`] ?? 'DESK';

/**
 * Draw a room: click or drag to paint desks, aisles, blocked seats and the invigilator position.
 * Anything that is not a desk stops being a seat, so exam capacity follows the drawing.
 */
export function RoomDesigner({
  rows,
  cols,
  layout,
  onChange,
  onSize,
  readOnly,
}: {
  rows: number;
  cols: number;
  layout: RoomLayout;
  onChange: (next: RoomLayout) => void;
  onSize?: (rows: number, cols: number) => void;
  readOnly?: boolean;
}) {
  const [tool, setTool] = useState<CellKind>('AISLE');
  const [painting, setPainting] = useState(false);

  const paint = useCallback(
    (row: number, col: number) => {
      if (readOnly) return;
      const cells = { ...(layout.cells ?? {}) };
      const key = `${row}:${col}`;
      if (tool === 'DESK') delete cells[key];
      else cells[key] = tool;
      onChange({ ...layout, cells });
    },
    [layout, onChange, readOnly, tool],
  );

  const stats = useMemo(() => {
    let desks = 0;
    let aisles = 0;
    let blocked = 0;
    let teacher = 0;
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        const k = kindOf(layout, r, c);
        if (k === 'DESK') desks++;
        else if (k === 'AISLE') aisles++;
        else if (k === 'OFF') blocked++;
        else teacher++;
      }
    }
    return { desks, aisles, blocked, teacher };
  }, [layout, rows, cols]);

  return (
    <div className="space-y-3" onPointerUp={() => setPainting(false)} onPointerLeave={() => setPainting(false)}>
      {!readOnly && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5">
            {TOOLS.map((t) => (
              <Button key={t.kind} type="button" size="sm" variant={tool === t.kind ? 'default' : 'outline'} title={t.help} onClick={() => setTool(t.kind)}>
                <t.icon className="mr-1 h-3.5 w-3.5" /> {t.label}
              </Button>
            ))}
          </div>
          {onSize && (
            <div className="flex items-end gap-2">
              <div className="space-y-1"><Label className="text-xs">Rows</Label><Input type="number" min={1} max={40} className="w-20" value={rows} onChange={(e) => onSize(Math.max(1, Math.min(40, Number(e.target.value) || 1)), cols)} /></div>
              <div className="space-y-1"><Label className="text-xs">Columns</Label><Input type="number" min={1} max={40} className="w-20" value={cols} onChange={(e) => onSize(rows, Math.max(1, Math.min(40, Number(e.target.value) || 1)))} /></div>
            </div>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...layout, cells: {} })}>Clear drawing</Button>
        </div>
      )}

      <div className="text-center text-[10px] uppercase tracking-widest text-muted-foreground">Front of the room</div>
      <div className="overflow-x-auto">
        <div className="inline-grid gap-1 select-none" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: rows * cols }, (_, i) => {
            const row = Math.floor(i / cols) + 1;
            const col = (i % cols) + 1;
            const kind = kindOf(layout, row, col);
            const style = TOOLS.find((t) => t.kind === kind)!;
            return (
              <button
                key={`${row}:${col}`}
                type="button"
                disabled={readOnly}
                onPointerDown={() => {
                  setPainting(true);
                  paint(row, col);
                }}
                onPointerEnter={() => painting && paint(row, col)}
                title={`${seatLabel(row, col)} · ${style.label}`}
                className={cn('flex h-9 w-9 items-center justify-center border text-[9px] leading-none transition-colors', style.className, !readOnly && 'hover:ring-2 hover:ring-primary/40')}
              >
                {kind === 'DESK' ? seatLabel(row, col) : kind === 'TEACHER' ? <PersonStanding className="h-3.5 w-3.5" /> : kind === 'AISLE' ? '' : '✕'}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {stats.desks} seats · {stats.aisles} aisle cells · {stats.blocked} blocked · {stats.teacher} invigilator {stats.teacher === 1 ? 'position' : 'positions'}. Exam capacity for this room is {stats.desks}.
      </p>
    </div>
  );
}
