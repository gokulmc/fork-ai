'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, X } from './Icons';
import type { SessionSummary } from '@/lib/api';

interface HistoryBubblesProps {
  sessions: SessionSummary[];
  onLoadSession: (sessionId: string) => void;
}

interface TopicBubble {
  key: string;
  label: string;
  emoji: string;
  sessions: SessionSummary[];
  nodeTotal: number;
  r: number;
}

// --- physics tunables (hot-reload friendly — tweak and save) -------------
// Thumb rule: a bubble's distance from centre is set by its size. Largest sits
// dead centre; the smaller a bubble, the farther out its orbit ring.
const RADIAL_K = 0.03; // stiffness of the spring pulling each bubble to its ring
const RING_REACH = 0.82; // fraction of the stage half-extent the smallest bubble orbits at
const FILL_FRAC = 0.46; // bubbles are scaled so their combined area ≤ this share of the stage
const SEP_GAP = 6; // hard minimum gap between two bubble edges (no overlap, ever)
const SEP_ITERS = 3; // relaxation passes per frame for the non-overlap constraint
const MOUSE_R = 160; // cursor influence radius
const MOUSE_K = 1.4; // cursor repulsion strength
const DAMP = 0.84; // velocity damping → elastic settle
const MAX_V = 16; // velocity clamp (stability)
// -------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'how', 'why', 'what', 'when', 'where', 'who',
  'does', 'did', 'can', 'are', 'was', 'were', 'will', 'into', 'from', 'that',
  'this', 'these', 'those', 'about', 'between', 'vs', 'versus', 'using', 'use',
  'guide', 'overview', 'intro', 'introduction', 'explained', 'explain', 'work',
  'works', 'your', 'their', 'its', 'our', 'you', 'they', 'them',
]);

function tokenize(title: string): string[] {
  const seen = new Set<string>();
  for (const raw of title.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOPWORDS.has(raw)) seen.add(raw);
  }
  return [...seen];
}

