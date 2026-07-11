'use client';
import { useMemo, useState } from 'react';
import { Filter } from '@/components/Icons';
import type { StoryNode } from './StoryContext';
import { NODE_META } from './storyContent';

// Shared big-map SVG renderer used by both ScenePullback (the climax) and
// SceneMix (the mixer). Owns only pan/hover — selection state (if any)
// lives entirely in the caller, passed in as onNodeClick/selected/selectable
// so ScenePullback's behavior stays untouched when those props are omitted.
export const BIG_MAP_VIEW_W = 900;
export const BIG_MAP_VIEW_H = 420;

// Real-product node card dimensions (see apps/web/src/components/MindMap.tsx).
const CARD_W = 192;
const CARD_H = 58;
const CARD_RX = 8;
const FIT_PADDING = 48;

interface BigMapProps {
  nodes: StoryNode[];
  pos: Record<string, { x: number; y: number }>;
  onNodeClick?: (nodeId: string) => void;
  selected?: Set<string>;
  // Nodes the caller won't accept a click for (e.g. the mix node itself, or
  // already-mixed sources) still render normally but skip the clickable
  // cursor/hit behavior.
  selectableIds?: Set<string>;
  caption?: string;
  // Nodes that should show the loading/streaming dashed-pill affordance
  // (e.g. the mix node while its synthesis card is still streaming in).
  streamingIds?: Set<string>;
}

function cardMeta(node: StoryNode): { emoji?: string; title: string; kicker: string } {
  const meta = NODE_META[node.id];
  if (meta) return meta;
  if (node.kind === 'visitor') return { emoji: '', title: node.label, kicker: 'YOUR BRANCH' };
  if (node.kind === 'guest') return { emoji: '', title: node.label, kicker: 'GUEST' };
  return { emoji: '', title: node.label, kicker: 'STORY' };
}

