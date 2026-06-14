'use client';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { ForkNode } from '@/lib/types';
import { clamp } from '@/lib/utils';
import { Hash, Sparkles, CornerDownRight, GitBranch, Map, Minus, Plus, Maximize, Copy } from './Icons';

const NODE_W = 192;
const NODE_H = 58;
const DEPTH_GAP = 64;
const SIBLING_GAP = 18;
const PAD = 48;
const RX = 8;

// A bracket tracing only the top-right rounded-corner (chamfer) arc of the
// pill — drawn bold/accent on nodes that have been read (see globals.css).
function topRightBracket(w: number, r: number, ext: number): string {
  return `M ${w - r - ext} 0 L ${w - r} 0 A ${r} ${r} 0 0 1 ${w} ${r} L ${w} ${r + ext}`;
}
const READ_CORNERS = topRightBracket(NODE_W, RX, 1);

// A thick bar on the left edge — marks a starred/important node (see globals.css).
// Centred on the border (x=0) so it concentrically thickens it, like the read marker.
const STAR_EDGE = `M 0 ${RX} L 0 ${NODE_H - RX}`;

interface LayoutResult {
  pos: Record<string, { x: number; y: number }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  childMap: Record<string, string[]>;
  depthMap: Record<string, number>;
}

function layoutTree(
  nodes: Record<string, ForkNode>,
  rootId: string,
  layout: 'vertical' | 'horizontal',
): LayoutResult {
  const childMap: Record<string, string[]> = {};
  Object.values(nodes).forEach(n => { childMap[n.id] = []; });
  Object.values(nodes).forEach(n => {
    if (n.parentId && childMap[n.parentId]) childMap[n.parentId].push(n.id);
  });
  Object.keys(childMap).forEach(k => {
    childMap[k].sort((a, b) => (nodes[a]?.createdAt ?? 0) - (nodes[b]?.createdAt ?? 0));
  });

  const depthMap: Record<string, number> = {};
  function setDepth(id: string, d: number) {
    depthMap[id] = d;
    (childMap[id] || []).forEach(k => setDepth(k, d + 1));
  }
  if (nodes[rootId]) setDepth(rootId, 0);

  const subtreeRows: Record<string, number> = {};
  function leaves(id: string): number {
    if (subtreeRows[id] !== undefined) return subtreeRows[id];
    const kids = childMap[id] || [];
    if (kids.length === 0) { subtreeRows[id] = 1; return 1; }
    let s = 0;
    kids.forEach(k => { s += leaves(k); });
    subtreeRows[id] = s;
    return s;
  }
  leaves(rootId);

  const pos: Record<string, { x: number; y: number }> = {};
  function place(id: string, depth: number, topRow: number) {
    const rows = subtreeRows[id];
    const centerRow = topRow + rows / 2;
    if (layout === 'vertical') {
      pos[id] = {
        x: centerRow * (NODE_W + SIBLING_GAP),
        y: depth * (NODE_H + DEPTH_GAP),
      };
    } else {
      pos[id] = {
        x: depth * (NODE_W + DEPTH_GAP),
        y: centerRow * (NODE_H + SIBLING_GAP),
      };
    }
    let row = topRow;
    (childMap[id] || []).forEach(k => {
      place(k, depth + 1, row);
      row += subtreeRows[k];
    });
  }
  place(rootId, 0, 0);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  Object.values(pos).forEach(p => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + NODE_W);
    maxY = Math.max(maxY, p.y + NODE_H);
  });

  return { pos, bounds: { minX, minY, maxX, maxY }, childMap, depthMap };
}

interface MindMapProps {
  nodes: Record<string, ForkNode>;
  rootId: string;
  activeId: string | null;
  onSelect: (id: string) => void;
  onContextMenu?: (id: string, x: number, y: number) => void;
  layout?: 'vertical' | 'horizontal';
  loadingIds?: Set<string>;
  readIds?: Set<string>;
  onSaveToNotion?: () => void;
  notionSaving?: boolean;
  notionSavedUrl?: string | null;
  notionError?: string | null;
  onClearNotionError?: () => void;
}