function pickEmoji(sessions: SessionSummary[]): string {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (s.emoji) counts.set(s.emoji, (counts.get(s.emoji) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [emoji, count] of counts) {
    if (count > bestCount) { bestCount = count; best = emoji; }
  }
  return best || '🔎';
}

function diameter(nodeTotal: number, min: number, max: number): number {
  const MIN_D = 70;
  const MAX_D = 150;
  if (max <= min) return (MIN_D + MAX_D) / 2;
  const t = Math.sqrt((nodeTotal - min) / (max - min)); // area, not radius, tracks count
  return Math.round(MIN_D + t * (MAX_D - MIN_D));
}

// Group sessions by the most globally-common significant keyword in their titles.
function clusterSessions(sessions: SessionSummary[]): TopicBubble[] {
  const df = new Map<string, number>();
  const tokensBy = new Map<string, string[]>();
  for (const s of sessions) {
    const toks = tokenize(s.title);
    tokensBy.set(s.sessionId, toks);
    for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const buckets = new Map<string, SessionSummary[]>();
  for (const s of sessions) {
    let key = '_misc';
    let bestScore = -1;
    for (const t of tokensBy.get(s.sessionId) ?? []) {
      const score = (df.get(t) ?? 0) * 100 + t.length; // freq dominates, length breaks ties
      if (score > bestScore) { bestScore = score; key = t; }
    }
    const arr = buckets.get(key);
    if (arr) arr.push(s);
    else buckets.set(key, [s]);
  }

  const raw = [...buckets.entries()]
    .map(([key, items]) => ({
      key,
      label: key === '_misc' ? 'Other' : key[0].toUpperCase() + key.slice(1),
      emoji: pickEmoji(items),
      sessions: items,
      nodeTotal: items.reduce((sum, s) => sum + s.nodeCount, 0),
    }))
    .sort((a, b) => b.nodeTotal - a.nodeTotal);

  const totals = raw.map(b => b.nodeTotal);
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  return raw.map(b => ({ ...b, r: diameter(b.nodeTotal, min, max) / 2 }));
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.getFullYear() === today.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

interface PNode {
  key: string;
  baseR: number; // intrinsic radius before fit-to-stage scaling
  r: number; // actual rendered radius (baseR × fit scale)
  mass: number; // ∝ r² → big bubbles are heavy & resist being shoved off-centre
  t: number; // orbit rank 0→1 by size: 0 = biggest (centre), 1 = smallest (outer edge)
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function HistoryBubbles({ sessions, onLoadSession }: HistoryBubblesProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const bubbles = useMemo(() => clusterSessions(sessions), [sessions]);
  // Signature so the physics effect only rebuilds when the set/sizes change.
  const signature = useMemo(
    () => bubbles.map(b => `${b.key}:${Math.round(b.r)}`).join('|'),
    [bubbles],
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const elRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || bubbles.length === 0) return;

    let w = stage.clientWidth || 600;
    let h = stage.clientHeight || 300;

    // Orbit rank: 0 for the biggest bubble, 1 for the smallest. When all bubbles
    // are the same size, fall back to spreading them evenly by index.
    const maxBaseR = bubbles[0].r;
    const minBaseR = bubbles[bubbles.length - 1].r;
    const span = maxBaseR - minBaseR;

    // Seed positions on a golden-angle spiral so nothing starts stacked.
    const nodes: PNode[] = bubbles.map((b, i) => {
      const ang = i * 2.3999632; // golden angle
      const rad = i === 0 ? 0 : 26 + i * 10;
      const t = span > 0
        ? (maxBaseR - b.r) / span
        : (bubbles.length > 1 ? i / (bubbles.length - 1) : 0);
      return {
        key: b.key,
        baseR: b.r,
        r: b.r,
        mass: b.r * b.r,
        t,
        x: w / 2 + Math.cos(ang) * rad,
        y: h / 2 + Math.sin(ang) * rad,
        vx: 0,
        vy: 0,
      };
    });

    // Scale every bubble down so their combined area fits the stage, leaving room
    // for the radial ordering to actually place the biggest in the centre.
    const applyFit = () => {
      let sumArea = 0;
      for (const n of nodes) sumArea += Math.PI * n.baseR * n.baseR;
      const scale = Math.min(1, Math.sqrt((FILL_FRAC * w * h) / sumArea));
      for (const n of nodes) {
        n.r = n.baseR * scale;
        n.mass = n.r * n.r;
        const el = elRefs.current.get(n.key);
        if (el) { el.style.width = `${n.r * 2}px`; el.style.height = `${n.r * 2}px`; }
      }
    };
    applyFit();

    const mouse = { x: 0, y: 0, active: false };
    const onMove = (e: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    };
    const onLeave = () => { mouse.active = false; };
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerleave', onLeave);

    const ro = new ResizeObserver(() => {
      w = stage.clientWidth || w;
      h = stage.clientHeight || h;
      applyFit();
    });
    ro.observe(stage);

    let raf = 0;
    const step = () => {
      const cx = w / 2;
      const cy = h / 2;

      // Each bubble is pulled toward an elliptical ring whose radius is its size
      // rank: biggest → centre, smallest → outer edge. The ellipse uses the full
      // (wide) stage so small bubbles spread across the width instead of piling
      // onto one cramped central ring. They still drift freely *around* the ring.
      for (const n of nodes) {
        const dx = n.x - cx;
        const dy = n.y - cy;
        const ang = Math.atan2(dy, dx);
        const ax = (w / 2 - n.r) * RING_REACH;
        const ay = (h / 2 - n.r) * RING_REACH;
        const tx = cx + Math.cos(ang) * ax * n.t;
        const ty = cy + Math.sin(ang) * ay * n.t;
        n.vx += RADIAL_K * (tx - n.x);
        n.vy += RADIAL_K * (ty - n.y);

        // Cursor repulsion.
        if (mouse.active) {
          const dx = n.x - mouse.x;
          const dy = n.y - mouse.y;
          const d = Math.hypot(dx, dy) || 0.001;
          if (d < MOUSE_R) {
            const f = (1 - d / MOUSE_R);
            n.vx += (MOUSE_K * f * f * dx) / d;
            n.vy += (MOUSE_K * f * f * dy) / d;
          }
        }

        n.vx *= DAMP;
        n.vy *= DAMP;
        const sp = Math.hypot(n.vx, n.vy);
        if (sp > MAX_V) { n.vx = (n.vx / sp) * MAX_V; n.vy = (n.vy / sp) * MAX_V; }
        n.x += n.vx;
        n.y += n.vy;
      }

      // Hard non-overlap constraint — positional relaxation. Any overlapping pair
      // is pushed apart so edges keep at least SEP_GAP between them. Lighter
      // bubbles move more; the heavy central one barely budges.
      for (let k = 0; k < SEP_ITERS; k++) {
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i];
            const b = nodes[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 0.001;
            const min = a.r + b.r + SEP_GAP;
            if (d >= min) continue;
            const overlap = min - d;
            const ux = dx / d;
            const uy = dy / d;
            const total = a.mass + b.mass;
            const aShare = b.mass / total; // lighter bubble (small mass) moves more
            const bShare = a.mass / total;
            a.x -= ux * overlap * aShare;
            a.y -= uy * overlap * aShare;
            b.x += ux * overlap * bShare;
            b.y += uy * overlap * bShare;
          }
        }
      }

      for (const n of nodes) {
        // Elastic walls (clamp after separation so nothing is shoved off-stage).
        if (n.x < n.r) { n.x = n.r; n.vx *= -0.5; }
        else if (n.x > w - n.r) { n.x = w - n.r; n.vx *= -0.5; }
        if (n.y < n.r) { n.y = n.r; n.vy *= -0.5; }
        else if (n.y > h - n.r) { n.y = h - n.r; n.vy *= -0.5; }

        const el = elRefs.current.get(n.key);
        if (el) el.style.transform = `translate3d(${n.x - n.r}px, ${n.y - n.r}px, 0)`;
      }

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
    };
  }, [signature, bubbles]);

  if (bubbles.length === 0) return null;
  const active = bubbles.find(b => b.key === activeKey) ?? null;

  return (
    <div className="topic-bubbles-wrap">
      <div className="topic-bubbles-head">
        <span className="history-divider-label">Topics</span>
        <span className="history-divider-line" />
      </div>

      <div className="topic-stage" ref={stageRef}>
        {bubbles.map(b => (
          <button
            key={b.key}
            ref={el => { if (el) elRefs.current.set(b.key, el); else elRefs.current.delete(b.key); }}
            className={`topic-bubble${b.key === activeKey ? ' is-active' : ''}`}
            style={{ width: b.r * 2, height: b.r * 2 }}
            onClick={() => setActiveKey(k => (k === b.key ? null : b.key))}
            title={`${b.label} · ${b.sessions.length} session${b.sessions.length !== 1 ? 's' : ''} · ${b.nodeTotal} node${b.nodeTotal !== 1 ? 's' : ''}`}
          >
            <span className="topic-bubble-emoji">{b.emoji}</span>
            <span className="topic-bubble-label">{b.label}</span>
            <span className="topic-bubble-count">
              <GitBranch size={11} /> {b.nodeTotal}
            </span>
          </button>
        ))}
      </div>

      {active && (
        <>
          <div className="topic-drawer-scrim" onClick={() => setActiveKey(null)} />
          <div className="topic-drawer" role="dialog" aria-label={`${active.label} sessions`}>
            <div className="topic-drawer-head">
              <span className="topic-drawer-title">
                {active.emoji} {active.label}
              </span>
              <button className="icon-btn" onClick={() => setActiveKey(null)} aria-label="Close">
                <X size={13} />
              </button>
            </div>
            <div className="topic-drawer-bubbles">
              {active.sessions.map(s => (
                <button
                  key={s.sessionId}
                  className="session-bubble"
                  onClick={() => onLoadSession(s.sessionId)}
                  title={s.title}
                >
                  <span className="session-bubble-emoji">{s.emoji}</span>
                  <span className="session-bubble-title">{s.title}</span>
                  <span className="session-bubble-meta">
                    <span className="meta-chip">
                      <GitBranch size={10} /> {s.nodeCount}
                    </span>
                    <span className="session-bubble-date">{shortDate(s.updatedAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
