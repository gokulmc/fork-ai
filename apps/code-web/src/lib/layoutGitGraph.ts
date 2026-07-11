import type { ForkNode } from './types';

// Shared geometry — also used by MindMap.tsx for rendering (foreignObject/rect sizing).
export const NODE_W = 192;
export const NODE_H = 58;
const DEPTH_GAP = 64;
const SIBLING_GAP = 18;

// Git-graph rail constants, derived from the plain-tree geometry above rather than
// invented magic numbers: RAIL_COL_GAP is one node-width plus the standard depth
// gap (same rhythm as the learn tree's depth spacing); RAIL_ROW_GAP adds a further
// 40px over one full node-height-plus-gap so a lane's row comfortably clears both
// hanging-subtree headroom accounting (below) and the commit-pill's ~22px upward
// overflow (MindMap.tsx's PILL_H — see the Safari/render note there).
const RAIL_COL_GAP = NODE_W + DEPTH_GAP;
const RAIL_ROW_GAP = NODE_H + DEPTH_GAP + 40;
const RAIL_START_GAP = DEPTH_GAP;

export interface LayoutResult {
  pos: Record<string, { x: number; y: number }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  childMap: Record<string, string[]>;
  depthMap: Record<string, number>;
  // Git-graph only: one faint horizontal rule per lane, spanning its first to
  // last rail node — undefined for the plain layoutTree() result.
  laneRails?: Array<{ y: number; x1: number; x2: number }>;
}

const RAIL_KINDS = new Set<ForkNode['kind']>(['PLAN', 'CODE', 'BRANCH']);

export function hasRailNode(nodes: Record<string, ForkNode>): boolean {
  return Object.values(nodes).some(n => RAIL_KINDS.has(n.kind));
}

function buildChildMap(nodes: Record<string, ForkNode>): Record<string, string[]> {
  const childMap: Record<string, string[]> = {};
  Object.values(nodes).forEach(n => { childMap[n.id] = []; });
  Object.values(nodes).forEach(n => {
    if (n.parentId && childMap[n.parentId]) childMap[n.parentId].push(n.id);
  });
  Object.keys(childMap).forEach(k => {
    childMap[k].sort((a, b) => (nodes[a]?.createdAt ?? 0) - (nodes[b]?.createdAt ?? 0));
  });
  return childMap;
}

function computeDepthMap(childMap: Record<string, string[]>, rootId: string): Record<string, number> {
  const depthMap: Record<string, number> = {};
  function setDepth(id: string, d: number) {
    depthMap[id] = d;
    (childMap[id] || []).forEach(k => setDepth(k, d + 1));
  }
  if (childMap[rootId] !== undefined) setDepth(rootId, 0);
  return depthMap;
}

function computeBounds(pos: Record<string, { x: number; y: number }>): LayoutResult['bounds'] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  Object.values(pos).forEach(p => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + NODE_W);
    maxY = Math.max(maxY, p.y + NODE_H);
  });
  return { minX, minY, maxX, maxY };
}

// Plain vertical mind-map layout: children spread horizontally below their parent,
// row position weighted by subtree leaf count so lopsided subtrees don't overlap.
// Used standalone for pure-learn sessions, and as the pre-rail tree inside
// layoutGitGraph() (see there).
export function layoutTree(nodes: Record<string, ForkNode>, rootId: string): LayoutResult {
  const childMap = buildChildMap(nodes);
  const depthMap = computeDepthMap(childMap, rootId);

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
  if (nodes[rootId]) leaves(rootId);

  const pos: Record<string, { x: number; y: number }> = {};
  function place(id: string, depth: number, topRow: number) {
    const rows = subtreeRows[id];
    const centerRow = topRow + rows / 2;
    pos[id] = { x: centerRow * (NODE_W + SIBLING_GAP), y: depth * (NODE_H + DEPTH_GAP) };
    let row = topRow;
    (childMap[id] || []).forEach(k => { place(k, depth + 1, row); row += subtreeRows[k]; });
  }
  if (nodes[rootId]) place(rootId, 0, 0);

  return { pos, bounds: computeBounds(pos), childMap, depthMap };
}

