'use client';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { ForkNode } from '@/lib/types';
import type { SegMeta } from '@/lib/collapseSegments';
import { clamp } from '@/lib/utils';
import { Hash, Search, Sparkles, CornerDownRight, GitBranch, GitMerge, Map, Minus, Plus, Maximize, Filter, Blend, X, ClipboardList, Code } from './Icons';
import { NODE_W, NODE_H, layoutTree, layoutGitGraph, hasRailNode } from '@/lib/layoutGitGraph';
import { kindLabel } from '@/lib/kindLabels';
import { BranchPopup } from './BranchPopup';

const PAD = 48;
const RX = 8;
// Extra height a CODE/BRANCH card's foreignObject grows UPWARD by, to fit the
// commit-pill row above the title — the box still visually stays inside the
// existing PAD (48px) fit-view margin, so layoutGitGraph's pos/bounds math
// doesn't need to know about it (see layoutGitGraph.ts's rail-row-gap comment).
const PILL_H = 22;
// Re-collapse chip (#205) geometry — a slim pill headed the width of a node
// column, sitting just above the (now-expanded) first interior commit.
const COLLAPSE_CHIP_H = 24;
const COLLAPSE_CHIP_GAP = 8;
// Extra height a BRANCH card with an OKR set grows DOWNWARD by, to fit the
// objective subtitle + 🎯 KR-count chip below the title (#220). Unlike PILL_H
// this doesn't need layoutGitGraph.ts to know about it either — it's well
// inside RAIL_ROW_GAP's slack (162px) below the node's own row, so it can't
// collide with whatever continues that BRANCH's column next.
const OKR_H = 34;

// A bracket tracing only the top-right rounded-corner (chamfer) arc of the
// pill — drawn bold/accent on nodes that have been read (see globals.css).
// Computed per-node (not a module-level constant) because CODE/BRANCH cards
// render a taller box (see PILL_H above) and the bracket must track it.
function topRightBracket(w: number, y: number, h: number, r: number, ext: number): string {
  return `M ${w - r - ext} ${y} L ${w - r} ${y} A ${r} ${r} 0 0 1 ${w} ${y + r} L ${w} ${y + r + ext}`;
}

// A thick bar on the left edge — marks a starred/important node (see globals.css).
// Centred on the border (x=0) so it concentrically thickens it, like the read marker.
function starEdge(y: number, h: number, r: number): string {
  return `M 0 ${y + r} L 0 ${y + h - r}`;
}

interface MindMapProps {
  nodes: Record<string, ForkNode>;
  // Segment metadata for BOTH collapsed (id === segId is in `nodes`) and
  // user-expanded (id absent from `nodes`, hiddenIds[0] present instead)
  // chains — see collapseSegments.ts. Only the latter needs rendering here
  // (the re-collapse chip); the former renders via the segment placeholder
  // card already in `nodes`.
  segMeta?: Record<string, SegMeta>;
  onCollapseSegment?: (segId: string) => void;
  // Per-session collapse of a BRANCH's learn+plan subtree (App.tsx owns the
  // pruning in displayNodes — this just drives the toggle dot on the card).
  collapsedBranchIds?: Set<string>;
  hiddenBranchCounts?: Record<string, number>;
  onToggleBranchCollapse?: (id: string) => void;
  rootId: string;
  activeId: string | null;
  onSelect: (id: string) => void;
  onContextMenu?: (id: string, x: number, y: number) => void;
  onForkBranch?: (nodeId: string, title: string) => void;
  loadingIds?: Set<string>;
  readIds?: Set<string>;
  // Mixer/Plan select-mode props — selection mechanics (base/selected/onSelect)
  // are shared between the two modes; only the mode itself decides which
  // toggle button is highlighted.
  selectMode?: 'mixer' | 'plan' | 'pr' | null;
  mixerBaseId?: string | null;
  mixerSelectedIds?: string[];
  onMixerSelect?: (id: string) => void;
  onMixerToggleMode?: () => void;
  onPlanToggleMode?: () => void;
  showMixer?: boolean;
  showPlan?: boolean;
  // PR select-mode (Phase F) — a two-step flow (pick source commit, then pick
  // any node on the target branch) so it doesn't share mixer/plan's
  // multi-select mechanics above; App.tsx owns prSourceId/prTargetId state and
  // the confirm overlay, MindMap only resolves clicks + renders the highlight.
  showPr?: boolean;
  onPrToggleMode?: () => void;
  prSourceId?: string | null;
  prTargetId?: string | null;
  onPrSourceSelect?: (id: string) => void;
  onPrTargetSelect?: (id: string) => void;
  nodeRefs?: React.MutableRefObject<Map<string, SVGGElement>>;
}

