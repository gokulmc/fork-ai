// Standalone verification for layoutGitGraph() — no test runner is configured
// for apps/code-web yet, so this is run directly via `npx tsx scripts/verify-layout.ts`.
// Two fixtures:
//   1. Learn-root — root (learn) + 2 learn children + a PLAN (also learn-shaped —
//      PLAN is NOT a rail kind, see layoutGitGraph's RAIL_KINDS) that hangs under
//      root like any learn node
//        -> PLAN -> 3 CODE (new column, since a CODE built from a PLAN is the
//                     first rail node on this path)
//                     CODE#2 -> BRANCH -> 2 CODE (column 1)
//                     CODE#2 -> 2-node learn subtree (hangs left of CODE#2)
//   2. Rail-root — CODE root (imported) -> CODE head child (column 0)
//                    root -> QUERY (hangs left of root) -> PLAN (learn-shaped,
//                    hangs off QUERY) -> CODE (new column) -> CODE
//   3. Column-gap tightening — column 0 has TWO right-hangs at different
//      depths: a narrow one (1 leaf) whose rows overlap column 1's rail
//      boxes, and a wide one (2 leaves) whose rows sit well below column 1's
//      last node. Proves extraColGap() (a) still reserves enough width to
//      clear the overlapping narrow hang and (b) does NOT widen the gap for
//      the wider hang that never actually contests column 1's space — the
//      old unconditional-max formula would have sized the gap off the wider
//      one regardless of row overlap.
import { layoutGitGraph, NODE_W, NODE_H } from '../src/lib/layoutGitGraph';
import type { ForkNode } from '../src/lib/types';

let seq = 0;
function mkNode(id: string, parentId: string | null, kind: ForkNode['kind'], extra: Partial<ForkNode> = {}): ForkNode {
  seq += 1;
  return {
    id,
    parentId,
    kind,
    title: id,
    emoji: null,
    query: id,
    lede: '',
    sections: [],
    fromSection: null,
    fromText: null,
    createdAt: seq, // creation order == id order below, matches childMap's createdAt sort
    loading: false,
    ...extra,
  };
}

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ok   ${msg}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${msg}`);
  }
}

// ── Fixture 1: learn-root ────────────────────────────────────────────────────

console.log('layoutGitGraph verification — fixture 1: learn root');

const nodeList: ForkNode[] = [
  mkNode('root', null, 'QUERY'),
  mkNode('learn1', 'root', 'DEEPER'),
  mkNode('learn2', 'root', 'ASK'),
  mkNode('plan', 'root', 'PLAN'),
  mkNode('code1', 'plan', 'CODE'),
  mkNode('code2', 'code1', 'CODE'),
  mkNode('code3', 'code2', 'CODE'),
  mkNode('lc1', 'code2', 'DEEPER'),
  mkNode('lc2', 'lc1', 'ASK'),
  mkNode('branch1', 'code2', 'BRANCH'),
  mkNode('code4', 'branch1', 'CODE'),
  mkNode('code5', 'code4', 'CODE'),
];

const nodes: Record<string, ForkNode> = {};
nodeList.forEach(n => { nodes[n.id] = n; });

const result = layoutGitGraph(nodes, 'root');
const { pos, colOf = {} } = result;

const col0 = ['code1', 'code2', 'code3'];
const col1 = ['branch1', 'code4', 'code5'];

console.log('positions:');
Object.entries(pos).forEach(([id, p]) => console.log(`  ${id.padEnd(8)} x=${p.x.toFixed(1).padStart(8)} y=${p.y.toFixed(1).padStart(8)}`));

// 1) PLAN is never a rail node — no column, and it hangs in the same row as
// its learn siblings under root (not off far to the side/below).
assert(colOf['plan'] === undefined, 'PLAN gets no column (colOf[plan] is undefined)');
assert(pos['plan'].y === pos['learn1'].y && pos['plan'].y === pos['learn2'].y, 'PLAN sits in the same row as its learn siblings (hangs like a learn node)');
assert(pos['code1'].y > pos['plan'].y, "PLAN's CODE child sits below it (short edge, not detached)");

// 2) Only the CODE built from the PLAN starts a lane — it gets a real column.
assert(colOf['code1'] !== undefined, 'the CODE built from PLAN gets a column (colOf[code1] is defined)');
const col0Xs = new Set(col0.map(id => pos[id].x));
assert(col0Xs.size === 1, 'all column-0 rail nodes (code1/code2/code3) share one x');
const col0X = [...col0Xs][0];

// 3) all column-1 rail nodes share one x, greater than column-0's x
const col1Xs = new Set(col1.map(id => pos[id].x));
assert(col1Xs.size === 1, 'all column-1 rail nodes share one x');
const col1X = [...col1Xs][0];
assert(col1X > col0X, 'column-1 x is greater than column-0 x');

// 4) column-1 x clears CODE#2's hanging subtree right edge (lc1 -> lc2 chain)
const hangRight = Math.max(pos['lc1'].x + NODE_W, pos['lc2'].x + NODE_W);
assert(col1X >= hangRight, `column-1 x (${col1X}) clears CODE#2's hanging subtree right edge (${hangRight})`);