// Places every DESCENDANT of `anchorId` (not anchorId itself, which is already
// positioned) below it, spread horizontally around the anchor's own x using the
// same leaf-count weighting as layoutTree. Used for the learn (DEEPER/ASK/MIX)
// subtrees that hang off a rail node once its lane position is final.
function placeHangingSubtree(
  childMap: Record<string, string[]>,
  anchorId: string,
  pos: Record<string, { x: number; y: number }>,
): void {
  const rows: Record<string, number> = {};
  function leaves(id: string): number {
    if (rows[id] !== undefined) return rows[id];
    const kids = childMap[id] || [];
    if (kids.length === 0) { rows[id] = 1; return 1; }
    let s = 0;
    kids.forEach(k => { s += leaves(k); });
    rows[id] = s;
    return s;
  }
  leaves(anchorId);

  const anchor = pos[anchorId];
  function place(id: string, depth: number, topRow: number) {
    if (depth > 0) {
      const centerRow = topRow + rows[id] / 2;
      pos[id] = {
        x: anchor.x + (centerRow - rows[anchorId] / 2) * (NODE_W + SIBLING_GAP),
        y: anchor.y + depth * (NODE_H + DEPTH_GAP),
      };
    }
    let row = topRow;
    (childMap[id] || []).forEach(k => { place(k, depth + 1, row); row += rows[k]; });
  }
  place(anchorId, 0, 0);
}

function hangDepth(childMap: Record<string, string[]>, id: string): number {
  const kids = childMap[id] || [];
  if (!kids.length) return 0;
  return 1 + Math.max(...kids.map(k => hangDepth(childMap, k)));
}

// Builds the sub-record of `nodes` reachable from `rootId` without ever crossing
// a rail (PLAN/CODE/BRANCH) node — i.e. the "pre-rail learn tree" from CLAUDE.md's
// task spec. Handed to the plain layoutTree() so the pre-rail tree gets exactly
// the existing, already-correct vertical placement.
function buildLearnOnlyNodes(nodes: Record<string, ForkNode>, rootId: string): Record<string, ForkNode> {
  const out: Record<string, ForkNode> = {};
  function walk(id: string) {
    const n = nodes[id];
    if (!n) return;
    out[id] = n;
    Object.values(nodes).forEach(c => {
      if (c.parentId === id && !RAIL_KINDS.has(c.kind)) walk(c.id);
    });
  }
  walk(rootId);
  return out;
}

