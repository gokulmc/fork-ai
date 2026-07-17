import type { NodeItem } from '@/dynamo/dynamo.interfaces';
import type { AgentEvent } from '@/agent/agent-run.util';

// Ordered walk up a CODE node's "rail" — the straight PLAN/BRANCH → CODE → CODE →
// ... chain the node-grammar enforces (a CODE node's only allowed CODE-creating
// parents are another CODE, a BRANCH, or a PLAN — see node-grammar.ts). Used to
// resolve which git branch a new CODE node lands on and to gather prior-commit
// context for the mock agent prompt.
export interface RailChain {
  ancestors: NodeItem[];       // full walk, nearest-first, inclusive of fromNodeId
  planNode: NodeItem | null;   // the PLAN node that terminates the rail, if reached
  codeAncestors: NodeItem[];   // CODE nodes passed through, nearest-first
  branchNode: NodeItem | null; // the BRANCH node that terminates the rail, if reached
}

// Walks parentId links starting at fromNodeId (inclusive) until it reaches a
// BRANCH or PLAN node — either terminates the rail, since neither has a CODE
// node grandparent relevant to this lane — or runs out of ancestors.
export function findRailChain(nodeById: Map<string, NodeItem>, fromNodeId: string): RailChain {
  const ancestors: NodeItem[] = [];
  const codeAncestors: NodeItem[] = [];
  let planNode: NodeItem | null = null;
  let branchNode: NodeItem | null = null;

  let cur: string | null | undefined = fromNodeId;
  while (cur) {
    const n = nodeById.get(cur);
    if (!n) break;
    ancestors.push(n);

    if (n.kind === 'CODE') {
      codeAncestors.push(n);
      cur = n.parentId ?? null;
      continue;
    }
    // A MERGE node sits ON the target lane (its parentId is the target tip
    // CODE node) — pass straight through via parentId, deliberately ignoring
    // mergeFromNodeId (the source/second parent), so a post-merge CODE child
    // still walks back through the target branch's real commit history.
    if (n.kind === 'MERGE') {
      cur = n.parentId ?? null;
      continue;
    }
    if (n.kind === 'BRANCH') { branchNode = n; break; }
    if (n.kind === 'PLAN') { planNode = n; break; }
    break; // defensive: any other kind ends the rail (shouldn't occur per node-grammar)
  }

  return { ancestors, planNode, codeAncestors, branchNode };
}

// Full plan document text for the mock agent prompt — no cap, unlike branch
// context trails elsewhere, since the plan is the primary brief for the whole rail.
export function planDocOf(planNode: NodeItem): string {
  return planNode.sections.map((s) => `## ${s.heading}\n\n${s.body}`).join('\n\n');
}

export interface CodeSummary {
  commitMessage: string;
  filePaths: string[];
  additions: number;
  deletions: number;
}

export function codeSummaryOf(node: NodeItem): CodeSummary {
  return {
    commitMessage: node.commitMessage ?? '',
    filePaths: node.diffSummary?.files.map((f) => f.path) ?? [],
    additions: node.diffSummary?.additions ?? 0,
    deletions: node.diffSummary?.deletions ?? 0,
  };
}

// Extra prompt context threaded into expandSection/followUpFromHighlight when a
// DEEPER/ASK node is created directly under a CODE node — grounds the learn
// answer in what the agent actually did (commit + files + recent activity),
// not just the parent's title/query like a normal ancestor.
export function codeContextBlockOf(node: NodeItem, recentEvents: AgentEvent[]): string {
  const files = node.diffSummary?.files.map((f) => f.path).join(', ') || '(no files recorded)';
  const events = recentEvents.length
    ? recentEvents.map((e) => `- [${e.kind}] ${typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload)}`).join('\n')
    : '(no agent run events available)';
  return `This branch continues work from a CODE node in the same session.
Commit message: "${node.commitMessage ?? ''}"
Files changed: ${files}
Recent agent activity:
${events}`;
}

// Composer attachments (text files, or Groq-described images) on a DEEPER/ASK
// node — same "--- Attached file ---" block format the CODE path already uses
// (mock-agent.service.ts's attachmentsSection) so attaching the same
// screenshot to "ask about this" and to "build this" reads identically.
export function attachmentsBlockOf(attachments: Array<{ name: string; content: string }>): string {
  return attachments.map((a) => `--- Attached file: ${a.name} ---\n\`\`\`\n${a.content}\n\`\`\``).join('\n\n');
}
