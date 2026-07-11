'use client';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { ForkNode } from '@/lib/types';
import { clamp } from '@/lib/utils';
import { Hash, Sparkles, CornerDownRight, GitBranch, Map, Minus, Plus, Maximize, Filter, Blend, X, ClipboardList, Code } from './Icons';
import { NODE_W, NODE_H, layoutTree, layoutGitGraph, hasRailNode } from '@/lib/layoutGitGraph';
import { BranchPopup } from './BranchPopup';

const PAD = 48;
const RX = 8;
// Extra height a CODE/BRANCH card's foreignObject grows UPWARD by, to fit the
// commit-pill row above the title — the box still visually stays inside the
// existing PAD (48px) fit-view margin, so layoutGitGraph's pos/bounds math
// doesn't need to know about it (see layoutGitGraph.ts's rail-row-gap comment).
const PILL_H = 22;

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
  rootId: string;
  activeId: string | null;
  onSelect: (id: string) => void;
  onContextMenu?: (id: string, x: number, y: number) => void;
  onForkBranch?: (nodeId: string, branchName: string) => void;
  loadingIds?: Set<string>;
  readIds?: Set<string>;
  // Mixer props
  mixerMode?: boolean;
  mixerBaseId?: string | null;
  mixerSelectedIds?: string[];
  onMixerSelect?: (id: string) => void;
  onMixerToggleMode?: () => void;
  showMixer?: boolean;
  nodeRefs?: React.MutableRefObject<Map<string, SVGGElement>>;
}

