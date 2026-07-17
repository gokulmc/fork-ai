'use client';
import { useEffect, useMemo, useRef } from 'react';
import type { SessionSummary } from '@/lib/api';

interface HistoryBubblesProps {
  sessions: SessionSummary[];
  activity: Record<string, number>; // sessionId → commits in the last 30 days
  onLoadSession: (sessionId: string) => void;
}

// A single lonely project has nothing to shortcut past the list right below
// it, so the cluster only earns its keep once there's a choice.
const MIN_SESSIONS = 2;

// --- physics tunables (ported from the original app's keyword-cluster
// engine — see /Users/gokulmc/fork ai/apps/web/src/components/HistoryBubbles.tsx —
// adapted here to one bubble per project session, sized by 30-day commits
// instead of by node count) -------------------------------------------------
const RADIAL_K = 0.03; // stiffness of the spring pulling each bubble to its ring
const RING_REACH = 0.82; // fraction of the stage half-extent the smallest bubble orbits at
const FILL_FRAC = 0.46; // bubbles are scaled so their combined area ≤ this share of the stage
const SEP_GAP = 6; // hard minimum gap between two bubble edges (no overlap, ever)
const MAX_BUBBLES = 20; // cap so a huge project history doesn't choke the physics loop
const SEP_ITERS = 3; // relaxation passes per frame for the non-overlap constraint
const MOUSE_R = 160; // cursor influence radius
const MOUSE_K = 1.4; // cursor repulsion strength
const DAMP = 0.84; // velocity damping → elastic settle
const MAX_V = 16; // velocity clamp (stability)
const MIN_D = 38; // diameter floor — a 0-commit project still renders, still clickable
const MAX_D = 132;
// -----------------------------------------------------------------------------

interface ProjectBubble {
  sessionId: string;
  title: string;
  emoji: string;
  commits: number;
  r: number;
}

// Bubble area ∝ sqrt(commits) — i.e. radius ∝ commits^0.25 — so a 10x commit
// gap doesn't balloon into a 10x-area bubble. Zero commits floors at MIN_D.
function bubbleDiameter(commits: number, maxCommits: number): number {
  if (maxCommits <= 0 || commits <= 0) return MIN_D;
  const t = Math.pow(commits / maxCommits, 0.25);
  return Math.round(MIN_D + t * (MAX_D - MIN_D));
}

function buildBubbles(sessions: SessionSummary[], activity: Record<string, number>): ProjectBubble[] {
  // Only projects with recent activity earn a bubble — inactive (0-commit)
  // projects just clutter the cluster; the full list below still shows them.
  const withCommits = sessions
    .map(s => ({ s, commits: activity[s.sessionId] ?? 0 }))
    .filter(x => x.commits > 0);
  const maxCommits = withCommits.reduce((m, x) => Math.max(m, x.commits), 0);
  // Largest bubbles first — the cap keeps the physics loop cheap on a big
  // project history; the full list is still browsable in the grid below.
  const capped = [...withCommits].sort((a, b) => b.commits - a.commits).slice(0, MAX_BUBBLES);
  return capped.map(({ s, commits }) => ({
    sessionId: s.sessionId,
    title: s.title,
    emoji: s.emoji || '📁',
    commits,
    r: bubbleDiameter(commits, maxCommits) / 2,
  }));
}

interface PNode {
  sessionId: string;
  baseR: number; // intrinsic radius before fit-to-stage scaling
  r: number; // actual rendered radius (baseR × fit scale)
  mass: number; // ∝ r² → big bubbles are heavy & resist being shoved off-centre
  t: number; // orbit rank 0→1 by size: 0 = biggest (centre), 1 = smallest (outer edge)
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function HistoryBubbles({ sessions, activity, onLoadSession }: HistoryBubblesProps) {
  const bubbles = useMemo(() => buildBubbles(sessions, activity), [sessions, activity]);
  // Signature so the physics effect only rebuilds when the set/sizes change.
  const signature = useMemo(
    () => bubbles.map(b => `${b.sessionId}:${Math.round(b.r)}`).join('|'),
    [bubbles],
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const elRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || bubbles.length === 0) return;

    let w = stage.clientWidth || 600;
    let h = stage.clientHeight || 220;

    const ranked = [...bubbles].sort((a, b) => b.r - a.r);
    const maxBaseR = ranked[0].r;
    const minBaseR = ranked[ranked.length - 1].r;
    const span = maxBaseR - minBaseR;

    // Seed positions on a golden-angle spiral so nothing starts stacked.
    const nodes: PNode[] = bubbles.map((b, i) => {
      const ang = i * 2.3999632; // golden angle
      const rad = i === 0 ? 0 : 26 + i * 10;
      const t = span > 0
        ? (maxBaseR - b.r) / span
        : (bubbles.length > 1 ? i / (bubbles.length - 1) : 0);
      return {
        sessionId: b.sessionId,
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
      const scale = sumArea > 0 ? Math.min(1, Math.sqrt((FILL_FRAC * w * h) / sumArea)) : 1;
      for (const n of nodes) {
        n.r = n.baseR * scale;
        n.mass = n.r * n.r;
        const el = elRefs.current.get(n.sessionId);
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
          const mdx = n.x - mouse.x;
          const mdy = n.y - mouse.y;
          const d = Math.hypot(mdx, mdy) || 0.001;
          if (d < MOUSE_R) {
            const f = 1 - d / MOUSE_R;
            n.vx += (MOUSE_K * f * f * mdx) / d;
            n.vy += (MOUSE_K * f * f * mdy) / d;
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

        const el = elRefs.current.get(n.sessionId);
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

  if (bubbles.length < MIN_SESSIONS) return null;

  return (
    <div className="bubble-stage" ref={stageRef}>
      {bubbles.map(b => (
        <button
          key={b.sessionId}
          ref={el => { if (el) elRefs.current.set(b.sessionId, el); else elRefs.current.delete(b.sessionId); }}
          className="bubble"
          style={{ width: b.r * 2, height: b.r * 2 }}
          onClick={() => onLoadSession(b.sessionId)}
          title={`${b.title} — ${b.commits} commit${b.commits !== 1 ? 's' : ''} in the last 30 days`}
        >
          <span className="bubble-emoji" style={{ fontSize: Math.round(Math.max(11, b.r * 0.4)) }}>{b.emoji}</span>
          <span className="bubble-name">{b.title}</span>
          <span className="bubble-badge">{b.commits} commit{b.commits !== 1 ? 's' : ''}</span>
        </button>
      ))}
    </div>
  );
}
