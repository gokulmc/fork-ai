import { ImageResponse } from 'next/og';
import { LOGO_DATA_URL } from './og-logo';
import { size, OG_BG, OG_CARD, OG_BORDER, OG_INK, OG_SUB, OG_MUTED, OG_PANEL, OG_DIVIDER } from './og-card';

export const SHARE_OG_CACHE_CONTROL = 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400';

interface ShareNode {
  nodeId: string;
  parentId?: string | null;
  title: string;
  emoji?: string | null;
}

export interface ShareSession {
  title: string;
  emoji?: string | null;
  lede: string;
  shareHook?: string | null;
  nodeCount: number;
  nodes: ShareNode[];
}

const MAP_W = 460;
const MAP_H = 390;
const PILL_H = 36;
const ROOT_W = 150;
const BRANCH_W = 130;
// Conservative char caps so emoji + label + ellipsis fit inside the pill width
// at the rendered font size — satori clips overflow with no ellipsis fallback
// if the untruncated label is wider than the box.
const ROOT_CHARS = 13;
const BRANCH_CHARS = 10;

function truncate(s: string, n: number): string {
  const chars = Array.from(s);
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : s;
}

function pillLabel(n: { title: string; emoji?: string | null }, maxChars: number): string {
  const t = truncate(n.title, maxChars);
  return n.emoji ? `${n.emoji} ${t}` : t;
}

interface MapPill {
  key: string;
  x: number;
  cy: number;
  width: number;
  label: string;
  variant: 'root' | 'branch' | 'ghost';
}

interface MapEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Deterministic mini mind-map layout: root pill + up to 4 first-level branches
// + up to 3 second-level branches (one per shown branch), with a dashed
// "+N more" pill absorbing whatever didn't fit. Tolerates 1–50+ node sessions.
function layoutMap(session: ShareSession): { pills: MapPill[]; edges: MapEdge[] } {
  const root = session.nodes.find(n => !n.parentId) ?? session.nodes[0];
  if (!root) return { pills: [], edges: [] };

  const byParent = new Map<string, ShareNode[]>();
  for (const n of session.nodes) {
    if (!n.parentId) continue;
    if (!byParent.has(n.parentId)) byParent.set(n.parentId, []);
    byParent.get(n.parentId)!.push(n);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));

  const l1 = (byParent.get(root.nodeId) ?? []).slice(0, 4);
  const l2: { node: ShareNode; parentIndex: number }[] = [];
  for (let i = 0; i < l1.length && l2.length < 3; i++) {
    const kids = byParent.get(l1[i].nodeId) ?? [];
    if (kids.length) l2.push({ node: kids[0], parentIndex: i });
  }
  const hidden = session.nodes.length - (1 + l1.length + l2.length);
  const hasGhost = hidden > 0;

  if (l1.length === 0) {
    return {
      pills: [{ key: root.nodeId, x: (MAP_W - ROOT_W) / 2, cy: MAP_H / 2, width: ROOT_W, label: pillLabel(root, ROOT_CHARS), variant: 'root' }],
      edges: [],
    };
  }

  const rows = l1.length + (hasGhost ? 1 : 0);
  const rowCy = (i: number) => (MAP_H * (i + 1)) / (rows + 1);

  const pills: MapPill[] = [];
  const edges: MapEdge[] = [];
  const rootCy = MAP_H / 2;
  const rootX = 0;
  const l1X = 170;
  const l2X = 330;

  pills.push({ key: root.nodeId, x: rootX, cy: rootCy, width: ROOT_W, label: pillLabel(root, ROOT_CHARS), variant: 'root' });

  l1.forEach((n, i) => {
    const cy = rowCy(i);
    pills.push({ key: n.nodeId, x: l1X, cy, width: BRANCH_W, label: pillLabel(n, BRANCH_CHARS), variant: 'branch' });
    edges.push({ x1: rootX + ROOT_W, y1: rootCy, x2: l1X, y2: cy });
  });

  l2.forEach(({ node, parentIndex }) => {
    const cy = rowCy(parentIndex);
    pills.push({ key: node.nodeId, x: l2X, cy, width: BRANCH_W, label: pillLabel(node, BRANCH_CHARS), variant: 'branch' });
    edges.push({ x1: l1X + BRANCH_W, y1: cy, x2: l2X, y2: cy });
  });

  if (hasGhost) {
    pills.push({ key: 'ghost', x: l1X, cy: rowCy(l1.length), width: BRANCH_W, label: `+${hidden} more`, variant: 'ghost' });
  }

  return { pills, edges };
}

