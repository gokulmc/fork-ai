// Standalone verification for layoutGitGraph() — no test runner is configured
// for apps/code-web yet, so this is run directly via `npx tsx scripts/verify-layout.ts`.
// Sample shape (per the forkai-code task spec):
//   root (learn) + 2 learn children
//     -> PLAN -> 3 CODE (lane 0)
//                  CODE#2 -> BRANCH -> 2 CODE (lane 1)
//                  CODE#2 -> 2-node learn subtree (hangs off CODE#2)
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

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ok   ${msg}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${msg}`);
  }
}

const lane0 = ['plan', 'code1', 'code2', 'code3'];
const lane1 = ['branch1', 'code4', 'code5'];

console.log('layoutGitGraph verification');

console.log('positions:');
Object.entries(pos).forEach(([id, p]) => console.log(`  ${id.padEnd(8)} x=${p.x.toFixed(1).padStart(8)} y=${p.y.toFixed(1).padStart(8)}`));

// 1) all lane-0 rail nodes share one y
const lane0Ys = new Set(lane0.map(id => pos[id].y));
assert(lane0Ys.size === 1, 'all lane-0 rail nodes share one y');
const lane0Y = [...lane0Ys][0];

// 2) all lane-1 rail nodes share one y, greater than lane-0's y
const lane1Ys = new Set(lane1.map(id => pos[id].y));
assert(lane1Ys.size === 1, 'all lane-1 rail nodes share one y');
const lane1Y = [...lane1Ys][0];
assert(lane1Y > lane0Y, 'lane-1 y is greater than lane-0 y');

// 3) lane-1 y clears CODE#2's hanging subtree bottom (lc1 -> lc2 chain)
const hangBottom = Math.max(pos['lc1'].y + NODE_H, pos['lc2'].y + NODE_H);
assert(lane1Y >= hangBottom, `lane-1 y (${lane1Y}) clears CODE#2's hanging subtree bottom (${hangBottom})`);

// 4) x strictly increases along each rail chain
function assertIncreasingX(chain: string[], label: string) {
  for (let i = 1; i < chain.length; i++) {
    assert(pos[chain[i]].x > pos[chain[i - 1]].x, `${label}: ${chain[i - 1]}.x < ${chain[i]}.x`);
  }
}
assertIncreasingX(lane0, 'lane 0 chain');
assertIncreasingX(['code2', ...lane1], 'lane 1 chain (forked off code2)');

// 5) no two node boxes overlap (axis-aligned NODE_W x NODE_H boxes)
function overlaps(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H;
}
const ids = Object.keys(pos);
let overlapCount = 0;
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    if (overlaps(pos[ids[i]], pos[ids[j]])) {
      overlapCount += 1;
      console.log(`  FAIL overlap: ${ids[i]} <-> ${ids[j]}`);
    }
  }
}
assert(overlapCount === 0, 'no two node boxes overlap');

console.log(failures === 0 ? `\nPASS (${ids.length} nodes)` : `\nFAIL (${failures} assertion(s) failed)`);
process.exit(failures === 0 ? 0 : 1);
