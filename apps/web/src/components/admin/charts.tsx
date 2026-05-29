'use client';

// Lightweight hand-rolled SVG charts — no chart library dependency.

interface Series {
  label: string;
  color: string;
  points: number[];
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

export function LineChart({
  series,
  labels,
  height = 240,
  fmt = (n: number) => String(Math.round(n)),
}: {
  series: Series[];
  labels: string[];
  height?: number;
  fmt?: (n: number) => string;
}) {
  const W = 760;
  const H = height;
  const padL = 44;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const n = Math.max(1, labels.length);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const rawMax = Math.max(1, ...series.flatMap((s) => s.points));
  const max = niceMax(rawMax);
  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const grid = [0, 0.25, 0.5, 0.75, 1];
  const tickIdx = n <= 6 ? labels.map((_, i) => i) : [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={i} id={`grad-${i}-${s.label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>

      {grid.map((g, i) => {
        const gy = padT + innerH - g * innerH;
        return (
          <g key={i}>
            <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--admin-grid)" strokeWidth="1" />
            <text x={padL - 8} y={gy + 3} textAnchor="end" fontSize="10" fill="var(--admin-muted)">
              {fmt(g * max)}
            </text>
          </g>
        );
      })}

      {tickIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--admin-muted)">
          {labels[i]?.slice(5)}
        </text>
      ))}

      {series.map((s, si) => {
        const line = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p)}`).join(' ');
        const area = `${line} L ${x(s.points.length - 1)} ${padT + innerH} L ${x(0)} ${padT + innerH} Z`;
        return (
          <g key={si}>
            {si === 0 && <path d={area} fill={`url(#grad-${si}-${s.label})`} />}
            <path d={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {n <= 14 &&
              s.points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p)} r="2.5" fill={s.color} />)}
          </g>
        );
      })}
    </svg>
  );
}

export function BarChart({
  points,
  labels,
  color,
  height = 200,
  fmt = (n: number) => String(Math.round(n)),
}: {
  points: number[];
  labels: string[];
  color: string;
  height?: number;
  fmt?: (n: number) => string;
}) {
  const W = 760;
  const H = height;
  const padL = 44;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const n = Math.max(1, points.length);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = niceMax(Math.max(1, ...points));
  const bw = (innerW / n) * 0.62;
  const x = (i: number) => padL + (i + 0.5) * (innerW / n);
  const tickIdx = n <= 6 ? points.map((_, i) => i) : [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      {[0, 0.5, 1].map((g, i) => {
        const gy = padT + innerH - g * innerH;
        return (
          <g key={i}>
            <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--admin-grid)" strokeWidth="1" />
            <text x={padL - 8} y={gy + 3} textAnchor="end" fontSize="10" fill="var(--admin-muted)">
              {fmt(g * max)}
            </text>
          </g>
        );
      })}
      {points.map((p, i) => {
        const h = (p / max) * innerH;
        return <rect key={i} x={x(i) - bw / 2} y={padT + innerH - h} width={bw} height={h} rx="3" fill={color} opacity="0.85" />;
      })}
      {tickIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--admin-muted)">
          {labels[i]?.slice(5)}
        </text>
      ))}
    </svg>
  );
}

export function Sparkline({ points, color, width = 96, height = 32 }: { points: number[]; color: string; width?: number; height?: number }) {
  if (!points.length) return null;
  const max = Math.max(1, ...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const x = (i: number) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * width);
  const y = (v: number) => height - ((v - min) / span) * (height - 4) - 2;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
