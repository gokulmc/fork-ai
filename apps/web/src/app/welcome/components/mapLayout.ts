export interface LayoutNode { id: string; parentId: string | null }
interface LayoutOpts { xStep: number; yStep: number; baseX: number; centerY: number }

// Card size shared by BigMap + Constellation product-style nodes — mirrors
// the real app's MindMap.tsx NODE_W/NODE_H (192×58). Layout callers derive
// xStep/yStep from these plus a gap, matching the real app's DEPTH_GAP (64)
// / SIBLING_GAP (18) tunables, scaled down for the smaller story containers.
export const MM_CARD_W = 192;
export const MM_CARD_H = 58;

export function computeLayout(nodes: LayoutNode[], opts: LayoutOpts) {
  const { xStep, yStep, baseX, centerY } = opts;
  const childMap: Record<string, string[]> = {};
  nodes.forEach(n => { if (n.parentId) (childMap[n.parentId] ??= []).push(n.id); });
  const depthMap: Record<string, number> = {};
  const root = nodes.find(n => n.parentId === null)!;
  (function assignDepth(id: string, d: number) {
    depthMap[id] = d;
    (childMap[id] || []).forEach(c => assignDepth(c, d + 1));
  })(root.id, 0);
  const rawRow: Record<string, number> = {};
  let counter = 0;
  (function place(id: string): number {
    const children = childMap[id] || [];
    if (!children.length) { rawRow[id] = counter++; return rawRow[id]; }
    const rows = children.map(place);
    rawRow[id] = rows.reduce((a, b) => a + b, 0) / rows.length;
    return rawRow[id];
  })(root.id);
  const totalRows = Math.max(counter, 1);
  const pos: Record<string, { x: number; y: number }> = {};
  nodes.forEach(n => {
    pos[n.id] = {
      x: baseX + depthMap[n.id] * xStep,
      y: centerY + (rawRow[n.id] - (totalRows - 1) / 2) * yStep,
    };
  });
  return { pos, depthMap };
}

// Re-centers a computed layout horizontally on the actual node extent so a
// handful of nodes don't sit pinned to the left half of a wide viewBox.
// Shared by ScenePullback and SceneMix — both render the same big map shape.
export function centerLayoutX(pos: Record<string, { x: number; y: number }>, viewW: number) {
  const xs = Object.values(pos).map(p => p.x);
  if (!xs.length) return pos;
  const spanCenter = (Math.min(...xs) + Math.max(...xs)) / 2;
  const offset = viewW / 2 - spanCenter;
  const centered: Record<string, { x: number; y: number }> = {};
  for (const [id, p] of Object.entries(pos)) centered[id] = { x: p.x + offset, y: p.y };
  return centered;
}
