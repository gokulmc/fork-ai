export interface SectionItem {
  id: string;
  heading: string;
  body: string;
}

export interface UserMetaItem {
  PK: string;
  SK: string;
  sub: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  hasOnboarded?: boolean;
  creditUsd?: number;
  signupIp?: string;
  signupCountry?: string;
  signupCity?: string;
  // Free-text user persona prepended to every LLM prompt. Absent until the user
  // first saves one — the feature is inert until then.
  persona?: string;
  // GitHub OAuth (read-only usage + import — see github.service.ts). Absent
  // until the user completes the OAuth callback.
  githubAccessToken?: string;
  githubLogin?: string;
}

export interface CreditEventItem {
  PK: string;               // USER#{sub}
  SK: string;               // CREDITEVT#{ulid}
  creditEventId: string;
  sub: string;
  type: 'TOPUP';
  amountUsd: number;
  createdAt: string;
}

export interface UsageEventItem {
  PK: string;
  SK: string;
  usageId: string;
  sub: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  kind: 'QUERY' | 'DEEPER' | 'ASK' | 'MIX' | 'PLAN' | 'CODE' | 'MACHINE';
  model: string;
  sessionId: string;
  nodeId: string;
  createdAt: string;
  // Cloud-run settlement fields (ADR-0004) — runId links a CODE token-usage row
  // and a MACHINE infra row to the same run (both keyed by nodeId). machineSeconds
  // is set only on kind 'MACHINE' rows.
  runId?: string;
  machineSeconds?: number;
}

// Pre-auth reserve for a cloud CODE run (ADR-0004). PK USER#{sub} / SK HOLD#{nodeId}.
// Lifecycle: 'held' at placeHold → 'reconciled' via the conditional flip in
// reconcileHoldStatus, which is the exactly-once guard for release+charge.
export interface HoldItem {
  PK: string;
  SK: string;
  sub: string;
  nodeId: string;
  sessionId: string;
  holdUsd: number;
  status: 'held' | 'reconciled';
  model: string;
  createdAt: string;
  updatedAt: string;
}

// One Fly machine's full-lifetime bill (ADR-0004). PK USER#{sub} / SK
// MACHINEBILL#{sandboxId} — the conditional-create guard so a sweep tick and a
// concurrent runner `finally` can't both bill the same machine.
export interface MachineBillItem {
  PK: string;
  SK: string;
  sub: string;
  sandboxId: string;
  sessionId: string;
  nodeId: string;
  machineSeconds: number;
  costUsd: number;
  createdAt: string;
}

export interface SessionMetaItem {
  PK: string;
  SK: string;
  sessionId: string;
  title: string;
  emoji: string;
  lede: string;
  rootNodeId: string;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
  gsi1pk: string;
  gsi1sk: string;
  // Set by ProjectsService.create when this session is a Project's map — absent
  // for plain research sessions created outside a Project.
  projectId?: string;
}

export interface CitationSource {
  title: string;
  url: string;
}

// Shared between NodeItem (CODE nodes) and AgentRunItem — one commit's file-level diff stats.
export interface DiffSummary {
  filesChanged: number;
  additions: number;
  deletions: number;
  files: Array<{ path: string; status: string; additions: number; deletions: number }>;
}

