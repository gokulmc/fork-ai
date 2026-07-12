import type { ForkNode } from './types';

// Shared geometry — also used by MindMap.tsx for rendering (foreignObject/rect sizing).
export const NODE_W = 192;
export const NODE_H = 58;
const DEPTH_GAP = 64;
const SIBLING_GAP = 18;

// Git-graph rail constants, derived from the plain-tree geometry above rather than
// invented magic numbers. RAIL_ROW_GAP (vertical — between same-column rail nodes)
// adds a further 40px over one full node-height-plus-gap so a column's row
// comfortably clears both hanging-subtree headroom accounting (below) and the
// commit-pill's ~22px upward overflow (MindMap.tsx's PILL_H — see the Safari/render
// note there); cards stack vertically within a column, so this is the axis that
// needs the pill clearance. RAIL_COL_GAP (horizontal — between columns) doesn't,
// since neighbouring columns sit side by side, not stacked.
const RAIL_ROW_GAP = NODE_H + DEPTH_GAP + 40;
const RAIL_COL_GAP = NODE_W + DEPTH_GAP;
const RAIL_START_GAP = DEPTH_GAP;
// Horizontal gap from a rail anchor's right edge to its hanging learn
// subtree's side lane — keeps the hang clear of the anchor's own column
// (which grows straight down), see placeHangingSubtreeV below.
const HANG_GAP_X = 48;

export interface LayoutResult {
  pos: Record<string, { x: number; y: number }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  childMap: Record<string, string[]>;
  depthMap: Record<string, number>;
  // Git-graph only: one faint vertical rule per column, spanning its first to
  // last rail node — undefined for the plain layoutTree() result.
  laneRails?: Array<{ x: number; y1: number; y2: number }>;
  // Git-graph only: which column index each node sits in — undefined for the
  // plain layoutTree() result. Used by MindMap's PR flow to tell whether a
  // clicked target node is on a different branch than the PR source.
  colOf?: Record<string, number>;
}

const RAIL_KINDS = new Set<ForkNode['kind']>(['PLAN', 'CODE', 'BRANCH', 'MERGE']);

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

// Max chain depth of a node's hanging (non-rail) subtree — 0 if it has none.
// Learn hangs now extend DOWN from their anchor in NODE_H+DEPTH_GAP steps (see
// placeHangingSubtreeV), so this is the hang's VERTICAL extent — used by
// rowAdvance() to push the next same-column commit clear of the deepest hang row.
function hangDepth(childMap: Record<string, string[]>, id: string): number {
  const kids = childMap[id] || [];
  if (!kids.length) return 0;
  return 1 + Math.max(...kids.map(k => hangDepth(childMap, k)));
}

// Total leaf-row count of a subtree (>=1: a childless node is one row).
function leafRows(childMap: Record<string, string[]>, id: string): number {
  const kids = childMap[id] || [];
  if (!kids.length) return 1;
  let s = 0;
  kids.forEach(k => { s += leafRows(childMap, k); });
  return s;
}

// Total leaf-row count of a node's hanging subtree — 0 if it has none. Learn
// hangs now spread siblings across x in NODE_W+SIBLING_GAP steps (see
// placeHangingSubtreeV), so this is the hang's HORIZONTAL extent — used by the
// column-stacking pass to widen the NEXT column so it clears this one's hang.
function hangRows(childMap: Record<string, string[]>, id: string): number {
  const kids = childMap[id] || [];
  if (!kids.length) return 0;
  let s = 0;
  kids.forEach(k => { s += leafRows(childMap, k); });
  return s;
}