export function MindMap({
  nodes,
  rootId,
  activeId,
  onSelect,
  onContextMenu,
  onForkBranch,
  loadingIds = new Set(),
  readIds = new Set(),
  mixerMode = false,
  mixerBaseId = null,
  mixerSelectedIds = [],
  onMixerSelect,
  onMixerToggleMode,
  showMixer = false,
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

  // Sessions with any PLAN/CODE/BRANCH rail node get the git-graph layout;
  // pure-research sessions keep the plain vertical mind map (no regression).
  const { pos, bounds, childMap, depthMap, laneRails } = useMemo(
    () => (hasRailNode(nodes) ? layoutGitGraph(nodes, rootId) : layoutTree(nodes, rootId)),
    [nodes, rootId],
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
    if ((e.target as Element).closest('.mm-node')) return;
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
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    cancelAnimationFrame(animFrame.current);
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

  // Edge routing: a straight lane line for same-lane rail continuation (CODE
  // following PLAN/CODE), a rounded elbow bézier for the fork point on either
  // side of a BRANCH node, and the existing vertical bézier for learn edges.
  // Geometrically 'fork' and 'learn' share the same curve — only the CSS class
  // (colour) differs, matching the design bundle's map-git-graph.html.
  const edges: { pid: string; cid: string; d: string; kind: 'lane' | 'fork' | 'learn' }[] = [];
  Object.keys(childMap).forEach(pid => {
    childMap[pid].forEach(cid => {
      const a = pos[pid], b = pos[cid];
      if (!a || !b) return;
      const cKind = nodes[cid]?.kind, pKind = nodes[pid]?.kind;
      const isFork = cKind === 'BRANCH' || pKind === 'BRANCH';
      const isLane = !isFork && cKind === 'CODE' && (pKind === 'PLAN' || pKind === 'CODE');
      if (isLane) {
        const y = a.y + NODE_H / 2;
        edges.push({ pid, cid, kind: 'lane', d: `M ${a.x + NODE_W} ${y} L ${b.x} ${y}` });
      } else {
        const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H;
        const x2 = b.x + NODE_W / 2, y2 = b.y;
        const my = (y1 + y2) / 2;
        edges.push({ pid, cid, kind: isFork ? 'fork' : 'learn', d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}` });
      }
    });
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
    if (kind === 'ASK') return Sparkles;
    if (kind === 'DEEPER') return CornerDownRight;
    if (kind === 'MIX') return Blend;
    if (kind === 'PLAN') return ClipboardList;
    if (kind === 'CODE') return Code;
    if (kind === 'BRANCH') return GitBranch;
    return GitBranch;
  }

  const nodeCount = Object.keys(nodes).length;

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
              className={`mm-mixer-btn${mixerMode ? ' mm-mixer-btn--active' : ''}`}
              onClick={onMixerToggleMode}
              title={mixerMode ? 'Cancel mixer (Esc)' : 'Mixer — synthesize multiple nodes'}
              style={{ pointerEvents: 'auto' }}
            >
              {mixerMode ? <X size={13} /> : <Filter size={13} />}
              <span className="mm-mixer-label">{mixerMode ? 'Cancel' : 'Mixer'}</span>
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
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {laneRails?.map((r, i) => (
            <line key={`lane-${i}`} x1={r.x1} y1={r.y} x2={r.x2} y2={r.y} className="lane-rail" />
          ))}
          {edges.map((e, i) => (
            <path key={i} d={e.d} className={`branch branch-${e.kind}${isOnPath(e.pid, e.cid) ? ' active' : ''}`} />
          ))}
          {Object.values(nodes).map(n => {
            const p = pos[n.id];
            if (!p) return null;
            const isActive = n.id === activeId;
            const depth = depthMap[n.id] ?? 0;
            const isRoot = depth === 0;
            const loading = loadingIds.has(n.id);
            const isRead = readIds.has(n.id);
            const starred = !!n.starred;
            const NodeIcon = pickIcon(n.kind, isRoot);
            const kicker = isRoot
              ? 'Root'
              : n.kind === 'ASK'
                ? 'Branch'
                : n.kind === 'DEEPER'
                  ? 'Deeper'
                  : n.kind === 'MIX'
                    ? 'Synthesis'
                    : n.kind === 'PLAN'
                      ? 'Plan'
                      : n.kind === 'CODE'
                        ? 'Commit'
                        : n.kind === 'BRANCH'
                          ? 'Branch'
                          : 'Branch';

            // CODE/BRANCH cards grow upward to fit the commit pill above the title.
            const hasPill = n.kind === 'CODE' || n.kind === 'BRANCH';
            const boxY = hasPill ? -PILL_H : 0;
            const boxH = hasPill ? NODE_H + PILL_H : NODE_H;
            const commitShaShort = n.kind === 'CODE'
              ? (n.commitSha ? n.commitSha.slice(0, 7) : '—')
              : `fork @${(n.commitSha ?? nodes[n.parentId ?? '']?.commitSha ?? '').slice(0, 7) || '—'}`;

            const isMixerBase = mixerMode && n.id === mixerBaseId;
            const isMixerSelected = mixerMode && mixerSelectedIds.includes(n.id);
            const isMixerSelectable = mixerMode && n.id !== mixerBaseId;

            const handleClick = (e: React.MouseEvent) => {
              e.stopPropagation();
              if (mixerMode && isMixerSelectable && onMixerSelect) {
                onMixerSelect(n.id);
              } else if (!mixerMode) {
                onSelect(n.id);
              }
            };

            return (
              <g
                key={n.id}
                ref={el => { if (nodeRefs && el) nodeRefs.current.set(n.id, el); }}
                className={`mm-node${isActive ? ' active' : ''}${isRoot ? ' root' : ''}${loading ? ' loading' : ''}${isRead ? ' read' : ''}${starred ? ' starred' : ''}${isMixerBase ? ' mixer-base' : ''}${isMixerSelected ? ' mixer-selected' : ''}${isMixerSelectable ? ' mixer-selectable' : ''}`}
                data-depth={Math.min(depth, 6)}
                data-kind={n.kind}
                transform={`translate(${p.x} ${p.y})`}
                onClick={handleClick}
                onContextMenu={e => {
                  if (mixerMode) { e.preventDefault(); return; }
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
                        <div className="mm-card-text">
                          <div className="mm-kicker">{kicker}</div>
                          <div className="mm-label" title={n.title || 'Untitled'}>{n.title || 'Untitled'}</div>
                        </div>
                        {n.sources?.length ? <span className="mm-search-badge">🔍</span> : null}
                        {n.kind === 'MIX' ? <span className="mm-mix-badge"><Filter size={11} /></span> : null}
                      </div>
                    </div>
                  </foreignObject>
                </g>
              </g>
            );
          })}
        </g>
      </svg>
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
