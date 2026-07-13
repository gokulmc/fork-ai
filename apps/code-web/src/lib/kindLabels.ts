import type { NodeKind } from './types';

// Single source of truth for how a node's `kind` is worded across the UI.
// Before this, the map kicker, the workspace pane pill, and the agent-log
// pane pill each hard-coded their own (drifted) copy — e.g. ASK read 'Branch'
// on the map but 'Follow-up' in the pane, and CODE read 'Commit' in the pane
// but 'Code' in the agent log. 'Branch' is now reserved for kind BRANCH only.
const KIND_LABELS: Record<NodeKind, string> = {
  QUERY: 'Query',
  ASK: 'Follow-up',
  DEEPER: 'Deep dive',
  MIX: 'Synthesis',
  PLAN: 'Plan',
  CODE: 'Commit',
  BRANCH: 'Branch',
  MERGE: 'PR',
};

// `isRoot` overrides the kind-based label — the map's root node (whatever its
// underlying kind) is always labelled 'Root'.
export function kindLabel(kind: NodeKind, opts?: { isRoot?: boolean }): string {
  if (opts?.isRoot) return 'Root';
  return KIND_LABELS[kind];
}
