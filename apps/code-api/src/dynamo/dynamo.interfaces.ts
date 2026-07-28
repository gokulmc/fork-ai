export interface SectionItem {
  id: string;
  heading: string;
  body: string;
  // Set only on an inline-mode section (Ask answered in place on the parent
  // node instead of creating a child node) — marks it as a conversational turn.
  askedQuery?: string;
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
  // Denormalized status of this session's most recent CODE agent run, so the
  // History "Continue" rail can show run state without loading every node.
  // Written by NodesService.createCodeNodeStreaming: 'running' when the CODE
  // node is first persisted, 'done'/'error' at the run's end. Absent for a
  // session that has never had a CODE run.
  lastRunStatus?: 'running' | 'done' | 'error';
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
  // The agent run's full final result message — a multi-sentence prose summary
  // of the work carried out, rendered at the top of the CODE node's pane.
  // commitMessage is only its first line. Set at run done alongside it.
  runSummary?: string;
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
  // Fly machine wall-clock cost (ADR-0004), billed separately from runCostUsd
  // above — set by UsersService.billMachineUsage once the sandbox is actually
  // destroyed (success-path TTL sweep or an error-path immediate destroy), so
  // it lands well after the node's own 'done' write. Absent until then, and
  // absent entirely for mock/local runs (no Fly machine to bill).
  machineCostUsd?: number;
  // MERGE node fields — second parent, render-only (ADR-0005).
  mergeFromNodeId?: string;
  prStatus?: 'open' | 'merged';
  // Real GitHub PR (ADR-0002/0005 extension, WS-E) — set only when
  // createPrNode successfully opened an actual PR on GitHub (github provider,
  // both ends pushed, App has Pull-requests:Write). Absent for an
  // internal-only MERGE node, exactly like today when any of those don't hold.
  prNumber?: number;
  prUrl?: string;
  // Why a real GitHub PR attempt did NOT produce a prNumber, so the frontend
  // can render distinct states. Set ONLY when the attempt was actually made
  // (github provider + both ends pushed) and failed; absent both when the PR
  // succeeded (prNumber/prUrl set instead) AND when no attempt was made at all
  // (mock/github-mock/unpushed — a pure internal MERGE node). 'app_not_enabled'
  // = no installation token (App not installed/configured); the rest mirror
  // GithubAppService.createPullRequest's typed failure reasons.
  prError?: 'app_not_enabled' | 'forbidden' | 'exists' | 'no_diff' | 'failed';
  // Structured objective/key-results (#220) — settable on any node (e.g. a PLAN
  // or BRANCH), fed into every CODE agent run's prompt whose rail passes
  // through it (see NodesService.createCodeNodeStreaming, which reads it off
  // findRailChain's branchNode). Absent until the user sets one via PATCH.
  okr?: { objective: string; keyResults: string[] };
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
  // Short Explain answer attached to this highlight's passage (#237 Phase 1b),
  // set by NodesService.createInlineNote. Absent on a plain colour highlight.
  note?: string;
  // The question that produced `note` — persisted so a page reload can still
  // show what was asked (#237 Phase 1b gap-fix).
  noteQuestion?: string;
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
  // Set the moment a from-scratch ('new') project attached a real GitHub repo.
  // Nodes created before this carry fabricated commitShas that don't exist on
  // the remote — NodesService gates baseCommitSha on it. Absent for projects
  // created directly against a repo (or never attached).
  repoAttachedAt?: string;
}

// A registered APNs device token for push notifications (run-complete/failed
// alerts). PK USER#{sub} / SK DEVICE#{token} — one row per device, upserted
// on every POST /devices so a re-registered token just refreshes createdAt.
export interface DeviceItem {
  PK: string;
  SK: string;
  sub: string;
  token: string;
  platform: 'ios';
  createdAt: string;
}

// A GitHub App installation (Contents:Read v1) the user has granted forkai
// code access to. This is what GithubAppService.mintInstallationToken uses to
// read/clone repos (including PRIVATE ones) for both project import and a
// cloud sandbox run. A user can have more than one (one per GitHub org/account
// they installed the App on).
export interface GithubInstallationItem {
  PK: string;
  SK: string;
  installationId: string;
  accountLogin: string;
  // Optional — pre-existing rows predate these two fields (see
  // GithubAppService.listInstallations' lazy self-heal). accountType is
  // whether the installer is a personal account or an org.
  accountType?: 'User' | 'Organization';
  // 'all' vs 'selected' repos on the installation — drives the frontend's
  // "allow All repositories" nudge for the create-repo flow (ADR-0007).
  repositorySelection?: 'all' | 'selected';
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