// The vertical step from a rail node to the next node continuing (or forking
// from) its column — the base RAIL_ROW_GAP, widened to clear the node's own
// hanging subtree when that hang's deepest row sits below the base gap.
// Geometry: the deepest hang row sits at `depth * (NODE_H + DEPTH_GAP)` below
// the anchor (placeHangingSubtreeV), its bottom edge is one more NODE_H down,
// and RAIL_START_GAP is left as breathing room before the next commit.
// Hand-check (CODE -> QUERY -> DEEPER, hangDepth = 2, NODE_H=58, DEPTH_GAP=64,
// RAIL_START_GAP=64): 2*(58+64) + 58 + 64 = 366, which beats the base
// RAIL_ROW_GAP (58+64+40 = 162), so the column's next commit is pushed to 366.
function rowAdvance(hangChildMap: Record<string, string[]>, parentId: string): number {
  const depth = hangDepth(hangChildMap, parentId);
  return Math.max(RAIL_ROW_GAP, depth * (NODE_H + DEPTH_GAP) + NODE_H + RAIL_START_GAP);
}

// Places every DESCENDANT of `anchorId` (not anchorId itself, which is already
// positioned) BELOW it, spread horizontally and LEFT-ALIGNED at the anchor's
// own x + a side-lane offset (depth -> y, siblings -> x) — exactly layoutTree()'s
// place() geometry, transposed. One-sided clearance (left-aligned, not centered):
// a rail anchor's column is shared with every other node stacked in it, and
// centering (like the plain layoutTree()) would push siblings both left and
// right, competing with the column's own downward commits on the same axis.
// The side-lane offset (NODE_W + HANG_GAP_X) keeps the whole hang strictly to
// the right of the anchor's column, clear of the column's own straight-down
// growth. Used for the learn (DEEPER/ASK/MIX) subtrees that hang off a rail
// node once its column position is final.
function placeHangingSubtreeV(
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
  function place(id: string, depth: number, leftCol: number) {
    if (depth > 0) {
      pos[id] = {
        x: anchor.x + NODE_W + HANG_GAP_X + leftCol * (NODE_W + SIBLING_GAP),
        y: anchor.y + depth * (NODE_H + DEPTH_GAP),
      };
    }
    let col = leftCol;
    (childMap[id] || []).forEach(k => { place(k, depth + 1, col); col += rows[k]; });
  }
  place(anchorId, 0, 0);
}

// Builds the sub-record of `nodes` reachable from `rootId` without ever crossing
// a rail (PLAN/CODE/BRANCH) node — i.e. the "pre-rail learn tree" from CLAUDE.md's
// task spec. Handed to the plain layoutTree() so the pre-rail tree gets exactly
// the existing, already-correct vertical placement. Only used for a learn root —
// a rail root (see layoutGitGraph) skips this pass entirely.
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