export interface NodeItem {
  PK: string;
  SK: string;
  nodeId: string;
  parentId?: string | null;
  kind: 'QUERY' | 'DEEPER' | 'ASK' | 'MIX' | 'PLAN' | 'CODE' | 'BRANCH' | 'MERGE';
  title: string;
  emoji?: string | null;
  query: string;
  lede: string;
  sections: SectionItem[];
  fromSection?: string | null;
  fromText?: string | null;
  createdAt: string;
  sources?: CitationSource[];
  model?: string; // concrete model id that produced this node
  starred?: boolean;
  // CODE/BRANCH node fields — one CODE node = one agent run = one git commit.
  commitSha?: string;
  branchName?: string;
  commitMessage?: string;
  diffSummary?: DiffSummary;
  agentStatus?: 'running' | 'done' | 'error';
  imported?: boolean;
  // Where a CODE node's agent run actually happened — set at done. Absent on
  // mock runs (no real workspace exists). workspaceExpiresAt is cloud-only;
  // sandbox-sweep.ts destroys the sandbox once it passes.
  workspace?:
    | { kind: 'cloud'; sandboxId: string; vscodeUrl: string }
    | { kind: 'local'; path: string };
  workspaceExpiresAt?: string;
  // Whether the run's commit was pushed to the real GitHub remote (cloud
  // private-repo runs only — see ADR-0002's push-back amendment). Absent on
  // mock/local/no-remote runs, not just false, since "no push was attempted"
  // and "push was attempted and failed" are different states.
  pushed?: boolean;
  pushError?: string;
  // Cloud-only (ADR-0004) — set when the sandbox's runner.mjs SIGKILLed the
  // claude child for exceeding the run's token budget mid-run. Partial work
  // was still committed/pushed as normal; this only flags the ceiling was hit.
  budgetExceeded?: boolean;
  // Token/compute cost of this run at done (both cloud and mock paths) — the
  // BILLED figure (claude's own cost × creditMultiplier), same basis as the
  // cloud hold reconciliation. Machine/infra cost bills separately later at
  // sandbox sweep and is never folded in here.
  runCostUsd?: number;
  // MERGE node fields — second parent, render-only (ADR-0005).
  mergeFromNodeId?: string;
  prStatus?: 'open' | 'merged';
}

export interface AnnotationItem {
  PK: string;
  SK: string;
  annId: string;
  kind: 'note' | 'callout';
  text: string;
  fromTitle: string;
  nodeId: string;
  sectionId: string;
  createdAt: string;
}

export interface PaymentItem {
  PK: string;
  SK: string;
  paymentId: string;
  orderId: string;
  sub: string;
  amountUsd: number;
  amountInr: number;
  createdAt: string;
}

export interface HighlightItem {
  PK: string;
  SK: string;
  hlId: string;
  nodeId: string;
  sectionId: string;
  text: string;
  start?: number | null;
  end?: number | null;
  bg?: string | null;
  fg?: string | null;
  createdAt: string;
}

export interface RepoRef {
  provider: 'github-mock' | 'github' | 'new';
  owner: string;
  repo: string;
  defaultBranch: string;
  url: string;
  // Only meaningful for provider 'github' — set at project create from the
  // GitHub API's own `private` field (see github.service.ts's listRepos).
  // Gates whether createCodeNodeStreaming needs an installation token to
  // clone (see NodesService.resolveRunRepo / GithubAppService).
  private?: boolean;
}

// A Project owns a repo ref + plugin list and points at the one Session that is
// its map. PK/SK mirror SessionMetaItem's USER#<sub> partition so a user's
// projects and sessions live in the same query-able space.
export interface ProjectItem {
  PK: string;
  SK: string;
  projectId: string;
  name: string;
  repoRef: RepoRef;
  plugins: string[];
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  // Distinct branch lines seeded/forked on this project's map — set at create
  // (import: seeded branch count; 'new'/'github-mock': 1 for the default
  // branch) and bumped by $ADD whenever a BRANCH node is forked.
  branchCount?: number;
}

// A GitHub App installation (Contents:Read v1) the user has granted forkai
// code access to — distinct from UserMetaItem.githubAccessToken above, which
// is a classic OAuth token used only for read-only browsing/import
// (github.service.ts). This is what GithubAppService.mintInstallationToken
// uses to clone PRIVATE repos into a cloud sandbox run. A user can have more
// than one (one per GitHub org/account they installed the App on).
export interface GithubInstallationItem {
  PK: string;
  SK: string;
  installationId: string;
  accountLogin: string;
  createdAt: string;
}

// One CODE node's agent run: the full event stream plus the resulting commit.
// PK/SK mirror NodeItem's SESSION#<sessionId> partition — one AgentRun per CODE node.
export interface AgentRunItem {
  PK: string;
  SK: string;
  nodeId: string;
  status: 'running' | 'done' | 'error';
  // JSON-serialized array of {seq, ts, kind, payload} — stored as one string to
  // keep the schema simple and item writes cheap. See agent-run.util.ts for the
  // size cap applied before this is written.
  events: string;
  commitSha?: string;
  branchName?: string;
  commitMessage?: string;
  diffSummary?: DiffSummary;
  createdAt: string;
  updatedAt: string;
}