export function BigMap({ nodes, pos, onNodeClick, selected, selectableIds, caption, streamingIds }: BigMapProps) {
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const edges = nodes
    .filter(n => n.parentId)
    .map(n => ({ id: n.id, from: pos[n.parentId!], to: pos[n.id] }));

  // Auto-fit: scale+translate so the current node set (accounting for card
  // extents, not just point positions) fills the viewBox with padding on
  // all sides. Recomputed whenever the node set/positions change. Capped at
  // 1x so a tiny node set doesn't blow up to oversized cards; free to scale
  // down when siblings are wide.
  const fit = useMemo(() => {
    const ps = nodes.map(n => pos[n.id]).filter((p): p is { x: number; y: number } => !!p);
    if (!ps.length) return { scale: 1, tx: 0, ty: 0 };
    const minX = Math.min(...ps.map(p => p.x));
    const maxX = Math.max(...ps.map(p => p.x + CARD_W));
    const minY = Math.min(...ps.map(p => p.y));
    const maxY = Math.max(...ps.map(p => p.y + CARD_H));
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const availW = BIG_MAP_VIEW_W - FIT_PADDING * 2;
    const availH = BIG_MAP_VIEW_H - FIT_PADDING * 2;
    const scale = Math.min(1, availW / Math.max(spanX, 1), availH / Math.max(spanY, 1));
    const contentW = spanX * scale;
    const contentH = spanY * scale;
    const tx = (BIG_MAP_VIEW_W - contentW) / 2 - minX * scale;
    const ty = (BIG_MAP_VIEW_H - contentH) / 2 - minY * scale;
    return { scale, tx, ty };
  }, [nodes, pos]);

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    setDrag({ startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y });
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const clamp = 200;
    setPan({
      x: Math.max(-clamp, Math.min(clamp, drag.panX + dx)),
      y: Math.max(-clamp, Math.min(clamp, drag.panY + dy)),
    });
  }
  function handlePointerUp() {
    setDrag(null);
  }

  return (
    <div className="wp-pullback-map-wrap">
      <svg
        className="wp-pullback-svg"
        viewBox={`0 0 ${BIG_MAP_VIEW_W} ${BIG_MAP_VIEW_H}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <g transform={`translate(${fit.tx} ${fit.ty}) scale(${fit.scale})`}>
          <g transform={`translate(${pan.x} ${pan.y})`}>
            {edges.map(e => {
              const x1 = e.from.x + CARD_W;
              const y1 = e.from.y + CARD_H / 2;
              const x2 = e.to.x;
              const y2 = e.to.y + CARD_H / 2;
              const mx = (x1 + x2) / 2;
              return (
                <path
                  key={e.id}
                  className="wp-mm-edge wp-const-edge-drawn"
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                />
              );
            })}
            {nodes.map(n => {
              const p = pos[n.id];
              if (!p) return null;
              const clickable = !!onNodeClick && (!selectableIds || selectableIds.has(n.id));
              return (
                <BigMapNode
                  key={n.id}
                  node={n}
                  pos={p}
                  onHover={setHoverLabel}
                  onNodeClick={clickable ? onNodeClick : undefined}
                  isSelected={selected?.has(n.id) ?? false}
                  isStreaming={streamingIds?.has(n.id) ?? false}
                />
              );
            })}
          </g>
        </g>
      </svg>
      <div className="wp-pullback-caption">{hoverLabel ?? caption ?? 'drag to pan'}</div>
    </div>
  );
}

// Factored out so callers can drive selection (onNodeClick + isSelected)
// without BigMap owning any selection state itself.
function BigMapNode({
  node,
  pos,
  onHover,
  onNodeClick,
  isSelected,
  isStreaming,
}: {
  node: StoryNode;
  pos: { x: number; y: number };
  onHover: (label: string | null) => void;
  onNodeClick?: (nodeId: string) => void;
  isSelected: boolean;
  isStreaming: boolean;
}) {
  const depth = node.parentId === null ? 0 : node.mix ? 2 : 1;
  const meta = cardMeta(node);
  const selectable = !!onNodeClick;
  return (
    <g
      className={
        'wp-mm-node' +
        (selectable ? ' wp-mm-node-selectable' : '') +
        (isSelected ? ' wp-mm-node-selected' : '')
      }
      data-depth={depth}
      data-guest={node.kind === 'guest' ? 'true' : undefined}
      data-ring={node.ring ? 'true' : undefined}
      transform={`translate(${pos.x} ${pos.y})`}
      onMouseEnter={() => onHover(`${meta.emoji ? meta.emoji + ' ' : ''}${meta.title}`)}
      onMouseLeave={() => onHover(null)}
      onClick={onNodeClick ? () => onNodeClick(node.id) : undefined}
    >
      <g className="wp-mm-anim">
        <rect
          className={'wp-pill' + (isStreaming ? ' wp-pill-streaming' : '')}
          x="0"
          y="0"
          width={CARD_W}
          height={CARD_H}
          rx={CARD_RX}
        />
        <foreignObject x="0" y="0" width={CARD_W} height={CARD_H} className="wp-mm-fo" style={{ pointerEvents: 'none' }}>
          <div className="wp-mm-card">
            <div className="wp-mm-card-ic">{meta.emoji && <span className="wp-mm-emoji">{meta.emoji}</span>}</div>
            <div className="wp-mm-card-text">
              <div className="wp-mm-kicker">{meta.kicker}</div>
              <div className="wp-mm-label">{meta.title}</div>
            </div>
            {node.mix && (
              <span className="wp-mm-mix-badge">
                <Filter size={11} />
              </span>
            )}
          </div>
        </foreignObject>
      </g>
      {isSelected && (
        <text className="wp-mm-check" x={CARD_W - 13} y={17} textAnchor="middle">✓</text>
      )}
      {/* invisible generous hit-area so mobile taps land reliably, covering
          the full card extent rather than just a point */}
      {onNodeClick && <rect className="wp-mm-hit" x="0" y="0" width={CARD_W} height={CARD_H} rx={CARD_RX} />}
    </g>
  );
}