// Git-graph layout — PLAN/CODE/BRANCH ride horizontal lanes (1 lane = 1 git
// branch); learn (QUERY/DEEPER/ASK/MIX) subtrees hang below their anchor, same
// geometry as layoutTree. Rules (verified against the _design/forkai-code
// prototype's map-git-graph.html allocator):
//   1. A CODE child of a rail parent continues the parent's lane (same y,
//      x = parent.x + column pitch).
//   2. A BRANCH child always opens a new lane — lowest free lane index, so a
//      lane freed up isn't currently possible (single-parent model, no merges;
//      see ADR-0005) but the free-list is kept for when a lane concept ever
//      needs reuse.
//   3. Any rail node whose OWN parent is non-rail (a PLAN spawned off root or
//      any deeper learn node) is a new lane's first node, anchored clear of the
//      whole pre-rail learn tree's bounding box (not just its immediate parent —
//      the learn tree can be deeper/wider than any single ancestor node).
//   4. Lanes stack top-to-bottom; each lane's y clears the previous lane's
//      deepest hanging learn subtree (root's own hang doesn't push lane 0 down,
//      since lane 0 sits BESIDE the pre-rail tree, not below it).
//   5. Hanging learn subtrees attach below their rail anchor only once every
//      rail y is final.
// No merge commits exist in this model (single parentId per node) — see
// docs/forkai-code/adr/0005; the lane allocator therefore never needs to join
// two lanes back together.
export function layoutGitGraph(nodes: Record<string, ForkNode>, rootId: string): LayoutResult {
  if (!nodes[rootId]) return { pos: {}, bounds: computeBounds({}), childMap: {}, depthMap: {} };

  const childMap = buildChildMap(nodes);
  const depthMap = computeDepthMap(childMap, rootId);
  const isRail = (id: string) => RAIL_KINDS.has(nodes[id]?.kind);

  const pos: Record<string, { x: number; y: number }> = {};

  // 1) Pre-rail learn tree, via the existing vertical algorithm.
  const learnNodes = buildLearnOnlyNodes(nodes, rootId);
  const learnResult = layoutTree(learnNodes, rootId);
  Object.assign(pos, learnResult.pos);
  const learnMaxX = learnResult.bounds.maxX;

  // A single map for "children to hang below this node": for rail nodes, only
  // their non-rail children (the rail children are placed separately, below);
  // for learn nodes, the full childMap entry (always non-rail by construction —
  // the node grammar never lets a learn kind spawn a rail child).
  const hangChildMap: Record<string, string[]> = { ...childMap };
  Object.keys(childMap).forEach(id => {
    if (isRail(id)) hangChildMap[id] = childMap[id].filter(k => !isRail(k));
  });

  // 2) Rail placement — find every rail "entry point" (a rail node whose parent
  // is non-rail) anywhere under rootId, then DFS each one's own rail descendants.
  const laneUsed: boolean[] = [];
  const laneNodeIds: string[][] = [];
  function allocateLane(): number {
    let i = 0;
    while (laneUsed[i]) i++;
    laneUsed[i] = true;
    laneNodeIds[i] = [];
    return i;
  }
  const laneOf: Record<string, number> = {};

  function placeRail(id: string) {
    const parentId = nodes[id].parentId!;
    const parentIsRail = isRail(parentId);
    let lane: number, x: number;
    if (nodes[id].kind === 'BRANCH') {
      // Full-column offset (not a half-column) — simpler edge routing for the
      // fork elbow at a small readability cost the design bundle left as an
      // open call; see report.
      lane = allocateLane();
      x = pos[parentId].x + RAIL_COL_GAP;
    } else if (!parentIsRail) {
      lane = allocateLane();
      x = Math.max(learnMaxX + RAIL_START_GAP, pos[parentId].x + RAIL_COL_GAP);
    } else {
      lane = laneOf[parentId];
      x = pos[parentId].x + RAIL_COL_GAP;
    }
    laneOf[id] = lane;
    laneNodeIds[lane].push(id);
    pos[id] = { x, y: NaN }; // y filled in once every lane is stacked (step 3)
    childMap[id].filter(isRail).forEach(placeRail);
  }
  function findRailEntryPoints(id: string) {
    childMap[id].forEach(k => {
      if (isRail(k)) placeRail(k);
      else findRailEntryPoints(k);
    });
  }
  findRailEntryPoints(rootId);

  // 3) Stack lanes top-to-bottom. Lane 0 starts level with root (it sits beside
  // the pre-rail tree, not below it — root's own hang doesn't apply here).
  let cursorY = pos[rootId]?.y ?? 0;
  laneNodeIds.forEach(ids => {
    ids.forEach(id => { pos[id].y = cursorY; });
    const laneHang = Math.max(0, ...ids.map(id => hangDepth(hangChildMap, id)));
    cursorY += RAIL_ROW_GAP + laneHang * (NODE_H + DEPTH_GAP);
  });

  // 4) Hang learn subtrees below their now-final rail anchor.
  Object.keys(nodes).forEach(id => {
    if (isRail(id) && hangChildMap[id]?.length) placeHangingSubtree(hangChildMap, id, pos);
  });

  // 5) Lane rail lines — one per non-empty lane, spanning its first to last node.
  const laneRails = laneNodeIds
    .filter(ids => ids.length > 0)
    .map(ids => ({
      y: pos[ids[0]].y + NODE_H / 2,
      x1: pos[ids[0]].x - 24,
      x2: pos[ids[ids.length - 1]].x + NODE_W + 24,
    }));

  return { pos, bounds: computeBounds(pos), childMap, depthMap, laneRails };
}
