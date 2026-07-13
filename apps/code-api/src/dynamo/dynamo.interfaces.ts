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
  kind: 'QUERY' | 'DEEPER' | 'ASK' | 'MIX' | 'PLAN' | 'CODE';
  model: string;
  sessionId: string;
  nodeId: string;
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