export function shareCard(session: ShareSession) {
  const hook = (session.shareHook || session.lede || session.title || '').trim();
  const hookSize = hook.length <= 90 ? 46 : hook.length <= 140 ? 38 : 32;
  const eyebrow = `${session.emoji ? `${session.emoji} ` : ''}${truncate(session.title, 48)}`;
  const { pills, edges } = layoutMap(session);
  const branchLabel = session.nodeCount === 1 ? '1 branch' : `${session.nodeCount} branches`;

  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: OG_BG, padding: 48 }}>
        <div
          style={{
            display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
            background: OG_CARD, border: `1px solid ${OG_BORDER}`, borderRadius: 28, overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '28px 48px', borderBottom: `1px solid ${OG_DIVIDER}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={LOGO_DATA_URL} width={48} height={48} style={{ borderRadius: 10 }} alt="" />
              <div style={{ marginLeft: 14, fontSize: 26, fontWeight: 700, color: OG_INK, letterSpacing: -0.5 }}>fork ai</div>
            </div>
            <div style={{ display: 'flex', fontSize: 18, color: OG_MUTED, letterSpacing: 2, textTransform: 'uppercase' }}>research map</div>
          </div>

          {/* Body */}
          <div style={{ display: 'flex', flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', padding: '0 32px 0 48px' }}>
              <div style={{ display: 'flex', fontSize: 24, color: OG_SUB, marginBottom: 18, lineHeight: 1.3 }}>{eyebrow}</div>
              <div style={{ display: 'flex', fontSize: hookSize, fontWeight: 600, color: OG_INK, lineHeight: 1.2 }}>{truncate(hook, 200)}</div>
            </div>
            <div style={{ display: 'flex', width: MAP_W, height: MAP_H, position: 'relative', margin: 'auto 40px' }}>
              <svg width={MAP_W} height={MAP_H} style={{ position: 'absolute', top: 0, left: 0 }}>
                {edges.map((e, i) => (
                  <path
                    key={i}
                    d={`M ${e.x1} ${e.y1} C ${(e.x1 + e.x2) / 2} ${e.y1}, ${(e.x1 + e.x2) / 2} ${e.y2}, ${e.x2} ${e.y2}`}
                    stroke="#d6d3d1"
                    strokeWidth={2}
                    fill="none"
                  />
                ))}
              </svg>
              {pills.map(p => (
                <div
                  key={p.key}
                  style={{
                    display: 'flex', position: 'absolute', left: p.x, top: p.cy - PILL_H / 2, height: PILL_H,
                    maxWidth: p.width, alignItems: 'center', justifyContent: 'center', padding: '0 12px',
                    borderRadius: 999, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 15,
                    background: p.variant === 'root' ? OG_INK : p.variant === 'ghost' ? 'transparent' : OG_PANEL,
                    color: p.variant === 'root' ? '#ffffff' : p.variant === 'ghost' ? OG_MUTED : OG_INK,
                    border: p.variant === 'branch' ? `1px solid ${OG_BORDER}` : p.variant === 'ghost' ? `2px dashed ${OG_BORDER}` : 'none',
                  }}
                >
                  {p.label}
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '22px 48px', background: OG_PANEL, borderTop: `1px solid ${OG_DIVIDER}`, fontSize: 20, color: OG_MUTED,
            }}
          >
            <div style={{ display: 'flex' }}>{branchLabel}</div>
            <div style={{ display: 'flex' }}>forkai.in</div>
          </div>
        </div>
      </div>
    ),
    { ...size, emoji: 'twemoji', headers: { 'Cache-Control': SHARE_OG_CACHE_CONTROL } },
  );
}
