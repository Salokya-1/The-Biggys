/**
 * Explainable statistical flags — shown as warnings during review.
 * They never block a transition and never modify a mark.
 */

export interface FlagComponent {
  id: string;
  name: string;
  maxMark: number;
}

export interface FlagRow {
  enrollmentId: string;
  studentId: string;
  name: string;
  marks: { componentId: string; rawMark: number | null; isAbsent: boolean }[];
  overallMark?: number;
  /** Student's average overall mark across previously published modules, if known. */
  historicalAverage?: number | null;
}

export interface PreviousStats {
  [componentName: string]: { mean: number; sd: number; n: number };
}

export interface Flag {
  level: 'info' | 'warning';
  scope: 'sheet' | 'component' | 'row';
  componentId?: string;
  enrollmentId?: string;
  message: string;
  /**
   * The comparison behind the flag, when there is one. A screen full of sentences saying the same
   * thing in different numbers is unreadable; given the parts, the UI can put them in a table and
   * sort by how far off they are.
   */
  subject?: string;
  measure?: string;
  value?: number;
  expected?: number;
  delta?: number;
}

export interface ComponentStats {
  componentId: string;
  name: string;
  n: number;
  missing: number;
  absent: number;
  mean: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
}

const MIN_N = 5;

function stats(values: number[]) {
  const n = values.length;
  if (n === 0) return { mean: null, sd: null, min: null, max: null };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return { mean: round1(mean), sd: round1(sd), min: Math.min(...values), max: Math.max(...values) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (raw: number, max: number) => (raw / max) * 100;

export function componentStats(components: FlagComponent[], rows: FlagRow[]): ComponentStats[] {
  return components.map((c) => {
    const cells = rows.map((r) => r.marks.find((m) => m.componentId === c.id));
    const present = cells.filter((m): m is NonNullable<typeof m> => !!m && !m.isAbsent && m.rawMark !== null);
    const values = present.map((m) => pct(m.rawMark!, c.maxMark));
    return {
      componentId: c.id,
      name: c.name,
      n: values.length,
      missing: cells.filter((m) => !m || (!m.isAbsent && m.rawMark === null)).length,
      absent: cells.filter((m) => m?.isAbsent).length,
      ...stats(values),
    };
  });
}

export function computeFlags(components: FlagComponent[], rows: FlagRow[], previous?: PreviousStats): Flag[] {
  const flags: Flag[] = [];
  const cs = componentStats(components, rows);

  for (const c of cs) {
    if (c.missing > 0) flags.push({ level: 'info', scope: 'component', componentId: c.componentId, message: `${c.name}: ${c.missing} mark${c.missing === 1 ? '' : 's'} not entered` });
    if (c.n < MIN_N || c.mean === null || c.sd === null) continue;

    if (c.sd < 3) {
      flags.push({ level: 'warning', scope: 'component', componentId: c.componentId, message: `${c.name}: marks are suspiciously uniform (σ = ${c.sd} across ${c.n} students)` });
    }
    const values = rows
      .map((r) => r.marks.find((m) => m.componentId === c.componentId))
      .filter((m) => m && !m.isAbsent && m.rawMark !== null)
      .map((m) => m!.rawMark!);
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    for (const [v, n] of counts) {
      const share = n / values.length;
      if (share >= 0.3 && n >= 3) {
        flags.push({ level: 'warning', scope: 'component', componentId: c.componentId, message: `${c.name}: ${Math.round(share * 100)}% of the cohort (${n}) have the identical mark ${v}` });
      }
    }
    const prev = previous?.[c.name];
    if (prev && prev.n >= MIN_N) {
      const shift = c.mean - prev.mean;
      if (Math.abs(shift) > 15) {
        flags.push({ level: 'warning', scope: 'component', componentId: c.componentId, subject: c.name, measure: 'Mean vs last offering', value: round1(c.mean), expected: round1(prev.mean), delta: round1(shift), message: `${c.name}: mean ${c.mean}% is ${shift > 0 ? 'up' : 'down'} ${Math.abs(round1(shift))} points on the previous offering (${prev.mean}%)` });
      }
    }
  }

  // Row level: a component wildly out of line with the student's other components, or with their history.
  for (const r of rows) {
    const pcts = r.marks
      .filter((m) => !m.isAbsent && m.rawMark !== null)
      .map((m) => ({ m, p: pct(m.rawMark!, components.find((c) => c.id === m.componentId)?.maxMark ?? 100) }));
    if (pcts.length >= 2) {
      for (const { m, p } of pcts) {
        const others = pcts.filter((x) => x.m !== m);
        const othersMean = others.reduce((s, x) => s + x.p, 0) / others.length;
        if (Math.abs(p - othersMean) > 40) {
          const cname = components.find((c) => c.id === m.componentId)?.name ?? m.componentId;
          flags.push({ level: 'warning', scope: 'row', enrollmentId: r.enrollmentId, componentId: m.componentId, subject: `${r.studentId} ${r.name}`, measure: cname, value: round1(p), expected: round1(othersMean), delta: round1(p - othersMean), message: `${r.studentId} ${r.name}: ${cname} (${round1(p)}%) is ${Math.abs(round1(p - othersMean))} points from their other components (${round1(othersMean)}%)` });
        }
      }
    }
    if (r.overallMark !== undefined && r.historicalAverage != null) {
      const diff = r.overallMark - r.historicalAverage;
      if (Math.abs(diff) > 25) {
        flags.push({ level: 'warning', scope: 'row', enrollmentId: r.enrollmentId, subject: `${r.studentId} ${r.name}`, measure: 'Overall vs their average', value: round1(r.overallMark), expected: round1(r.historicalAverage), delta: round1(diff), message: `${r.studentId} ${r.name}: overall ${round1(r.overallMark)} is ${Math.abs(round1(diff))} points ${diff > 0 ? 'above' : 'below'} their published average (${round1(r.historicalAverage)})` });
      }
    }
  }

  return flags;
}