// 5) y strictly increases along each rail chain; a BRANCH shares its fork
// commit's y exactly (rule 2 — immediate visual feedback of where it forked).
function assertIncreasingY(positions: Record<string, { x: number; y: number }>, chain: string[], label: string) {
  for (let i = 1; i < chain.length; i++) {
    assert(positions[chain[i]].y > positions[chain[i - 1]].y, `${label}: ${chain[i - 1]}.y < ${chain[i]}.y`);
  }
}
assertIncreasingY(pos, col0, 'column 0 chain');
assert(pos['branch1'].y === pos['code2'].y, 'branch1 shares its fork commit (code2)\'s y exactly');
assertIncreasingY(pos, col1, 'column 1 chain (forked off code2)');

// 6) no two node boxes overlap (axis-aligned NODE_W x NODE_H boxes)
function overlaps(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H;
}
function assertNoOverlaps(positions: Record<string, { x: number; y: number }>) {
  const ids = Object.keys(positions);
  let overlapCount = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (overlaps(positions[ids[i]], positions[ids[j]])) {
        overlapCount += 1;
        console.log(`  FAIL overlap: ${ids[i]} <-> ${ids[j]}`);
      }
    }
  }
  assert(overlapCount === 0, 'no two node boxes overlap');
}
assertNoOverlaps(pos);

// ── Fixture 2: rail root (imported repo — no learn ancestor at all) ─────────

console.log('\nlayoutGitGraph verification — fixture 2: rail root');

seq = 0;
const railRootList: ForkNode[] = [
  mkNode('rroot', null, 'CODE', { imported: true, branchName: 'main', commitSha: 'aaa1111' }),
  mkNode('rhead', 'rroot', 'CODE', { branchName: 'main', commitSha: 'bbb2222' }),
  mkNode('rq1', 'rroot', 'QUERY'),
  mkNode('rplan', 'rq1', 'PLAN', { branchName: 'fork/add-x', commitSha: 'bbb2222' }),
  mkNode('rcodeA', 'rplan', 'CODE'),
  mkNode('rcodeB', 'rcodeA', 'CODE'),
];
const railNodes: Record<string, ForkNode> = {};
railRootList.forEach(n => { railNodes[n.id] = n; });

const railResult = layoutGitGraph(railNodes, 'rroot');
const rpos = railResult.pos;
const rColOf = railResult.colOf ?? {};

console.log('positions:');
Object.entries(rpos).forEach(([id, p]) => console.log(`  ${id.padEnd(8)} x=${p.x.toFixed(1).padStart(8)} y=${p.y.toFixed(1).padStart(8)}`));

const railCol0 = ['rroot', 'rhead'];
const railCol1 = ['rcodeA', 'rcodeB'];

// 1) the rail root itself gets a real position (the crash this fixture guards against)
assert(!!rpos['rroot'] && !Number.isNaN(rpos['rroot'].x) && !Number.isNaN(rpos['rroot'].y), 'rail root has a real (non-NaN) position');

// 2) rroot + rhead share column 0's x; rhead is strictly below rroot
const railCol0Xs = new Set(railCol0.map(id => rpos[id].x));
assert(railCol0Xs.size === 1, 'rail root + its CODE child share one x (column 0)');
assert(rpos['rhead'].y > rpos['rroot'].y, 'rail root chain: rroot.y < rhead.y');

// 3) rq1 (the learn child hanging off the rail root) hangs to one side of it —
// the first hang child alternates to the left (splitHangSides) — and never
// gets a column of its own.
assert(rpos['rq1'].x !== rpos['rroot'].x, "rail root's learn child (rq1) is offset from it (not on the rail)");
assert(rColOf['rq1'] === undefined, 'rq1 gets no column');

// 4) rplan hangs off rq1 like any learn node — no column, short edge down to it.
assert(rColOf['rplan'] === undefined, 'PLAN gets no column (colOf[rplan] is undefined)');
assert(rpos['rplan'].y > rpos['rq1'].y, 'rplan sits below rq1 (hangs off it)');

