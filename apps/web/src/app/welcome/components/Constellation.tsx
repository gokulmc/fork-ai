'use client';
import { useMemo, useRef, useState } from 'react';
import { useStory, type StoryNode } from './StoryContext';
import { computeLayout } from './mapLayout';
import { NODE_META } from './storyContent';

// Cards render at the real product's native 192x58 size; the dock frame
// stays tiny by numerically shrinking the viewBox (not the cards) so the
// SVG's own intrinsic scaling shrinks everything — foreignObject content
// included — proportionally. ~0.45x scale overall.
const CARD_W = 192;
const CARD_H = 58;
const CARD_RX = 8;
const VIEW_W = 620;
const VIEW_H = 380;
const ROOT: StoryNode = { id: 'root', parentId: null, label: 'Alex’s question', kind: 'story' };

function cardMeta(node: StoryNode): { emoji?: string; title: string; kicker: string } {
  const meta = NODE_META[node.id];
  if (meta) return meta;
  if (node.kind === 'visitor') return { emoji: '', title: node.label, kicker: 'YOUR BRANCH' };
  if (node.kind === 'guest') return { emoji: '', title: node.label, kicker: 'GUEST' };
  return { emoji: '', title: node.label, kicker: 'STORY' };
}

export function Constellation() {
  const { nodes } = useStory();
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // SceneQuestion adds its own `id: 'root'` node once the visitor scrolls to
  // it; until then, show the static placeholder root so the dock isn't empty.
  const allNodes = useMemo(
    () => (nodes.some(n => n.id === 'root') ? nodes : [ROOT, ...nodes]),
    [nodes]
  );

  // Own smaller coordinate space (not a scaled copy of BigMap's) — tuned so
  // ~7 nodes (root + moderating-factors + up to 3 visitor highlights +
  // web-branch + advisor) stay non-overlapping at native card size.
  const { pos } = useMemo(
    () => computeLayout(allNodes, { xStep: 230, yStep: 84, baseX: 20, centerY: VIEW_H / 2 }),
    [allNodes]
  );

  const edges = useMemo(
    () =>
      allNodes
        .filter(n => n.parentId)
        .map(n => ({ id: n.id, from: pos[n.parentId!], to: pos[n.id] })),
    [allNodes, pos]
  );

  const isEmpty = nodes.length === 0;

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const clamp = 60;
    setPan({
      x: Math.max(-clamp, Math.min(clamp, dragRef.current.panX + dx)),
      y: Math.max(-clamp, Math.min(clamp, dragRef.current.panY + dy)),
    });
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  return (
    <div className="wp-const" role="complementary" aria-label="Session map">
      <span className="wp-const-cap">SESSION MAP</span>
      <div className="wp-const-frame">
        <svg
          className="wp-const-svg"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
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
            {allNodes.map(n => {
              const p = pos[n.id];
              if (!p) return null;
              const isRoot = n.id === 'root';
              const meta = cardMeta(n);
              const depth = n.parentId === null ? 0 : n.mix ? 2 : 1;
              return (
                <g
                  key={n.id}
                  className="wp-mm-node wp-const-node-g"
                  data-depth={depth}
                  data-guest={n.kind === 'guest' ? 'true' : undefined}
                  data-ring={n.ring ? 'true' : undefined}
                  transform={`translate(${p.x} ${p.y})`}
                  onMouseEnter={() => setHoverLabel(`${meta.emoji ? meta.emoji + ' ' : ''}${meta.title}`)}
                  onMouseLeave={() => setHoverLabel(null)}
                >
                  <g className="wp-mm-anim">
                    {isEmpty && isRoot && <circle className="wp-const-pulse" cx={CARD_W / 2} cy={CARD_H / 2} r={4} />}
                    <rect className="wp-pill" x="0" y="0" width={CARD_W} height={CARD_H} rx={CARD_RX} />
                    <foreignObject x="0" y="0" width={CARD_W} height={CARD_H} className="wp-mm-fo" style={{ pointerEvents: 'none' }}>
                      <div className="wp-mm-card">
                        <div className="wp-mm-card-ic">{meta.emoji && <span className="wp-mm-emoji">{meta.emoji}</span>}</div>
                        <div className="wp-mm-card-text">
                          <div className="wp-mm-kicker">{meta.kicker}</div>
                          <div className="wp-mm-label">{meta.title}</div>
                        </div>
                      </div>
                    </foreignObject>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <div className="wp-const-caption">
        {hoverLabel ?? (isEmpty ? '9:02 PM — nothing yet' : `${nodes.length + 1} nodes`)}
      </div>
    </div>
  );
}
