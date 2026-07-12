import { BadRequestException } from '@nestjs/common';
import { NodeKind } from '@/llm/llm.types';

// The four "learn" kinds (research nodes) behave identically for branching
// purposes — a MIX/PLAN base node, or a source node feeding a plan, must be
// one of these. Kept as its own list because ALLOWED_CHILD_KINDS below can't
// express "PLAN is a valid outcome of a learn-kind parent, but only via the
// mix route" — that's enforced separately in NodesService.
export const LEARN_KINDS: NodeKind[] = ['QUERY', 'DEEPER', 'ASK', 'MIX'];

// Which child kinds may be created under a given parent kind. PLAN is
// intentionally absent from the learn-kind entries: it is never created via
// the generic create route (CreateNodeDto only accepts DEEPER/ASK) — only via
// POST /sessions/:id/nodes/mix with plan:true, which NodesService validates
// against LEARN_KINDS directly instead of this map.
export const ALLOWED_CHILD_KINDS: Record<NodeKind, NodeKind[]> = {
  QUERY: ['DEEPER', 'ASK', 'MIX'],
  DEEPER: ['DEEPER', 'ASK', 'MIX'],
  ASK: ['DEEPER', 'ASK', 'MIX'],
  MIX: ['DEEPER', 'ASK', 'MIX'],
  PLAN: ['CODE', 'DEEPER', 'ASK'],
  // QUERY here is only reachable via the seeded-question route
  // (SessionsService.createRootNodeStreaming on a session whose root is a CODE
  // node) — the generic create route (CreateNodeDto) still only accepts
  // DEEPER/ASK, so a QUERY can never be minted under CODE any other way.
  CODE: ['CODE', 'BRANCH', 'DEEPER', 'ASK', 'QUERY'],
  BRANCH: ['CODE', 'DEEPER', 'ASK'],
  MERGE: ['CODE'],
};

export function assertKindAllowed(parentKind: NodeKind, childKind: NodeKind): void {
  const allowed = ALLOWED_CHILD_KINDS[parentKind] ?? [];
  if (!allowed.includes(childKind)) {
    throw new BadRequestException(
      `Cannot create a ${childKind} node under a ${parentKind} parent (allowed: ${allowed.length ? allowed.join(', ') : 'none'})`,
    );
  }
}
