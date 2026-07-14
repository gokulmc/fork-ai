import type { ForkNode } from './types';

export interface SegMeta {
  count: number;
  hiddenIds: string[];
}

export interface CollapseResult {
  displayNodes: Record<string, ForkNode>;
  segMeta: Record<string, SegMeta>;
}

// A chain collapses once it hides MORE than this many interior commits — i.e.
// a chain of first + 4 interior + last (6 nodes total, ">5 consecutive" per
// the import spec) or longer; anything shorter stays fully expanded
// (collapsing 1-3 commits saves no real map space).
const COLLAPSE_INTERIOR_THRESHOLD = 3;

const isChainable = (n: ForkNode | undefined): n is ForkNode => !!n && n.imported === true && n.kind === 'CODE';

// Finds maximal runs of consecutive imported CODE commits on one branch and
// replaces their interior (everything but the first and last real node) with
// one synthetic `seg:<firstInteriorId>` node, so a 500-commit import doesn't
// render 500 map cards. Never mutates `nodes` — returns a fresh copy.
export function collapseSegments(
  nodes: Record<string, ForkNode>,
  expandedSegIds: Set<string>,
  protectedIds: Set<string>,
): CollapseResult {
  const displayNodes: Record<string, ForkNode> = { ...nodes };
  const segMeta: Record<string, SegMeta> = {};

  const childMap: Record<string, string[]> = {};
  Object.values(nodes).forEach((n) => {
    if (n.parentId) (childMap[n.parentId] ??= []).push(n.id);
  });

  // A node continues its parent's chain (i.e. is NOT a chain start) only when
  // the parent is itself chainable, on the same branch, has exactly this one
  // child, and isn't protected — a protected parent can never be extended
  // past (see the walk below), so whatever would-be continuation follows it
  // must start a fresh chain of its own.
  const isChainStart = (n: ForkNode): boolean => {
    if (!isChainable(n)) return false;
    const parent = n.parentId ? nodes[n.parentId] : undefined;
    if (!isChainable(parent)) return true;
    if (parent.branchName !== n.branchName) return true;
    if ((childMap[parent.id]?.length ?? 0) !== 1) return true;
    if (protectedIds.has(parent.id)) return true;
    return false;
  };

  Object.values(nodes).forEach((start) => {
    if (!isChainStart(start)) return;

    const chain: ForkNode[] = [start];
    let cur = start;
    for (;;) {
      if (protectedIds.has(cur.id)) break; // cur can't become interior — chain ends here
      const kids = childMap[cur.id] || [];
      if (kids.length !== 1) break; // a fork/merge/leaf — can't have a sole continuation
      const child = nodes[kids[0]];
      if (!isChainable(child) || child.branchName !== start.branchName) break;
      chain.push(child);
      cur = child;
    }

    const interior = chain.slice(1, -1);
    if (interior.length <= COLLAPSE_INTERIOR_THRESHOLD) return;

    const segId = `seg:${interior[0].id}`;
    const meta: SegMeta = { count: interior.length, hiddenIds: interior.map((n) => n.id) };

    // User expanded this segment — leave the interior fully visible in
    // displayNodes, but still publish its segMeta (keyed by the same segId,
    // hiddenIds[0] pointing at the now-visible first interior node) so a
    // caller can render a re-collapse chip at the head of the expanded run.
    if (expandedSegIds.has(segId)) {
      segMeta[segId] = meta;
      return;
    }

    const first = chain[0];
    const last = chain[chain.length - 1];

    interior.forEach((n) => { delete displayNodes[n.id]; });
    displayNodes[last.id] = { ...last, parentId: segId };
    displayNodes[segId] = {
      id: segId,
      parentId: first.id,
      kind: 'CODE',
      title: `⋯ ${interior.length} commits`,
      emoji: '',
      query: '',
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: interior[0].createdAt,
      loading: false,
      imported: true,
      branchName: first.branchName,
    };
    segMeta[segId] = meta;
  });

  return { displayNodes, segMeta };
}
