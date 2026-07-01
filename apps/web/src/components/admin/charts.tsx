'use client';

// Lightweight hand-rolled SVG charts — no chart library dependency.

import { useState } from 'react';

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

const mmdd = (label?: string) => label?.slice(5) ?? '';

// SVG tooltip drawn in chart coordinates so it scales with the responsive viewBox.
function Tooltip({ x, top, W, title, rows }: {
  x: number; top: number; W: number; title: string; rows: { label: string; color: string }[];
}) {
  const lh = 16;
  const padX = 10;
  const padY = 8;
  const charW = 6.2;
  const longest = Math.max(title.length, ...rows.map((r) => r.label.length));
  const w = Math.max(72, longest * charW + padX * 2 + (rows.length ? 14 : 0));
  const h = padY * 2 + (rows.length + 1) * lh;
  const tx = x + 12 + w > W ? x - 12 - w : x + 12;
  const ty = Math.max(2, top - h - 8);
  return (
    <g pointerEvents="none">
      <rect x={tx} y={ty} width={w} height={h} rx="7" fill="rgba(13,15,21,0.96)" stroke="var(--admin-border)" strokeWidth="1" />
      <text x={tx + padX} y={ty + padY + 11} fontSize="11" fontWeight="600" fill="var(--admin-text)">{title}</text>
      {rows.map((r, i) => (
        <g key={i}>
          <circle cx={tx + padX + 4} cy={ty + padY + lh * (i + 1) + 7} r="4" fill={r.color} />
          <text x={tx + padX + 14} y={ty + padY + lh * (i + 1) + 11} fontSize="11.5" fill="var(--admin-muted)">{r.label}</text>
        </g>
      ))}
    </g>
  );
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
  const [hover, setHover] = useState<number | null>(null);
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
  const slot = n === 1 ? innerW : innerW / (n - 1);

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
          {mmdd(labels[i])}
        </text>
      ))}

      {hover !== null && (
        <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + innerH} stroke="var(--admin-muted)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
      )}

      {series.map((s, si) => {
        const line = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p)}`).join(' ');
        const area = `${line} L ${x(s.points.length - 1)} ${padT + innerH} L ${x(0)} ${padT + innerH} Z`;
        return (
          <g key={si}>
            {si === 0 && <path d={area} fill={`url(#grad-${si}-${s.label})`} />}
            <path d={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {n <= 14 &&
              s.points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p)} r="2.5" fill={s.color} />)}
            {hover !== null && s.points[hover] !== undefined && (
              <circle cx={x(hover)} cy={y(s.points[hover])} r="4.5" fill={s.color} stroke="var(--admin-card)" strokeWidth="1.5" />
            )}
          </g>
        );
      })}

      {/* Hover slices — one transparent column per data point. */}
      {labels.map((_, i) => (
        <rect
          key={i}
          x={x(i) - slot / 2}
          y={padT}
          width={slot}
          height={innerH}
          fill="transparent"
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
        />
      ))}

      {hover !== null && (
        <Tooltip
          x={x(hover)}
          top={Math.min(...series.map((s) => y(s.points[hover] ?? 0)))}
          W={W}
          title={labels[hover] ?? ''}
          rows={series.map((s) => ({ label: `${s.label}: ${fmt(s.points[hover] ?? 0)}`, color: s.color }))}
        />
      )}
    </svg>
  );
}

export function BarChart({
  points,
  labels,
  color,
  height = 200,
  fmt = (n: number) => String(Math.round(n)),
  onBarClick,
}: {
  points: number[];
  labels: string[];
  color: string;
  height?: number;
  fmt?: (n: number) => string;
  onBarClick?: (index: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
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
  const slot = innerW / n;
  const bw = slot * 0.62;
  const x = (i: number) => padL + (i + 0.5) * slot;
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
        return (
          <g key={i}>
            <rect x={x(i) - bw / 2} y={padT + innerH - h} width={bw} height={Math.max(0, h)} rx="3" fill={color} opacity={hover === null || hover === i ? 0.9 : 0.38} />
            <rect
              x={x(i) - slot / 2}
              y={padT}
              width={slot}
              height={innerH}
              fill="transparent"
              style={{ cursor: onBarClick ? 'pointer' : 'default' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onBarClick?.(i)}
            />
          </g>
        );
      })}
      {tickIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--admin-muted)">
          {mmdd(labels[i])}
        </text>
      ))}
      {hover !== null && (
        <Tooltip
          x={x(hover)}
          top={padT + innerH - (points[hover] / max) * innerH}
          W={W}
          title={labels[hover] ?? ''}
          rows={[{ label: fmt(points[hover] ?? 0), color }]}
        />
      )}
    </svg>
  );
}

export interface PieSlice { label: string; value: number; color: string }

