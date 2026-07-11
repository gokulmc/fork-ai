// Standalone verification for layoutGitGraph() — no test runner is configured
// for apps/code-web yet, so this is run directly via `npx tsx scripts/verify-layout.ts`.
// Two fixtures:
//   1. Learn-root — root (learn) + 2 learn children
//        -> PLAN -> 3 CODE (column 0)
//                     CODE#2 -> BRANCH -> 2 CODE (column 1)
//                     CODE#2 -> 2-node learn subtree (hangs right of CODE#2)
//   2. Rail-root — CODE root (imported) -> CODE head child (column 0)
//                    root -> QUERY (hangs right of root) -> PLAN (column 1) -> 2 CODE
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
const { pos } = result;

const col0 = ['plan', 'code1', 'code2', 'code3'];
const col1 = ['branch1', 'code4', 'code5'];

console.log('positions:');
Object.entries(pos).forEach(([id, p]) => console.log(`  ${id.padEnd(8)} x=${p.x.toFixed(1).padStart(8)} y=${p.y.toFixed(1).padStart(8)}`));

// 1) all column-0 rail nodes share one x
const col0Xs = new Set(col0.map(id => pos[id].x));
assert(col0Xs.size === 1, 'all column-0 rail nodes share one x');
const col0X = [...col0Xs][0];

// 2) all column-1 rail nodes share one x, greater than column-0's x
const col1Xs = new Set(col1.map(id => pos[id].x));
assert(col1Xs.size === 1, 'all column-1 rail nodes share one x');
const col1X = [...col1Xs][0];
assert(col1X > col0X, 'column-1 x is greater than column-0 x');

// 3) column-1 x clears CODE#2's hanging subtree right edge (lc1 -> lc2 chain)
const hangRight = Math.max(pos['lc1'].x + NODE_W, pos['lc2'].x + NODE_W);
assert(col1X >= hangRight, `column-1 x (${col1X}) clears CODE#2's hanging subtree right edge (${hangRight})`);

// 4) y strictly increases along each rail chain
function assertIncreasingY(positions: Record<string, { x: number; y: number }>, chain: string[], label: string) {
  for (let i = 1; i < chain.length; i++) {
    assert(positions[chain[i]].y > positions[chain[i - 1]].y, `${label}: ${chain[i - 1]}.y < ${chain[i]}.y`);
  }
}
assertIncreasingY(pos, col0, 'column 0 chain');
assertIncreasingY(pos, ['code2', ...col1], 'column 1 chain (forked off code2)');

// 5) no two node boxes overlap (axis-aligned NODE_W x NODE_H boxes)
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

console.log('positions:');
Object.entries(rpos).forEach(([id, p]) => console.log(`  ${id.padEnd(8)} x=${p.x.toFixed(1).padStart(8)} y=${p.y.toFixed(1).padStart(8)}`));

const railCol0 = ['rroot', 'rhead'];
const railCol1 = ['rplan', 'rcodeA', 'rcodeB'];

// 1) the rail root itself gets a real position (the crash this fixture guards against)
assert(!!rpos['rroot'] && !Number.isNaN(rpos['rroot'].x) && !Number.isNaN(rpos['rroot'].y), 'rail root has a real (non-NaN) position');

// 2) rroot + rhead share column 0's x; rhead is strictly below rroot
const railCol0Xs = new Set(railCol0.map(id => rpos[id].x));
assert(railCol0Xs.size === 1, 'rail root + its CODE child share one x (column 0)');
assert(rpos['rhead'].y > rpos['rroot'].y, 'rail root chain: rroot.y < rhead.y');

// 3) rq1 (the learn child hanging off the rail root) sits to the right of column 0
assert(rpos['rq1'].x > rpos['rroot'].x, "rail root's learn child (rq1) hangs to the right of it");

// 4) rplan/rcodeA/rcodeB share a new column's x, greater than column 0's x, and
// clearing rq1's own position (the buried-entry-point ordering this fixture guards against)
const railCol1Xs = new Set(railCol1.map(id => rpos[id].x));
assert(railCol1Xs.size === 1, 'PLAN + its CODE chain (entering from rq1) share one x (a new column)');
const railCol1X = [...railCol1Xs][0];
assert(railCol1X > rpos['rroot'].x, 'the new column x is greater than column 0 x');
assert(railCol1X >= rpos['rq1'].x + NODE_W, "the new column x clears rq1's box");

// 5) y strictly increases down the new column's chain
assertIncreasingY(rpos, railCol1, 'rail-root new-column chain');

// 6) no two node boxes overlap
assertNoOverlaps(rpos);

console.log(failures === 0 ? `\nPASS` : `\nFAIL (${failures} assertion(s) failed)`);
process.exit(failures === 0 ? 0 : 1);
