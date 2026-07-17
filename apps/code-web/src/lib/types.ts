export interface Section {
  id: string;
  heading: string;
  body: string;
}

export interface CitationSource {
  title: string;
  url: string;
}

export interface DiffSummary {
  filesChanged: number;
  additions: number;
  deletions: number;
  files: Array<{ path: string; status: string; additions: number; deletions: number }>;
}

export interface ForkNode {
  id: string;
  parentId: string | null;
  kind: 'QUERY' | 'DEEPER' | 'ASK' | 'MIX' | 'PLAN' | 'CODE' | 'BRANCH' | 'MERGE';
  title: string;
  emoji: string | null;
  query: string;
  lede: string;
  sections: Section[];
  fromSection: string | null;
  fromText: string | null;
  createdAt: number;
  loading: boolean;
  error?: string;
  errorStatus?: number; // HTTP status of the failure — drives Retry vs Log-in CTA
  errorCode?: string;   // machine code of the failure (e.g. OUTPUT_TRUNCATED) — gates the Cut-Off Retry
  sources?: CitationSource[];
  model?: string; // concrete model id that produced this node
  starred?: boolean; // marked important — grey glow on the map + first in Notion export
  // ── forkai-code: CODE/BRANCH rail nodes ────────────────────────────────────
  commitSha?: string;
  branchName?: string;
  commitMessage?: string;
  diffSummary?: DiffSummary;
  agentStatus?: 'running' | 'done' | 'error';
  imported?: boolean;
  // Where the agent run actually happened — set at done, absent on mock runs.
  // workspaceExpiresAt is cloud-only (the sandbox is swept once it passes).
  workspace?:
    | { kind: 'cloud'; sandboxId: string; vscodeUrl: string }
    | { kind: 'local'; path: string };
  workspaceExpiresAt?: string;
  // ── forkai-code: MERGE rail nodes — second parent, render-only (ADR-0005) ──
  mergeFromNodeId?: string;
  prStatus?: 'open' | 'merged';
  // Real GitHub PR — set once createPrNode succeeds against a live repo.
  prNumber?: number;
  prUrl?: string;
  // Set instead of prNumber/prUrl when PR creation itself failed — distinguishes
  // "no GitHub App connection" (app_not_enabled/forbidden, guides to Connect) from
  // any other failure (exists/no_diff/failed, shown as a generic inline note).
  prError?: 'app_not_enabled' | 'forbidden' | 'exists' | 'no_diff' | 'failed';
  // Cloud push state — set at done for a cloud run; absent (not false) for a
  // mock run or a node whose push hasn't been attempted.
  pushed?: boolean;
  pushError?: string;
  // The run hit the token/compute budget ceiling and was stopped early —
  // partial work was still committed.
  budgetExceeded?: boolean;
  // Token/compute cost at done, ≈ (approximate). machineCostUsd (the Fly
  // sandbox's own cost) is billed separately at sweep, ~20min later — absent
  // until then, so a fresh node's total is provisional (see AgentLogPane's
  // cost footer).
  runCostUsd?: number;
  machineCostUsd?: number;
  // Structured objective/key-results (#220) — fed into the agent prompt on
  // every CODE run down this rail. Absent until set via the OKR editor
  // (PATCH omits the field entirely to leave it unchanged — never send null).
  okr?: { objective: string; keyResults: string[] };
}

export type NodeKind = ForkNode['kind'];

export interface Annotation {
  id: string;
  kind: 'callout';
  text: string;
  fromTitle: string;
  nodeId: string;
  sectionId: string;
  createdAt: number;
}

export interface PersistentHighlight {
  hlId?: string;
  text: string;
  start?: number;
  end?: number;
  bg: string | null;
  fg: string | null;
}

export interface HighlightRecord {
  hlId: string;
  text: string;
  nodeId: string;
  sectionId: string;
  fromTitle: string;
}

export interface Tweaks {
  theme: 'light' | 'dark';
  accent: string;
  density: 'comfortable' | 'compact';
  fontPair: string;
  answerStyle: 'sectioned' | 'verbose';
  maxSections: number;
  webSearch: boolean;
  branchModel: 'haiku' | 'sonnet' | 'opus';
  environment: 'cloud' | 'demo' | 'blaxel';
}

export interface HlMenuState {
  rect: { left: number; top: number; width: number; height: number; bottom: number };
  text: string;
  markdown: string;
  nodeId: string;
  sectionId: string;
  start: number;
  end: number;
}

export interface FollowUpState {
  rect: { left: number; top: number; width: number; height: number; bottom: number };
  text: string;
  nodeId: string;
  sectionId: string;
  start: number;
  end: number;
  loading: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string;
}

export interface LlmResponse {
  title: string;
  emoji: string;
  lede: string;
  sections: Array<{ heading: string; body: string }>;
}