// Donut pie + legend. Single-slice case is drawn as a ring (an SVG arc can't
// span a full 360°). Slices with value 0 are dropped. `fmt` formats legend values.
export function PieChart({ slices, size = 132, fmt = (n: number) => n.toLocaleString() }: { slices: PieSlice[]; size?: number; fmt?: (n: number) => string }) {
  const live = slices.filter((s) => s.value > 0);
  const total = live.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return <div className="ad-empty">No data</div>;
  const r = size / 2;
  const inner = r * 0.6;

  let acc = 0;
  const arcs = live.map((s) => {
    const f0 = acc / total;
    acc += s.value;
    const f1 = acc / total;
    return { ...s, f0, f1 };
  });

  return (
    <div className="ad-pie">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ flexShrink: 0 }}>
        <g transform={`translate(${r},${r})`}>
          {arcs.length === 1 ? (
            <>
              <circle r={r} fill={arcs[0].color} />
              <circle r={inner} fill="var(--admin-card)" />
            </>
          ) : (
            arcs.map((a, i) => <path key={i} d={donutArc(r, inner, a.f0, a.f1)} fill={a.color} />)
          )}
        </g>
      </svg>
      <div className="ad-pie-legend">
        {arcs.map((a, i) => (
          <div key={i} className="ad-pie-li">
            <span className="ad-legend-dot" style={{ background: a.color }} />
            <span className="ad-pie-label">{a.label}</span>
            <span className="ad-pie-val">{fmt(a.value)}<span className="ad-pie-pct">{Math.round((a.value / total) * 100)}%</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function donutArc(rO: number, rI: number, f0: number, f1: number): string {
  const a0 = 2 * Math.PI * f0 - Math.PI / 2;
  const a1 = 2 * Math.PI * f1 - Math.PI / 2;
  const large = f1 - f0 > 0.5 ? 1 : 0;
  const pt = (rad: number, ang: number) => `${(rad * Math.cos(ang)).toFixed(3)} ${(rad * Math.sin(ang)).toFixed(3)}`;
  return [
    `M ${pt(rO, a0)}`,
    `A ${rO} ${rO} 0 ${large} 1 ${pt(rO, a1)}`,
    `L ${pt(rI, a1)}`,
    `A ${rI} ${rI} 0 ${large} 0 ${pt(rI, a0)}`,
    'Z',
  ].join(' ');
}

export interface FunnelStage { label: string; value: number; color: string }

const FN_SEG_H = 56;
const FN_GAP = 6;
const FN_WIDTH = 380;
const FN_MIN_FRAC = 0.1; // narrowest a segment can shrink to, so it never fully vanishes
const FN_LABEL_X = FN_WIDTH + 36;

// A real funnel shape — stacked trapezoids tapering from each stage's width down
// to the next stage's width, not a bar chart. Counts + drop-off % from the
// previous stage are printed beside each segment (not inside it — segments can
// get too narrow for legible text when stages span orders of magnitude).
export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  const widthFor = (v: number) => Math.max(FN_WIDTH * FN_MIN_FRAC, (v / max) * FN_WIDTH);
  const height = stages.length * (FN_SEG_H + FN_GAP) - FN_GAP;
  const svgWidth = FN_LABEL_X + 220;
  const cx = FN_WIDTH / 2;

  return (
    <svg viewBox={`0 0 ${svgWidth} ${height}`} width="100%" height={height} style={{ display: 'block' }}>
      {stages.map((s, i) => {
        const topW = widthFor(s.value);
        const botW = i < stages.length - 1 ? widthFor(stages[i + 1].value) : topW * 0.88;
        const y0 = i * (FN_SEG_H + FN_GAP);
        const y1 = y0 + FN_SEG_H;
        const d = [
          `M ${cx - topW / 2} ${y0}`,
          `L ${cx + topW / 2} ${y0}`,
          `L ${cx + botW / 2} ${y1}`,
          `L ${cx - botW / 2} ${y1}`,
          'Z',
        ].join(' ');
        const prev = i > 0 ? stages[i - 1].value : null;
        const dropPct = prev != null ? (prev > 0 ? Math.round((s.value / prev) * 100) : 0) : null;
        return (
          <g key={s.label}>
            <path d={d} fill={s.color} />
            <text x={FN_LABEL_X} y={y0 + FN_SEG_H / 2 - 7} fontSize="13" fontWeight="600" fill="var(--admin-text)">
              {s.label}
            </text>
            <text x={FN_LABEL_X} y={y0 + FN_SEG_H / 2 + 12} fontSize="12" fill="var(--admin-muted)">
              {s.value.toLocaleString()}
              {dropPct !== null ? `  ·  ${dropPct}% of prev.` : ''}
            </text>
          </g>
        );
      })}
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