// Git-graph layout — PLAN/CODE/BRANCH/MERGE ride vertical columns (1 column =
// 1 git branch, commits flow downward); learn (QUERY/DEEPER/ASK/MIX) subtrees
// hang BELOW their anchor, in a side lane offset to the right so they never
// collide with the column's own downward commits. Rules (verified against the
// _design/forkai-code prototype's map-git-graph.html allocator):
//   1. A CODE child of a rail parent continues the parent's column (same x,
//      y = parent.y + row advance).
//   2. A BRANCH child always opens a new column at the SAME y as its fork
//      commit — immediate visual feedback of where it forked off — using the
//      lowest free column index, so a column freed up isn't currently possible
//      (single-parent model, no merges; see ADR-0005) but the free-list is
//      kept for when a column concept ever needs reuse. (Left-side placement —
//      branching backward in time — is deferred; that space is owned by
//      earlier columns / the pre-rail tree.)
//   3. Any rail node whose OWN parent is non-rail (a PLAN spawned off root or
//      any deeper learn node) is a new column's first node, anchored clear of
//      the whole pre-rail learn tree's bounding box (not just its immediate
//      parent — the learn tree can be deeper/wider than any single ancestor
//      node). A rail ROOT (imported repo, no learn ancestor at all) instead
//      seeds column 0 directly at (0, 0) — see rootIsRail below.
//   4. Columns stack left-to-right; each column's x clears the previous
//      column's widest hanging learn subtree (root's own hang doesn't push
//      column 0 right, since column 0 sits level with the pre-rail tree, not
//      to its right).
//   5. Hanging learn subtrees attach below their rail anchor only once every
//      rail x is final — EXCEPT a rail root's own hang, which must be placed
//      immediately (before rail placement) so a rail entry point buried under
//      it (e.g. a PLAN spawned from a QUERY hanging off an imported root) has
//      a real y to build on.
//   6. Two rail nodes that independently compute the same y within one column
//      (e.g. two CODE "retry" children of one parent) are pushed apart by
//      RAIL_ROW_GAP via a per-column occupied-y guard — see reserveY below.
// No merge commits exist in this model (single parentId per node) — see
// docs/forkai-code/adr/0005; the column allocator therefore never needs to join
// two columns back together.
export function layoutGitGraph(nodes: Record<string, ForkNode>, rootId: string): LayoutResult {
  if (!nodes[rootId]) return { pos: {}, bounds: computeBounds({}), childMap: {}, depthMap: {} };

  const childMap = buildChildMap(nodes);
  const depthMap = computeDepthMap(childMap, rootId);
  const isRail = (id: string) => RAIL_KINDS.has(nodes[id]?.kind);

  const pos: Record<string, { x: number; y: number }> = {};

  // A single map for "children to hang off this node": for rail nodes, only
  // their non-rail children (the rail children are placed separately, below);
  // for learn nodes, the full childMap entry (always non-rail by construction —
  // the node grammar never lets a learn kind spawn a rail child, except PLAN via
  // the mixer's special plan:true route, which the rail-placement DFS below
  // still finds and repositions correctly regardless of this map's shape).
  const hangChildMap: Record<string, string[]> = { ...childMap };
  Object.keys(childMap).forEach(id => {
    if (isRail(id)) hangChildMap[id] = childMap[id].filter(k => !isRail(k));
  });

  const colUsed: boolean[] = [];
  const colNodeIds: string[][] = [];
  // Same-column y-collision guard (rule 6 above): tracks which y's are already
  // taken within each column so two independently-computed rail placements
  // (e.g. two CODE "retry" children of one parent) never land on top of each
  // other — a latent bug even before this layout flowed downward instead of
  // rightward.
  const colOccupiedY: Record<number, Set<number>> = {};
  function allocateColumn(): number {
    let i = 0;
    while (colUsed[i]) i++;
    colUsed[i] = true;
    colNodeIds[i] = [];
    colOccupiedY[i] = new Set();
    return i;
  }
  function reserveY(col: number, y: number): number {
    const used = colOccupiedY[col];
    while (used.has(y)) y += RAIL_ROW_GAP;
    used.add(y);
    return y;
  }
  const colOf: Record<string, number> = {};

  let learnMaxY = 0;
  const rootIsRail = isRail(rootId);
  if (rootIsRail) {
    // Rail-root support: an imported repo's root commit has no learn ancestor —
    // no pre-rail tree pass. Column 0 starts right at the root.
    pos[rootId] = { x: 0, y: 0 };
    const col = allocateColumn();
    colOf[rootId] = col;
    colNodeIds[col].push(rootId);
    reserveY(col, 0);
    // The root's own learn children (e.g. a QUERY asked directly off the
    // imported commit) hang below it, placed NOW rather than in the shared
    // step 4 pass below — a rail entry point buried under that QUERY (a PLAN
    // synthesized from it) needs a real pos[QUERY] once findRailEntryPoints
    // reaches it next.
    if (hangChildMap[rootId]?.length) placeHangingSubtreeV(hangChildMap, rootId, pos);
  } else {
    const learnNodes = buildLearnOnlyNodes(nodes, rootId);
    const learnResult = layoutTree(learnNodes, rootId);
    Object.assign(pos, learnResult.pos);
    learnMaxY = learnResult.bounds.maxY;
  }

  function placeRail(id: string) {
    const parentId = nodes[id].parentId!;
    const parentIsRail = isRail(parentId);
    let col: number, y: number;
    if (nodes[id].kind === 'BRANCH') {
      // A branch shares its parent's row — immediate visual feedback of where
      // it forked off. Left-side placement (branching backward in time) is
      // deferred; that space is owned by earlier columns / the pre-rail tree.
      col = allocateColumn();
      y = pos[parentId].y;
    } else if (!parentIsRail) {
      col = allocateColumn();
      y = Math.max(learnMaxY + RAIL_START_GAP, pos[parentId].y + rowAdvance(hangChildMap, parentId));
    } else {
      col = colOf[parentId];
      y = pos[parentId].y + rowAdvance(hangChildMap, parentId);
    }
    y = reserveY(col, y);
    colOf[id] = col;
    colNodeIds[col].push(id);
    pos[id] = { x: NaN, y }; // x filled in once every column is stacked (step 3)
    childMap[id].filter(isRail).forEach(placeRail);
  }
  function findRailEntryPoints(id: string) {
    childMap[id].forEach(k => {
      if (isRail(k)) placeRail(k);
      else findRailEntryPoints(k);
    });
  }
  findRailEntryPoints(rootId);

  // 3) Stack columns left-to-right. Column 0 starts level with root (it sits
  // beside the pre-rail tree — or IS the root itself, for a rail root).
  let cursorX = pos[rootId]?.x ?? 0;
  colNodeIds.forEach(ids => {
    ids.forEach(id => { pos[id].x = cursorX; });
    const colHang = Math.max(0, ...ids.map(id => {
      const rows = hangRows(hangChildMap, id);
      return rows > 0 ? rows * (NODE_W + SIBLING_GAP) + HANG_GAP_X : 0;
    }));
    cursorX += RAIL_COL_GAP + colHang;
  });

  // 3.5) MERGE y-alignment post-pass — pulls a MERGE node down to clear its
  // SOURCE node's row (mergeFromNodeId, a second parent that isn't part of
  // childMap/placeRail's tree walk) for a clean near-horizontal merge edge.
  // Must run here, not inline in placeRail: the source may sit on a column
  // placed later in the DFS, so pos[source] isn't reliably available until
  // every rail node has been placed AND stacked (steps 2–3) above. Shifting a
  // MERGE down can collide with whatever already stacked below it in its own
  // column, so every other node in that column with y >= the MERGE's old y is
  // pushed down by the same delta — this keeps relative gaps (and therefore
  // the y-collision guarantee from reserveY) intact. Scope is deliberately
  // limited to the MERGE's own column: a BRANCH forked off a node that ends up
  // shifted here (rare — would require branching off a commit downstream of a
  // merge point) keeps its pre-shift y, which is an accepted simplification.
  Object.keys(nodes).forEach(id => {
    const n = nodes[id];
    if (n.kind !== 'MERGE' || !n.mergeFromNodeId) return;
    const sourcePos = pos[n.mergeFromNodeId];
    if (!sourcePos) return; // source not on the rail — shouldn't happen (createPrNode requires a CODE source)
    const oldY = pos[id].y;
    const newY = Math.max(oldY, sourcePos.y);
    if (newY === oldY) return;
    const delta = newY - oldY;
    const col = colOf[id];
    colNodeIds[col].forEach(otherId => {
      if (otherId !== id && pos[otherId].y >= oldY) pos[otherId].y += delta;
    });
    pos[id].y = newY;
    const shifted = new Set<number>();
    colOccupiedY[col].forEach(y => shifted.add(y >= oldY ? y + delta : y));
    colOccupiedY[col] = shifted;
  });

  // 4) Hang remaining learn subtrees below their now-final rail anchor (a rail
  // root's own hang was already placed above, in step "0").
  Object.keys(nodes).forEach(id => {
    if (isRail(id) && id !== rootId && hangChildMap[id]?.length) placeHangingSubtreeV(hangChildMap, id, pos);
  });

  // 5) Column rail lines — one per non-empty column, spanning its first to last node.
  const laneRails = colNodeIds
    .filter(ids => ids.length > 0)
    .map(ids => ({
      x: pos[ids[0]].x + NODE_W / 2,
      y1: pos[ids[0]].y - 24,
      y2: pos[ids[ids.length - 1]].y + NODE_H + 24,
    }));

  return { pos, bounds: computeBounds(pos), childMap, depthMap, laneRails, colOf };
}
