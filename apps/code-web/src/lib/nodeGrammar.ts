import type { NodeKind } from './types';

// Mirrors the server-side node grammar (apps/code-api) — which kinds may be
// created as a child of a given parent kind. This module only exposes the
// rule; affordance gating (hiding buttons the server would reject) lands in a
// later phase.
const LEARN_CHILDREN: NodeKind[] = ['DEEPER', 'ASK', 'MIX'];

export const ALLOWED_CHILD_KINDS: Record<NodeKind, NodeKind[]> = {
  QUERY: LEARN_CHILDREN,
  DEEPER: LEARN_CHILDREN,
  ASK: LEARN_CHILDREN,
  MIX: LEARN_CHILDREN,
  PLAN: ['CODE', 'DEEPER', 'ASK'],
  CODE: ['CODE', 'BRANCH', 'DEEPER', 'ASK'],
  BRANCH: ['CODE', 'DEEPER', 'ASK'],
  MERGE: ['CODE'],
};

export function canSpawn(parentKind: NodeKind, childKind: NodeKind): boolean {
  return ALLOWED_CHILD_KINDS[parentKind].includes(childKind);
}