export function MindMap({
  nodes,
  segMeta,
  onCollapseSegment,
  collapsedBranchIds,
  hiddenBranchCounts,
  onToggleBranchCollapse,
  rootId,
  activeId,
  onSelect,
  onContextMenu,
  onForkBranch,
  loadingIds = new Set(),
  readIds = new Set(),
  selectMode = null,
  mixerBaseId = null,
  mixerSelectedIds = [],
  onMixerSelect,
  onMixerToggleMode,
  onPlanToggleMode,
  showMixer = false,
  showPlan = false,
  showPr = false,
  onPrToggleMode,
  prSourceId = null,
  prTargetId = null,
  onPrSourceSelect,
  onPrTargetSelect,
  nodeRefs,
}: MindMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const [drag, setDrag] = useState<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [size, setSize] = useState({ w: 600, h: 600 });

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setSize({ w: el.clientWidth, h: el.clientHeight }), 120);
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, []);

  // Sessions with any PLAN/CODE/BRANCH rail node get the git-graph layout
  // (vertical columns); pure-research sessions keep the plain vertical mind
  // map (no regression) — same function, same edges, untouched.
  const gitLayout = useMemo(() => hasRailNode(nodes), [nodes]);
  const { pos, bounds, childMap, depthMap, laneRails, colOf = {} } = useMemo(
    () => (gitLayout ? layoutGitGraph(nodes, rootId) : layoutTree(nodes, rootId)),
    [gitLayout, nodes, rootId],
  );

  const [branchPopup, setBranchPopup] = useState<{ nodeId: string; rect: { left: number; top: number; width: number; height: number; bottom: number } } | null>(null);

  const viewRef = useRef(view);
  viewRef.current = view;
  const animFrame = useRef<number>(0);
  const animateToRef = useRef<(tx: number, ty: number, scale: number, dur?: number) => void>(() => {});

  const animateTo = useCallback(
    (targetTx: number, targetTy: number, targetScale: number, dur = 380) => {
      cancelAnimationFrame(animFrame.current);
      const startTx = viewRef.current.tx;
      const startTy = viewRef.current.ty;
      const startScale = viewRef.current.scale;
      const startT = performance.now();
      function step(now: number) {
        const k = Math.min(1, (now - startT) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        setView({
          tx: startTx + (targetTx - startTx) * e,
          ty: startTy + (targetTy - startTy) * e,
          scale: startScale + (targetScale - startScale) * e,
        });
        if (k < 1) animFrame.current = requestAnimationFrame(step);
      }
      animFrame.current = requestAnimationFrame(step);
    },
    [],
  );
  animateToRef.current = animateTo;
  useEffect(() => () => cancelAnimationFrame(animFrame.current), []);

  const lastFitKey = useRef('');
  const fitDone = useRef(false);
  useEffect(() => {
    const layoutKey = `${size.w}x${size.h}`;
    if (lastFitKey.current === layoutKey) return;
    lastFitKey.current = layoutKey;
    if (!Object.keys(nodes).length) { fitDone.current = false; return; }
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    if (bw <= 0 || bh <= 0 || size.w <= 0 || size.h <= 0) return;
    const scale = Math.min(1, Math.min((size.w - PAD * 2) / bw, (size.h - PAD * 2) / bh));
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const tx = size.w / 2 - cx * scale;
    const ty = size.h / 2 - cy * scale;
    // First fit: snap immediately (no animation on initial load).
    // Subsequent fits (resize, layout change): animate so there's no jarring snap.
    if (fitDone.current) {
      animateToRef.current(tx, ty, scale, 300);
    } else {
      setView({ tx, ty, scale });
    }
    fitDone.current = true;
  }, [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, size.w, size.h, nodes]);

  const activePos = activeId ? pos[activeId] : null;
  useEffect(() => {
    if (!activeId || !activePos || size.w <= 0 || !fitDone.current) return;
    const cx = activePos.x + NODE_W / 2;
    const cy = activePos.y + NODE_H / 2;
    // Centre the selected node at a default 80% zoom (web + mobile).
    const s = 0.8;
    animateTo(size.w / 2 - cx * s, size.h / 2 - cy * s, s, 420);
  }, [activeId, activePos?.x, activePos?.y, size.w, size.h, animateTo]);

  // Pointer events drive mouse pan only. Touch (pan + pinch) is handled by the native
  // listeners below — iOS Safari ignores touch-action for page pinch-zoom, so the only
  // way to stop the whole page zooming is preventDefault on a non-passive touchmove,
  // which React's synthetic (passive) pointer events can't do.
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') return;
    if ((e.target as Element).closest('.mm-node, .mm-segment-collapse-chip')) return;
    cancelAnimationFrame(animFrame.current);
    setDrag({ x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch' || !drag) return;
    setView(v => ({ ...v, tx: drag.tx + (e.clientX - drag.x), ty: drag.ty + (e.clientY - drag.y) }));
  };
  const onPointerUp = () => setDrag(null);

  // Native touch pan + pinch-zoom (mirrors the reading-pane pinch handler). passive:false
  // touchmove + preventDefault is what actually stops Safari from zooming the page.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const distOf = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    let mode: 'none' | 'pan' | 'pinch' = 'none';
    let pan = { x: 0, y: 0, tx: 0, ty: 0 };
    let pinch = { dist: 1, cx: 0, cy: 0, scale: 1, tx: 0, ty: 0 };
    const onStart = (e: TouchEvent) => {
      if ((e.target as Element).closest('.mm-node')) { mode = 'none'; return; }
      cancelAnimationFrame(animFrame.current);
      const r = el.getBoundingClientRect();
      if (e.touches.length >= 2) {
        mode = 'pinch';
        pinch = {
          dist: distOf(e.touches) || 1,
          cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left,
          cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top,
          scale: viewRef.current.scale, tx: viewRef.current.tx, ty: viewRef.current.ty,
        };
      } else {
        mode = 'pan';
        pan = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
      }
    };
    const onMove = (e: TouchEvent) => {
      if (mode === 'pinch' && e.touches.length >= 2) {
        e.preventDefault();
        const newScale = clamp(pinch.scale * (distOf(e.touches) / pinch.dist), 0.3, 2.5);
        const k = newScale / pinch.scale;
        setView({ scale: newScale, tx: pinch.cx - (pinch.cx - pinch.tx) * k, ty: pinch.cy - (pinch.cy - pinch.ty) * k });
      } else if (mode === 'pan' && e.touches.length === 1) {
        e.preventDefault();
        setView(v => ({ ...v, tx: pan.tx + (e.touches[0].clientX - pan.x), ty: pan.ty + (e.touches[0].clientY - pan.y) }));
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) { mode = 'none'; return; }
      // dropped to one finger after a pinch → resume panning from it
      mode = 'pan';
      pan = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // Native, non-passive listener (attached below) so preventDefault is honoured —
  // React's onWheel is registered passive and would warn + still scroll the page.
  // Plain wheel pans (matches trackpad two-finger scroll / mouse wheel expectations);
  // zoom is reserved for ctrl/meta+wheel, since a trackpad pinch gesture arrives in
  // the browser as a ctrl+wheel event — this keeps pinch-to-zoom working.
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    cancelAnimationFrame(animFrame.current);
    if (!e.ctrlKey && !e.metaKey) {
      setView(v => ({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }));
      return;
    }
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView(v => {
      const newScale = clamp(v.scale * factor, 0.3, 2.5);
      const k = newScale / v.scale;
      return { scale: newScale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
    });
  }, []);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const zoomBy = (mul: number) => {
    setView(v => {
      const newScale = clamp(v.scale * mul, 0.3, 2.5);
      const cx = size.w / 2, cy = size.h / 2;
      const k = newScale / v.scale;
      return { scale: newScale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
    });
  };

  const fitView = () => {
    if (!Object.keys(nodes).length || size.w <= 0) return;
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    if (bw <= 0 || bh <= 0) return;
    const scale = Math.min(1, Math.min((size.w - PAD * 2) / bw, (size.h - PAD * 2) / bh));
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    animateTo(size.w / 2 - cx * scale, size.h / 2 - cy * scale, scale, 380);
  };

  // Edge routing: a straight lane line for same-column rail continuation
  // (CODE/BRANCH/MERGE following PLAN/CODE/BRANCH/MERGE), a strict horizontal
  // line with an arrowhead for a fork (BRANCH child — after layoutGitGraph's
  // B1 change a BRANCH shares its parent's y, so parent-right-center to
  // child-left-center is exactly horizontal), and — for learn edges — the
  // legacy vertical bézier (parent bottom-center -> child top-center), since
  // learn subtrees now hang BELOW their rail anchor in both layouts alike.
  const edges: { pid: string; cid: string; d: string; kind: 'lane' | 'fork' | 'learn' }[] = [];
  Object.keys(childMap).forEach(pid => {
    childMap[pid].forEach(cid => {
      const a = pos[pid], b = pos[cid];
      if (!a || !b) return;
      const cKind = nodes[cid]?.kind, pKind = nodes[pid]?.kind;
      const isFork = cKind === 'BRANCH';
      // A "lane" is a straight vertical drop within one column, so it's only
      // valid when parent and child actually share an x. A CODE continuing its
      // rail parent (CODE/BRANCH/MERGE) does. A PLAN->CODE does NOT once the
      // CODE is re-homed to its branch column (layoutGitGraph step 4.5) — and
      // colOf[plan] can even be undefined for a hang-placed PLAN — so it falls
      // through to the cross-column bézier below (same geometry as a learn edge),
      // keeping the visible link PLAN -> CODE.
      const sameX = Math.abs(a.x - b.x) < 1;
      const isLane = !isFork && cKind === 'CODE' && sameX
        && (pKind === 'CODE' || pKind === 'BRANCH' || pKind === 'MERGE' || pKind === 'PLAN');
      if (isLane) {
        const x = a.x + NODE_W / 2;
        edges.push({ pid, cid, kind: 'lane', d: `M ${x} ${a.y + NODE_H} L ${x} ${b.y}` });
      } else if (isFork) {
        const y = a.y + NODE_H / 2; // parent and child share y post-B1 — a strict horizontal
        edges.push({ pid, cid, kind: 'fork', d: `M ${a.x + NODE_W} ${y} L ${b.x} ${y}` });
      } else {
        const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H;
        const x2 = b.x + NODE_W / 2, y2 = b.y;
        const my = (y1 + y2) / 2;
        edges.push({ pid, cid, kind: 'learn', d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}` });
      }
    });
  });

  // Merge edges: a straight line from the SOURCE commit's right (or left, if
  // the MERGE landed to its left) to the MERGE node's opposite side — a second
  // parent link (mergeFromNodeId) that childMap/the edges loop above never
  // sees, since it only walks parentId.
  const mergeEdges: { id: string; d: string }[] = [];
  Object.values(nodes).forEach(n => {
    if (n.kind !== 'MERGE' || !n.mergeFromNodeId) return;
    const src = pos[n.mergeFromNodeId];
    const dst = pos[n.id];
    if (!src || !dst) return;
    const srcY = src.y + NODE_H / 2, dstY = dst.y + NODE_H / 2;
    const d = dst.x >= src.x
      ? `M ${src.x + NODE_W} ${srcY} L ${dst.x} ${dstY}`
      : `M ${src.x} ${srcY} L ${dst.x + NODE_W} ${dstY}`;
    mergeEdges.push({ id: n.id, d });
  });

  const isOnPath = (pid: string, cid: string) => {
    let cur: string | null = activeId;
    while (cur) {
      if (cur === cid && nodes[cur]?.parentId === pid) return true;
      cur = nodes[cur]?.parentId ?? null;
    }
    return false;
  };

  function pickIcon(kind: ForkNode['kind'], isRoot: boolean) {
    if (isRoot) return Hash;
    if (kind === 'QUERY') return Search;
    if (kind === 'ASK') return Sparkles;
    if (kind === 'DEEPER') return CornerDownRight;
    if (kind === 'MIX') return Blend;
    if (kind === 'PLAN') return ClipboardList;
    if (kind === 'CODE') return Code;
    if (kind === 'BRANCH') return GitBranch;
    if (kind === 'MERGE') return GitMerge;
    return GitBranch;
  }

  // Single-letter kind marker shown in the card's top-right corner (replaces the
  // verbose "Commit"/"Root"/… kicker word). Root wins over kind.
  function cornerLetter(kind: ForkNode['kind'], isRoot: boolean): string {
    if (isRoot) return 'R';
    switch (kind) {
      case 'CODE': return 'C';
      case 'BRANCH': return 'B';
      case 'PLAN': return 'P';
      case 'MERGE': return 'M';
      case 'QUERY': return 'Q';
      case 'DEEPER': return 'D';
      case 'ASK': return 'A';
      case 'MIX': return 'X';
      default: return '';
    }
  }

  const nodeCount = Object.keys(nodes).length;

  // Re-collapse chips (#205): a segMeta entry whose segId is NOT itself in
  // `nodes` (the placeholder card only exists while collapsed) but whose
  // first hidden id IS in `nodes` means the user expanded that run — head it
  // with a chip at the anchor node's position instead of leaving no way back.
  const collapseChips = segMeta
    ? Object.entries(segMeta)
        .filter(([segId, meta]) => !nodes[segId] && nodes[meta.hiddenIds[0]] && pos[meta.hiddenIds[0]])
        .map(([segId, meta]) => ({ segId, count: meta.count, anchorId: meta.hiddenIds[0] }))
    : [];

  return (
    <>
      <div className="mindmap-header" data-tour="tour-mindmap">
        <span className="label">
          <Map size={13} />
          {nodeCount}<span className="mm-node-label"> {nodeCount === 1 ? 'node' : 'nodes'}</span>
        </span>
        <div className="mm-right-controls">
          {showMixer && onMixerToggleMode && (
            <button
              className={`mm-mixer-btn${selectMode === 'mixer' ? ' mm-mixer-btn--active' : ''}`}
              onClick={onMixerToggleMode}
              title={selectMode === 'mixer' ? 'Cancel mixer (Esc)' : 'Mixer — synthesize multiple nodes'}
              style={{ pointerEvents: 'auto' }}
            >
              {selectMode === 'mixer' ? <X size={13} /> : <Filter size={13} />}
              <span className="mm-mixer-label">{selectMode === 'mixer' ? 'Cancel' : 'Mixer'}</span>
            </button>
          )}
          {showPlan && onPlanToggleMode && (
            <button
              className={`mm-plan-btn${selectMode === 'plan' ? ' mm-plan-btn--active' : ''}`}
              onClick={onPlanToggleMode}
              title={selectMode === 'plan' ? 'Cancel plan (Esc)' : 'Plan — draft an implementation plan'}
              style={{ pointerEvents: 'auto' }}
            >
              {selectMode === 'plan' ? <X size={13} /> : <ClipboardList size={13} />}
              <span className="mm-plan-label">{selectMode === 'plan' ? 'Cancel' : 'Plan'}</span>
            </button>
          )}
          {showPr && onPrToggleMode && (
            <button
              className={`mm-pr-btn${selectMode === 'pr' ? ' mm-pr-btn--active' : ''}`}
              onClick={onPrToggleMode}
              title={selectMode === 'pr' ? 'Cancel PR (Esc)' : 'PR — merge one branch into another'}
              style={{ pointerEvents: 'auto' }}
            >
              {selectMode === 'pr' ? <X size={13} /> : <GitMerge size={13} />}
              <span className="mm-pr-label">{selectMode === 'pr' ? 'Cancel' : 'PR'}</span>
            </button>
          )}
          <div className="zoom">
            <button className="zoom-step" onClick={() => zoomBy(0.85)} title="Zoom out"><Minus size={13} /></button>
            <span className="val">{Math.round(view.scale * 100)}%</span>
            <button className="zoom-step" onClick={() => zoomBy(1.15)} title="Zoom in"><Plus size={13} /></button>
            <button onClick={fitView} title="Fit to view"><Maximize size={13} /></button>
          </div>
        </div>
      </div>
      <svg
        ref={svgRef}
        className="mindmap-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <defs>
          {/* Arrowhead for fork edges (BRANCH child) — mm-arrow-merge is unused
              until Phase F wires up MERGE edges, defined here so both share
              the same <defs> block. */}
          <marker id="mm-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--kind-branch)" />
          </marker>
          <marker id="mm-arrow-merge" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--kind-merge)" />
          </marker>
        </defs>
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {laneRails?.map((r, i) => (
            <line key={`lane-${i}`} x1={r.x} y1={r.y1} x2={r.x} y2={r.y2} className="lane-rail" />
          ))}
          {edges.map((e, i) => (
            <path
              key={i}
              d={e.d}
              className={`branch branch-${e.kind}${isOnPath(e.pid, e.cid) ? ' active' : ''}`}
              markerEnd={e.kind === 'fork' ? 'url(#mm-arrow)' : undefined}
            />
          ))}
          {mergeEdges.map(e => (
            <path key={`merge-${e.id}`} d={e.d} className="branch branch-merge" markerEnd="url(#mm-arrow-merge)" />
          ))}
          {Object.values(nodes).map(n => {
            const p = pos[n.id];
            if (!p) return null;
            // Collapsed commit-chain placeholder from lib/collapseSegments.ts —
            // renders as a slimmer, unlabelled dashed pill (see the isSegment
            // branches below) and is otherwise inert (no context menu, mixer-select).
            const isSegment = n.id.startsWith('seg:');
            const isActive = n.id === activeId;
            const depth = depthMap[n.id] ?? 0;
            const isRoot = depth === 0;
            const loading = loadingIds.has(n.id);
            const isRead = readIds.has(n.id);
            const starred = !!n.starred;
            // A failed run is a STATE layered on the CODE kind (red border +
            // kicker dot), not a fifth kind — see fix-failure-states.html.
            const isFailed = n.kind === 'CODE' && n.agentStatus === 'error';
            const NodeIcon = pickIcon(n.kind, isRoot);
            const kicker = kindLabel(n.kind, { isRoot });

            // CODE/BRANCH cards grow upward to fit the commit pill above the title —
            // a PLAN card only does when it actually carries a branchName (plans
            // created before the plan-creates-a-branch iteration have none, and
            // shouldn't grow to fit a pill they don't render). A segment placeholder
            // never grows — it has no kicker/icon/commit-pill (see collapseSegments.ts).
            const hasPill = !isSegment && (n.kind === 'CODE' || n.kind === 'BRANCH' || (n.kind === 'PLAN' && !!n.branchName));
            const hasOkr = !isSegment && n.kind === 'BRANCH' && !!n.okr;
            const boxY = hasPill ? -PILL_H : 0;
            const boxH = (hasPill ? NODE_H + PILL_H : NODE_H) + (hasOkr ? OKR_H : 0);
            const commitShaShort = n.kind === 'CODE'
              ? (n.commitSha ? n.commitSha.slice(0, 7) : '—')
              : n.kind === 'PLAN'
                ? `from ${(n.commitSha ?? '').slice(0, 7) || '—'}`
                : n.kind === 'MERGE'
                  ? '—' // Phase F decides the MERGE pill; hasPill excludes MERGE for now, so this is unused
                  : `fork @${(n.commitSha ?? nodes[n.parentId ?? '']?.commitSha ?? '').slice(0, 7) || '—'}`;

            const selecting = selectMode != null;
            const isPr = selectMode === 'pr';
            const isMixerBase = selecting && !isPr && n.id === mixerBaseId;
            const isMixerSelected = selecting && !isPr && mixerSelectedIds.includes(n.id);
            const isMixerSelectable = selecting && !isPr && n.id !== mixerBaseId && !isSegment;

            // PR two-step selection: step 1 picks the source commit (any CODE
            // node with a commit), step 2 picks any node on a DIFFERENT column
            // (branch) than the source — clicking it sets prTargetId, which
            // App.tsx turns into a confirm overlay. Highlighting the whole
            // target column (not just the clicked node) needs colOf, which
            // only the git-graph layout computes.
            const isPrSourceCandidate = isPr && prSourceId == null && !isSegment && n.kind === 'CODE' && !!n.commitSha;
            const isPrTargetCandidate = isPr && prSourceId != null && !isSegment
              && colOf[n.id] !== undefined && colOf[n.id] !== colOf[prSourceId];
            const isPrSourceMarked = isPr && n.id === prSourceId;
            const isPrTargetHighlighted = isPr && prTargetId != null
              && colOf[n.id] !== undefined && colOf[n.id] === colOf[prTargetId];

            const handleClick = (e: React.MouseEvent) => {
              e.stopPropagation();
              if (isPr) {
                if (isPrSourceCandidate) onPrSourceSelect?.(n.id);
                else if (isPrTargetCandidate) onPrTargetSelect?.(n.id);
                return;
              }
              if (selecting && isMixerSelectable && onMixerSelect) {
                onMixerSelect(n.id);
              } else if (!selecting) {
                onSelect(n.id);
              }
            };

            return (
              <g
                key={n.id}
                ref={el => { if (nodeRefs && el) nodeRefs.current.set(n.id, el); }}
                className={`mm-node${isActive ? ' active' : ''}${isRoot ? ' root' : ''}${loading ? ' loading' : ''}${isRead ? ' read' : ''}${starred ? ' starred' : ''}${isMixerBase ? ' mixer-base' : ''}${isMixerSelected ? ' mixer-selected' : ''}${isMixerSelectable ? ' mixer-selectable' : ''}${isPrSourceMarked ? ' mixer-base' : ''}${(isPrSourceCandidate || isPrTargetCandidate) ? ' mixer-selectable' : ''}${isPrTargetHighlighted ? ' mm-node--pr-target' : ''}${isSegment ? ' mm-node--segment' : ''}${isFailed ? ' mm-node--failed' : ''}`}
                data-depth={Math.min(depth, 6)}
                data-kind={n.kind}
                transform={`translate(${p.x} ${p.y})`}
                onClick={handleClick}
                onContextMenu={e => {
                  if (selecting || isSegment) { e.preventDefault(); return; }
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenu?.(n.id, e.clientX, e.clientY);
                }}
              >
                {/* mixer-shaking/pulse/pop animate this inner group, not `.mm-card` directly — Safari
                    doesn't compose a CSS `transform` on HTML content inside a `foreignObject` with the
                    ancestor `<g>`'s SVG "transform" attribute, so the animated card renders at the SVG
                    origin instead of the node's real position. A nested SVG `<g>` composes correctly. */}
                <g className="mm-node-anim">
                  <rect className="pill" x="0" y={boxY} width={NODE_W} height={boxH} rx={RX} />
                  {isRead && <path className="pill-read" d={topRightBracket(NODE_W, boxY, boxH, RX, 1)} />}
                  {starred && <path className="pill-star" d={starEdge(boxY, boxH, RX)} />}
                  <foreignObject x="0" y={boxY} width={NODE_W} height={boxH} className="mm-fo" overflow="hidden">
                    {isSegment ? (
                      <div className="mm-card mm-card--segment">
                        <div className="mm-seg-label">{n.title}</div>
                      </div>
                    ) : (
                      <div className="mm-card">
                        {hasPill && n.branchName && (
                          <div className="mm-card-top">
                            <span
                              className={`mm-commit-pill${n.kind === 'CODE' ? ' mm-commit-pill--clickable' : ''}`}
                              onClick={e => {
                                e.stopPropagation();
                                if (n.kind !== 'CODE' || !onForkBranch) return;
                                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setBranchPopup({ nodeId: n.id, rect: { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom } });
                              }}
                            >
                              ⎇ {n.branchName} · {commitShaShort}
                            </span>
                          </div>
                        )}
                        <div className="mm-card-main">
                          <div className="mm-card-ic">
                            {n.emoji && /\p{Emoji}/u.test(n.emoji)
                              ? <span className="mm-emoji">{n.emoji}</span>
                              : <NodeIcon size={16} />}
                          </div>
                          {/* Round 2 (WS-T): kind label is inline beside the icon, not a
                              separate ALL-CAPS line. Kept inside .mm-card-text so the
                              title's -webkit-line-clamp doesn't overflow the fixed card
                              height (NODE_H=58) — a separate flex child would add its
                              own row height and push 2-line titles past the foreignObject
                              clip rect (#230). */}
                          <div className="mm-card-text">
                            {/* Kicker word replaced by the top-right corner letter badge
                                (.mm-corner-badge, which also carries the run-failed dot).
                                This row now only carries the MERGE PR-status chip. */}
                            {n.kind === 'MERGE' && n.prStatus && (
                              <div className="mm-kicker">
                                <span className={`mm-pr-status mm-pr-status--${n.prStatus}`}>{n.prStatus}</span>
                              </div>
                            )}
                            <div className="mm-label" title={n.title || 'Untitled'}>{n.title || 'Untitled'}</div>
                          </div>
                          {n.sources?.length ? <span className="mm-search-badge">🔍</span> : null}
                          {n.kind === 'MIX' ? <span className="mm-mix-badge"><Filter size={11} /></span> : null}
                          {n.kind === 'BRANCH' && onToggleBranchCollapse && (() => {
                            const branchCollapsed = collapsedBranchIds?.has(n.id) ?? false;
                            const hidden = hiddenBranchCounts?.[n.id] ?? 0;
                            return (
                              <button
                                type="button"
                                className={`mm-collapse-dot${branchCollapsed ? ' mm-collapse-dot--active' : ''}`}
                                title={branchCollapsed ? `Show ${hidden} hidden node${hidden === 1 ? '' : 's'}` : 'Collapse learn + plan'}
                                aria-label={branchCollapsed ? 'Expand branch subtree' : 'Collapse branch subtree'}
                                onClick={e => { e.stopPropagation(); onToggleBranchCollapse(n.id); }}
                              >
                                {branchCollapsed && hidden > 0 ? hidden : ''}
                              </button>
                            );
                          })()}
                        </div>
                        {/* Surface the OKR on the map card itself (#220) — objective as
                            a subtitle, KR count as a small 🎯 chip — so it's visible
                            without opening the pane. hasOkr also grows boxH (OKR_H). */}
                        {hasOkr && n.okr && (
                          <>
                            <div className="mm-node-objective" title={n.okr.objective}>{n.okr.objective}</div>
                            <span className="mm-okr-chip">🎯 {n.okr.keyResults.length} KR{n.okr.keyResults.length === 1 ? '' : 's'}</span>
                          </>
                        )}
                      </div>
                    )}
                  </foreignObject>
                  {/* Kind letter + run-failed dot as native SVG (not an
                      absolutely-positioned HTML span inside the foreignObject —
                      WebKit renders positioned foreignObject descendants at the
                      SVG origin, which piled every card's text in the top-left). */}
                  {isFailed && <circle className="mm-corner-error-dot" cx={NODE_W - 20} cy={boxY + 10} r={3} />}
                  {cornerLetter(n.kind, isRoot) && (
                    <text className="mm-corner-letter" x={NODE_W - 8} y={boxY + 14} textAnchor="end">
                      <title>{isFailed ? 'Run failed' : kicker}</title>
                      {cornerLetter(n.kind, isRoot)}
                    </text>
                  )}
                </g>
              </g>
            );
          })}
          {/* Re-collapse chips (#205) — headers an expanded run, sitting just
              above the now-visible first interior node so there's a way back
              to the collapsed placeholder without losing the expansion state
              of any OTHER segment. */}
          {collapseChips.map(({ segId, count, anchorId }) => {
            const p = pos[anchorId];
            const anchorHasPill = nodes[anchorId]?.kind === 'CODE' || nodes[anchorId]?.kind === 'BRANCH';
            const y = p.y - (anchorHasPill ? PILL_H : 0) - COLLAPSE_CHIP_H - COLLAPSE_CHIP_GAP;
            return (
              <foreignObject key={segId} x={p.x} y={y} width={NODE_W} height={COLLAPSE_CHIP_H} overflow="visible">
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button
                    type="button"
                    className="mm-segment-collapse-chip"
                    onClick={e => { e.stopPropagation(); onCollapseSegment?.(segId); }}
                  >
                    <span className="mm-segment-collapse-chip-caret">⌄</span>{count} commit{count === 1 ? '' : 's'} — collapse
                  </button>
                </div>
              </foreignObject>
            );
          })}
        </g>
      </svg>
      {gitLayout && <MapLegend />}
      {branchPopup && (
        <BranchPopup
          rect={branchPopup.rect}
          fromSha={(nodes[branchPopup.nodeId]?.commitSha ?? '').slice(0, 7) || '—'}
          onSubmit={name => { onForkBranch?.(branchPopup.nodeId, name); setBranchPopup(null); }}
          onClose={() => setBranchPopup(null)}
        />
      )}
    </>
  );
}

// Git-graph map legend — only rendered once the map has switched into
// layoutGitGraph (a pure-research map has no PLAN/CODE/BRANCH/MERGE/segment
// vocabulary to explain). Kept small and corner-anchored (bottom-left, clear
// of the zoom controls and the mixer/PR overlay's bottom-center strip) per
// map-git-graph.html's spec — a reference, not a dominant chrome element.
function MapLegend() {
  return (
    <div className="mm-legend">
      <div className="mm-legend-row"><span className="mm-legend-dot mm-legend-dot--learn" />Learn — go deeper / ask AI</div>
      <div className="mm-legend-row"><span className="mm-legend-dot mm-legend-dot--plan" />Plan — synthesized implementation plan</div>
      <div className="mm-legend-row"><span className="mm-legend-dot mm-legend-dot--code" />Code — one agent run = one commit</div>
      <div className="mm-legend-row"><span className="mm-legend-dot mm-legend-dot--branch" />Branch — forks a new column, same row</div>
      <div className="mm-legend-row"><span className="mm-legend-dot mm-legend-dot--merge" />Merge — PR into a target column</div>
      <div className="mm-legend-row"><span className="mm-legend-dot mm-legend-dot--segment" />Collapsed commit chain</div>
      <div className="mm-legend-row">⌄ Expanded run — click to re-collapse</div>
      <div className="mm-legend-sep" />
      <div className="mm-legend-row"><span className="mm-legend-line mm-legend-line--lane" />Column rail</div>
      <div className="mm-legend-row"><span className="mm-legend-line mm-legend-line--learn" />Learn edge (curved, hangs below)</div>
      <div className="mm-legend-row"><span className="mm-legend-line mm-legend-line--fork" />Branch fork (horizontal, arrowhead)</div>
      <div className="mm-legend-row"><span className="mm-legend-line mm-legend-line--merge" />Merge edge (violet, arrowhead)</div>
    </div>
  );
}
