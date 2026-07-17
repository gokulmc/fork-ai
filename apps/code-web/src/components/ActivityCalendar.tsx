'use client';
import { useMemo } from 'react';

interface ActivityCalendarProps {
  perDay: Record<string, number>; // 'YYYY-MM-DD' (UTC) → commit count
}

const COLS = 53; // weeks
const ROWS = 7; // Sun..Sat
const CELL = 11;
const GAP = 3;
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

interface CalCell {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

// Level 1 is the floor for any nonzero day (so a single commit is always
// visibly distinct from an empty one); levels 2–4 split the rest of the
// range (relative to the busiest day in the window) into quartiles.
function levelFor(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const t = count / max;
  if (t <= 0.25) return 1;
  if (t <= 0.5) return 2;
  if (t <= 0.75) return 3;
  return 4;
}

export function ActivityCalendar({ perDay }: ActivityCalendarProps) {
  const { cells, months, total } = useMemo(() => {
    const now = new Date();
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const todayDow = new Date(todayUTC).getUTCDay(); // 0 = Sunday
    // Grid ends on the Saturday of the current week so full weeks fill each
    // column; days after today in that trailing week render as empty cells.
    const endSaturday = todayUTC + (6 - todayDow) * DAY_MS;
    const startSunday = endSaturday - (COLS * ROWS - 1) * DAY_MS;

    const raw: Array<{ date: string; count: number; future: boolean }> = [];
    let max = 0;
    for (let i = 0; i < COLS * ROWS; i++) {
      const ms = startSunday + i * DAY_MS;
      const date = new Date(ms).toISOString().slice(0, 10);
      const future = ms > todayUTC;
      const count = future ? 0 : (perDay[date] ?? 0);
      if (!future && count > max) max = count;
      raw.push({ date, count, future });
    }
    const cells: CalCell[] = raw.map(c => ({ ...c, level: c.future ? 0 : levelFor(c.count, max) }));

    // Month labels: one per column whose Sunday row starts a new month.
    const months: Array<{ label: string; col: number }> = [];
    let lastMonth = -1;
    for (let col = 0; col < COLS; col++) {
      const m = new Date(startSunday + col * ROWS * DAY_MS).getUTCMonth();
      if (m !== lastMonth) { months.push({ label: MONTH_NAMES[m], col }); lastMonth = m; }
    }

    const total = Object.values(perDay).reduce((sum, n) => sum + n, 0);
    return { cells, months, total };
  }, [perDay]);

  const gridWidth = COLS * (CELL + GAP) - GAP;

  return (
    <div className="cal-scroll">
      <div className="cal-inner">
        <div className="cal-daylabels">
          {DAY_LABELS.map((label, i) => <span key={i}>{label}</span>)}
        </div>
        <div className="cal-main">
          <div className="cal-months" style={{ width: gridWidth }}>
            {months.map(m => (
              <span key={m.col} style={{ left: m.col * (CELL + GAP) }}>{m.label}</span>
            ))}
          </div>
          <div className="cal-grid" style={{ width: gridWidth }}>
            {cells.map(c => (
              <div
                key={c.date}
                className={c.future ? 'cal-cell cal-cell--future' : `cal-cell l${c.level}`}
                title={c.future ? undefined : `${c.count} commit${c.count !== 1 ? 's' : ''} on ${c.date}`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="cal-caption">{total} commit{total !== 1 ? 's' : ''} in the last year</div>
      <div className="cal-legend">
        Less
        <span className="cal-cell" />
        <span className="cal-cell l1" />
        <span className="cal-cell l2" />
        <span className="cal-cell l3" />
        <span className="cal-cell l4" />
        More
      </div>
    </div>
  );
}