// 5) rcodeA/rcodeB (the CODE built from the PLAN) get a fresh column, distinct
// from column 0, since a CODE built from a PLAN is the one thing that still
// starts a lane.
const railCol1Xs = new Set(railCol1.map(id => rpos[id].x));
assert(railCol1Xs.size === 1, 'the CODE built from PLAN and its child share one x (a new column)');
const railCol1X = [...railCol1Xs][0];
assert(rColOf['rcodeA'] !== undefined, 'rcodeA gets a column (colOf[rcodeA] is defined)');
assert(railCol1X !== rpos['rroot'].x, 'the new column x differs from column 0 x');
assert(rpos['rcodeA'].y > rpos['rplan'].y, "the new column's first node sits below the PLAN (short edge, not detached)");

// 6) y strictly increases down the new column's chain
assertIncreasingY(rpos, railCol1, 'rail-root new-column chain');

// 7) no two node boxes overlap
assertNoOverlaps(rpos);

// ── Fixture 3: column-gap tightening ────────────────────────────────────────

console.log('\nlayoutGitGraph verification — fixture 3: column-gap tightening');

seq = 0;
const gapList: ForkNode[] = [
  mkNode('groot', null, 'CODE', { imported: true, branchName: 'main', commitSha: 'a' }),
  mkNode('ga', 'groot', 'CODE'), // column 0, y=168
  mkNode('gb', 'ga', 'CODE'), // column 0, y=336 — anchors the NARROW right-hang
  mkNode('gb_l', 'gb', 'DEEPER'), // index 0 -> left (unused by assertions)
  mkNode('gb_r', 'gb', 'ASK'), // index 1 -> right: 1 leaf, y~[464,528], width 258 — overlaps column 1
  mkNode('gc', 'gb', 'CODE'), // column 0, continues below gb's hang, y=592 — anchors the WIDE right-hang
  mkNode('gc_l1', 'gc', 'DEEPER'), // index 0 -> left
  mkNode('gc_r1', 'gc', 'ASK'), // index 1 -> right (part of the wide hang)
  mkNode('gc_l2', 'gc', 'DEEPER'), // index 2 -> left
  mkNode('gc_r2', 'gc', 'ASK'), // index 3 -> right: 2 leaves total, y~[720,784], width 468 — well below column 1
  mkNode('gbranch', 'groot', 'BRANCH'), // column 1, same y as groot (0)
  mkNode('gd1', 'gbranch', 'CODE'), // column 1, y=168
  mkNode('gd2', 'gd1', 'CODE'), // column 1, y=336
  mkNode('gd3', 'gd2', 'CODE'), // column 1, y=504 — box [504,568] overlaps gb_r's [464,528]
];
const gapNodes: Record<string, ForkNode> = {};
gapList.forEach(n => { gapNodes[n.id] = n; });

const gapResult = layoutGitGraph(gapNodes, 'groot');
const gpos = gapResult.pos;

console.log('positions:');
Object.entries(gpos).forEach(([id, p]) => console.log(`  ${id.padEnd(8)} x=${p.x.toFixed(1).padStart(8)} y=${p.y.toFixed(1).padStart(8)}`));

const gapCol0 = ['groot', 'ga', 'gb', 'gc'];
const gapCol1 = ['gbranch', 'gd1', 'gd2', 'gd3'];
const gapCol0Xs = new Set(gapCol0.map(id => gpos[id].x));
const gapCol1Xs = new Set(gapCol1.map(id => gpos[id].x));
assert(gapCol0Xs.size === 1, 'column 0 rail nodes share one x');
assert(gapCol1Xs.size === 1, 'column 1 rail nodes share one x');
const gapCol0X = [...gapCol0Xs][0];
const gapCol1X = [...gapCol1Xs][0];
const RAIL_COL_GAP = NODE_W + 64; // mirrors layoutGitGraph.ts's private constant (DEPTH_GAP=64)
const narrowHangWidth = 258; // 1 leaf: 1*(NODE_W+SIBLING_GAP) + HANG_GAP_X = 1*210 + 48
const wideHangWidth = 468; // 2 leaves: 2*(NODE_W+SIBLING_GAP) + HANG_GAP_X = 2*210 + 48
assert(
  gapCol1X === gapCol0X + RAIL_COL_GAP + narrowHangWidth,
  `column 1 x (${gapCol1X}) is sized off the OVERLAPPING narrow hang only (expected ${gapCol0X + RAIL_COL_GAP + narrowHangWidth})`,
);
assert(
  gapCol1X < gapCol0X + RAIL_COL_GAP + wideHangWidth,
  `column 1 x (${gapCol1X}) is tighter than the old unconditional-max formula would give (${gapCol0X + RAIL_COL_GAP + wideHangWidth}) — proves the wide-but-non-overlapping hang was correctly excluded`,
);
assertNoOverlaps(gpos);

console.log(failures === 0 ? `\nPASS` : `\nFAIL (${failures} assertion(s) failed)`);
process.exit(failures === 0 ? 0 : 1);