export function MindMap({
  nodes,
  rootId,
  activeId,
  onSelect,
  onContextMenu,
  layout = 'vertical',
  loadingIds = new Set(),
  readIds = new Set(),
  onSaveToNotion,
  notionSaving = false,
  notionSavedUrl = null,
  notionError = null,
  onClearNotionError,
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

  const { pos, bounds, childMap, depthMap } = useMemo(
    () => layoutTree(nodes, rootId, layout),
    [nodes, rootId, layout],
  );

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
    const layoutKey = `${layout}|${size.w}x${size.h}`;
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
  }, [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, size.w, size.h, layout, nodes]);

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

  const edges: { pid: string; cid: string; d: string }[] = [];
  Object.keys(childMap).forEach(pid => {
    childMap[pid].forEach(cid => {
      const a = pos[pid], b = pos[cid];
      if (!a || !b) return;
      if (layout === 'vertical') {
        const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H;
        const x2 = b.x + NODE_W / 2, y2 = b.y;
        const my = (y1 + y2) / 2;
        edges.push({ pid, cid, d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}` });
      } else {
        const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
        const x2 = b.x, y2 = b.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        edges.push({ pid, cid, d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}` });
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
    return GitBranch;
  }

  const nodeCount = Object.keys(nodes).length;

  return (
    <>
      <div className="mindmap-header" data-tour="tour-mindmap">
        <span className="label">
          <Map size={13} />
          {nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}
        </span>
        {onSaveToNotion && (
          <button
            data-tour="tour-notion"
            className={`mm-copy-btn${notionSavedUrl ? ' mm-copy-btn--copied' : notionError ? ' mm-copy-btn--error' : ''}`}
            onClick={notionSavedUrl
              ? () => window.open(notionSavedUrl, '_blank')
              : notionError
                ? () => { onClearNotionError?.(); onSaveToNotion(); }
                : onSaveToNotion}
            disabled={notionSaving}
            title={notionError ?? 'Save to Notion'}
            style={{ pointerEvents: 'auto' }}
          >
            <Copy size={13} />
            {notionSaving ? 'Saving…' : notionSavedUrl ? 'Open in Notion ↗' : notionError ? notionError : 'Save to Notion'}
          </button>
        )}
        <div className="zoom">
          <button onClick={() => zoomBy(0.85)} title="Zoom out"><Minus size={13} /></button>
          <span className="val">{Math.round(view.scale * 100)}%</span>
          <button onClick={() => zoomBy(1.15)} title="Zoom in"><Plus size={13} /></button>
          <button onClick={fitView} title="Fit to view"><Maximize size={13} /></button>
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
          {edges.map((e, i) => (
            <path key={i} d={e.d} className={`branch${isOnPath(e.pid, e.cid) ? ' active' : ''}`} />
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
                  : 'Branch';
            return (
              <g
                key={n.id}
                className={`mm-node${isActive ? ' active' : ''}${isRoot ? ' root' : ''}${loading ? ' loading' : ''}${isRead ? ' read' : ''}${starred ? ' starred' : ''}`}
                data-depth={Math.min(depth, 6)}
                transform={`translate(${p.x} ${p.y})`}
                onClick={e => { e.stopPropagation(); onSelect(n.id); }}
                onContextMenu={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  onContextMenu?.(n.id, e.clientX, e.clientY);
                }}
              >
                <rect className="pill" x="0" y="0" width={NODE_W} height={NODE_H} rx={RX} />
                {isRead && <path className="pill-read" d={READ_CORNERS} />}
                {starred && <path className="pill-star" d={STAR_EDGE} />}
                <foreignObject x="0" y="0" width={NODE_W} height={NODE_H} className="mm-fo">
                  <div className="mm-card">
                    <div className="mm-card-ic">
                      {n.emoji
                        ? <span className="mm-emoji">{n.emoji}</span>
                        : <NodeIcon size={16} />}
                    </div>
                    <div className="mm-card-text">
                      <div className="mm-kicker">{kicker}</div>
                      <div className="mm-label" title={n.title || 'Untitled'}>{n.title || 'Untitled'}</div>
                    </div>
                    {n.sources?.length ? <span className="mm-search-badge">🔍</span> : null}
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </g>
      </svg>
    </>
  );
}
