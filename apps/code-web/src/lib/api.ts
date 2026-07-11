import type { ForkNode, Annotation, HighlightRecord, PersistentHighlight, CitationSource, DiffSummary } from './types';
import { track } from './analytics';

// Called on any 401 that survives a token-refresh retry — set once at app startup to sign out.
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { unauthorizedHandler = fn; }

// Returns a freshly-refreshed id_token (or null). Set at startup so a 401 from a
// just-expired token can be retried with a new token instead of forcing a logout.
let sessionRefresher: (() => Promise<string | null>) | null = null;
export function setSessionRefresher(fn: () => Promise<string | null>) { sessionRefresher = fn; }

// ── Response shapes from NestJS ─────────────────────────────────────────────

export interface ApiNode {
  id: string;
  parentId: string | null;
  kind: 'QUERY' | 'DEEPER' | 'ASK' | 'MIX' | 'PLAN' | 'CODE' | 'BRANCH';
  title: string;
  emoji: string | null;
  query: string;
  lede: string;
  sections: Array<{ id: string; heading: string; body: string }>;
  fromSection: string | null;
  fromText: string | null;
  createdAt: string;
  sources?: CitationSource[];
  model?: string;
  starred?: boolean;
  commitSha?: string;
  branchName?: string;
  commitMessage?: string;
  diffSummary?: DiffSummary;
  agentStatus?: 'running' | 'done' | 'error';
  imported?: boolean;
}

export interface ApiAnnotation {
  id: string;
  kind: 'callout';
  text: string;
  fromTitle: string;
  nodeId: string;
  sectionId: string;
  createdAt: string;
}

export interface ApiHighlight {
  id: string;
  nodeId: string;
  sectionId: string;
  text: string;
  start?: number | null;
  end?: number | null;
  bg: string | null;
  fg: string | null;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  emoji: string;
  lede: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  highlightCount: number;
}

export interface FullSession extends SessionSummary {
  nodes: ApiNode[];
  annotations: ApiAnnotation[];
  highlights: ApiHighlight[];
}

// ── Conversion helpers ───────────────────────────────────────────────────────

export function toForkNode(n: ApiNode): ForkNode {
  const raw = n as unknown as Record<string, unknown>;
  // API returns raw DynamoDB items: nodeId instead of id, plus PK/SK fields
  const id = (raw['nodeId'] as string) ?? n.id;
  return {
    id,
    parentId: n.parentId ?? null,
    kind: n.kind,
    title: n.title,
    emoji: n.emoji ?? null,
    query: n.query,
    lede: n.lede,
    sections: n.sections,
    fromSection: n.fromSection ?? null,
    fromText: n.fromText ?? null,
    createdAt: typeof n.createdAt === 'string' ? new Date(n.createdAt).getTime() : (n.createdAt as number),
    loading: false,
    sources: n.sources,
    model: n.model,
    starred: (raw['starred'] as boolean | undefined) ?? false,
    commitSha: n.commitSha,
    branchName: n.branchName,
    commitMessage: n.commitMessage,
    diffSummary: n.diffSummary,
    agentStatus: n.agentStatus,
    imported: n.imported,
  };
}

export function toAnnotation(a: ApiAnnotation): Annotation {
  const raw = a as unknown as Record<string, unknown>;
  return {
    id: (raw['annId'] as string) ?? a.id,
    kind: a.kind,
    text: a.text,
    fromTitle: a.fromTitle,
    nodeId: a.nodeId,
    sectionId: a.sectionId,
    createdAt: typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : (a.createdAt as number),
  };
}

function extractHlId(h: ApiHighlight): string {
  return ((h as unknown as Record<string, unknown>)['hlId'] as string) ?? h.id;
}

/** Build the persistentHl map from the flat highlights list returned by the API. */
export function toHlMap(
  highlights: ApiHighlight[],
): Record<string, PersistentHighlight[]> {
  const m: Record<string, PersistentHighlight[]> = {};
  for (const h of highlights) {
    const key = `${h.nodeId}::${h.sectionId}`;
    (m[key] = m[key] ?? []).push({
      hlId: extractHlId(h),
      text: h.text,
      start: h.start ?? undefined,
      end: h.end ?? undefined,
      bg: h.bg ?? null,
      fg: h.fg ?? null,
    });
  }
  return m;
}

/** Build the flat highlight list used by the drawer. */
export function toHighlightRecords(
  highlights: ApiHighlight[],
  nodes: Record<string, { title: string }>,
): HighlightRecord[] {
  return highlights.map(h => ({
    hlId: extractHlId(h),
    text: h.text,
    nodeId: h.nodeId,
    sectionId: h.sectionId,
    fromTitle: nodes[h.nodeId]?.title ?? 'Untitled',
  }));
}

// ── API error ────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Machine-readable error code from the JSON body (e.g. OUTPUT_TRUNCATED),
    // when the backend set one — lets the UI branch without parsing copy.
    public readonly code?: string,
  ) {
    super(message);
  }
}

// NestJS error bodies are JSON ({ message, code, statusCode }); pull out the human
// message + any machine code. Non-JSON bodies (LB/proxy HTML error pages) must
// never leak into the UI banner.
function extractError(text: string, fallback: string): { message: string; code?: string } {
  if (!text) return { message: fallback };
  try {
    const body = JSON.parse(text) as { message?: string | string[]; code?: string };
    if (body.message) {
      const message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
      return { message, code: body.code };
    }
  } catch { /* not JSON */ }
  const t = text.trim();
  return { message: t && !t.startsWith('<') && t.length <= 160 ? t : fallback };
}

// ── Core fetch helper ────────────────────────────────────────────────────────

const base = () => process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

async function apiFetch<T>(
  path: string,
  idToken: string,
  init?: RequestInit,
  retried = false,
): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  // A 401 with a token is usually a just-expired id_token used in the brief window
  // before useSession refetched the refreshed one. Refresh once and retry before
  // logging the user out — a single stale-token 401 must not nuke a valid session.
  let refreshFailed = false; // true when the refresh endpoint itself was unreachable
  if (res.status === 401 && idToken && !retried && sessionRefresher) {
    const fresh = await sessionRefresher().catch(() => null);
    const recovered = !!fresh && fresh !== idToken;
    track('auth_401', { path, recovered });
    if (recovered) return apiFetch<T>(path, fresh!, init, true);
    // fresh === null means /api/auth/session was temporarily unavailable (e.g. a
    // Lambda cold-start during a deploy). The session may still be valid — don't
    // sign the user out; let the error propagate so they can retry.
    if (fresh === null) refreshFailed = true;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Only treat 401 as a session-expired signal when we actually sent a token AND
    // the refresh endpoint was reachable. refreshFailed means the refresher itself
    // threw — not that the token is dead — so signing out there is wrong.
    if (res.status === 401 && idToken && !refreshFailed) unauthorizedHandler?.();
    const { message, code } = extractError(text, res.statusText);
    throw new ApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text.trim()) return undefined as T;
  return JSON.parse(text) as T;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export interface UserProfile {
  sub: string;
  email: string;
  hasOnboarded?: boolean;
  creditUsd?: number;
  persona?: string;
}

export interface UsageEvent {
  usageId: string;
  costUsd: number;
  createdAt: string;
  kind?: 'QUERY' | 'DEEPER' | 'ASK' | 'MIX' | 'PLAN' | 'CODE' | 'BRANCH';
  inputTokens?: number;
  outputTokens?: number;
  sessionId?: string;
  nodeId?: string;
}

export function getMe(idToken: string): Promise<UserProfile> {
  return apiFetch<UserProfile>('/users/me', idToken);
}

export function patchMe(idToken: string, updates: { hasOnboarded: boolean }): Promise<void> {
  return apiFetch<void>('/users/me', idToken, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

// Saving a non-empty persona is what activates the feature — until then the
// backend injects nothing into LLM prompts.
export function updatePersona(idToken: string, persona: string): Promise<void> {
  return apiFetch<void>('/users/me', idToken, {
    method: 'PATCH',
    body: JSON.stringify({ persona }),
  });
}

export function getUsageEvents(idToken: string): Promise<UsageEvent[]> {
  return apiFetch<UsageEvent[]>('/users/me/usage', idToken);
}

export interface CreditEvent {
  creditEventId: string;
  type: 'REFERRAL' | 'TOPUP';
  amountUsd: number;
  createdAt: string;
}

export function getCreditEvents(idToken: string): Promise<CreditEvent[]> {
  return apiFetch<CreditEvent[]>('/users/me/credit-events', idToken);
}

// ── Billing ──────────────────────────────────────────────────────────────────

export interface RechargeOrder {
  orderId: string;
  amountInr: number;
  amountUsd: number;
  currency: 'INR' | 'USD';
  keyId: string;
}

export function createRechargeOrder(idToken: string, amountUsd: number, currency?: 'INR' | 'USD'): Promise<RechargeOrder> {
  return apiFetch<RechargeOrder>('/billing/orders', idToken, {
    method: 'POST',
    body: JSON.stringify({ amountUsd, ...(currency ? { currency } : {}) }),
  });
}

export function verifyPayment(
  idToken: string,
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<{ credited: number }> {
  return apiFetch<{ credited: number }>('/billing/verify', idToken, {
    method: 'POST',
    body: JSON.stringify({ orderId, paymentId, signature }),
  });
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export function listSessions(idToken: string): Promise<SessionSummary[]> {
  return apiFetch<SessionSummary[]>('/sessions', idToken);
}

export function createSession(
  idToken: string,
  query: string,
  sectionCount = 5,
  webSearch = false,
): Promise<FullSession> {
  return apiFetch<FullSession>('/sessions', idToken, {
    method: 'POST',
    body: JSON.stringify({ query, sectionCount, webSearch }),
  });
}

export function getSession(idToken: string, sessionId: string): Promise<FullSession> {
  return apiFetch<FullSession>(`/sessions/${sessionId}`, idToken);
}

export function renameSession(
  idToken: string,
  sessionId: string,
  title: string,
): Promise<SessionSummary> {
  return apiFetch<SessionSummary>(`/sessions/${sessionId}`, idToken, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export function deleteSession(idToken: string, sessionId: string): Promise<void> {
  return apiFetch<void>(`/sessions/${sessionId}`, idToken, { method: 'DELETE' });
}

export type StreamEvent =
  | { type: 'init'; sessionId: string; nodeId: string; token?: string }
  | { type: 'meta'; title: string; emoji: string; lede: string }
  | { type: 'section'; id: string; heading: string; body: string }
  | { type: 'done'; sessionId: string; nodeId: string; token?: string; model?: string; sections?: Array<{ id: string; heading: string; body: string }>; sources?: CitationSource[] }
  | { type: 'error'; message: string; status?: number };

// Document upload → mind-map stream. The whole tree is built server-side: `init`
// (session persisted), then `skeleton` (full tree shape, all loading), then one
// `node-done` per node in root→leaf order, then `done`. node-done carries the raw
// NodeItem (nodeId, not id) — feed it through toForkNode like createNode does.
export type DocumentStreamEvent =
  | { type: 'init'; sessionId: string; nodeId: string }
  | { type: 'skeleton'; nodes: Array<{ id: string; parentId: string | null; kind: 'QUERY' | 'DEEPER' | 'ASK' | 'MIX' | 'PLAN' | 'CODE' | 'BRANCH'; title: string; emoji: string | null }> }
  | { type: 'node-done'; node: ApiNode }
  | { type: 'done'; sessionId: string; nodeCount: number; title: string; emoji: string; lede: string }
  | { type: 'error'; message: string; status?: number };

export async function createSessionStream(
  idToken: string,
  query: string,
  sectionCount = 5,
  webSearch = false,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const res = await fetch(`${base()}/sessions/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ query, sectionCount, webSearch }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    const { message, code } = extractError(text, res.statusText);
    throw new ApiError(res.status, message, code);
  }

  await readSseStream(res.body, onEvent);
}

// Shared SSE reader — an in-band `error` event becomes a thrown ApiError so
// callers handle stream failures on the same catch path as HTTP failures.
// Generic over the event union so both the query stream and the document stream
// share it (every union carries the same `error` variant shape).
async function readSseStream<T extends { type: string }>(body: ReadableStream<Uint8Array>, onEvent: (event: T) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let event: T;
      try {
        event = JSON.parse(line.slice(6)) as T;
      } catch { continue; /* malformed line */ }
      const err = event as unknown as { type: string; status?: number; message?: string };
      if (err.type === 'error') throw new ApiError(err.status ?? 500, err.message ?? 'Stream error');
      onEvent(event);
    }
  }
}

// Build a whole mind-map session from an uploaded document (authed-only). SSE
// stream of DocumentStreamEvent; see createDocumentStreaming on the backend.
export async function createDocumentSessionStream(
  idToken: string,
  documentText: string,
  fileName: string | undefined,
  sectionCount: number,
  webSearch: boolean,
  verbose: boolean,
  model: CreateNodePayload['model'],
  onEvent: (event: DocumentStreamEvent) => void,
): Promise<void> {
  const res = await fetch(`${base()}/sessions/document/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ documentText, fileName, sectionCount, webSearch, verbose, model }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    const { message, code } = extractError(text, res.statusText);
    throw new ApiError(res.status, message, code);
  }

  await readSseStream<DocumentStreamEvent>(res.body, onEvent);
}

// ── Nodes ─────────────────────────────────────────────────────────────────────

export interface CreateNodePayload {
  kind: 'DEEPER' | 'ASK';
  parentNodeId: string;
  fromSection: string;
  query: string;
  sectionBody?: string;    // for DEEPER
  highlightText?: string;  // for ASK
  sectionCount?: number;
  webSearch?: boolean;
  verbose?: boolean;
  boost?: boolean;  // retry of a length-limit Cut-Off: double the output budget (authed only)
  model?: 'haiku' | 'sonnet' | 'opus' | 'gemini-pro' | 'gemini-flash' | 'gemini-flash-lite' | 'deepseek-pro' | 'deepseek-flash' | 'glm' | 'glm-air';
}

export function createNode(
  idToken: string,
  sessionId: string,
  payload: CreateNodePayload,
): Promise<ApiNode> {
  return apiFetch<ApiNode>(`/sessions/${sessionId}/nodes`, idToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function renameNode(
  idToken: string,
  sessionId: string,
  nodeId: string,
  title: string,
): Promise<ApiNode> {
  return apiFetch<ApiNode>(`/sessions/${sessionId}/nodes/${nodeId}`, idToken, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export function setNodeStar(
  idToken: string,
  sessionId: string,
  nodeId: string,
  starred: boolean,
): Promise<void> {
  return apiFetch<void>(`/sessions/${sessionId}/nodes/${nodeId}`, idToken, {
    method: 'PATCH',
    body: JSON.stringify({ starred }),
  });
}

export function deleteNode(
  idToken: string,
  sessionId: string,
  nodeId: string,
): Promise<void> {
  return apiFetch<void>(`/sessions/${sessionId}/nodes/${nodeId}`, idToken, {
    method: 'DELETE',
  });
}

export interface CreateMixNodePayload {
  parentNodeId: string;
  sourceNodeIds: string[];
  query: string;
  sectionCount?: number;
  model?: 'haiku' | 'sonnet' | 'opus' | 'gemini-pro' | 'gemini-flash' | 'gemini-flash-lite' | 'deepseek-pro' | 'deepseek-flash' | 'glm' | 'glm-air';
  plan?: boolean; // synthesize a PLAN node instead of a MIX node
}

export function createMixNode(
  idToken: string,
  sessionId: string,
  payload: CreateMixNodePayload,
): Promise<ApiNode> {
  return apiFetch<ApiNode>(`/sessions/${sessionId}/nodes/mix`, idToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── Git-graph: fork a branch off a CODE node ────────────────────────────────

export function createBranchNode(
  idToken: string,
  sessionId: string,
  payload: { parentNodeId: string; branchName: string },
): Promise<ApiNode> {
  return apiFetch<ApiNode>(`/sessions/${sessionId}/nodes/branch`, idToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── Annotations ───────────────────────────────────────────────────────────────

export interface CreateAnnotationPayload {
  kind: 'callout';
  text: string;
  fromTitle: string;
  nodeId: string;
  sectionId: string;
}

export function createAnnotation(
  idToken: string,
  sessionId: string,
  payload: CreateAnnotationPayload,
): Promise<ApiAnnotation> {
  return apiFetch<ApiAnnotation>(`/sessions/${sessionId}/annotations`, idToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteAnnotation(
  idToken: string,
  sessionId: string,
  annId: string,
): Promise<void> {
  return apiFetch<void>(`/sessions/${sessionId}/annotations/${annId}`, idToken, {
    method: 'DELETE',
  });
}

// ── Highlights ────────────────────────────────────────────────────────────────

export interface CreateHighlightPayload {
  nodeId: string;
  sectionId: string;
  text: string;
  start: number;
  end: number;
  bg?: string | null;
  fg?: string | null;
}

export function createHighlight(
  idToken: string,
  sessionId: string,
  payload: CreateHighlightPayload,
): Promise<ApiHighlight> {
  return apiFetch<ApiHighlight>(`/sessions/${sessionId}/highlights`, idToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteHighlight(
  idToken: string,
  sessionId: string,
  hlId: string,
): Promise<void> {
  return apiFetch<void>(`/sessions/${sessionId}/highlights/${hlId}`, idToken, { method: 'DELETE' });
}

// ── Projects ──────────────────────────────────────────────────────────────

export interface RepoRef {
  provider: 'github-mock';
  owner: string;
  repo: string;
  defaultBranch: string;
  url: string;
}

export interface Project {
  projectId: string;
  name: string;
  repoRef: RepoRef;
  plugins: string[];
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectPayload {
  name: string;
  repoRef: RepoRef;
  plugins: string[];
}

export function listProjects(idToken: string): Promise<Project[]> {
  return apiFetch<Project[]>('/projects', idToken);
}

export function createProject(idToken: string, payload: CreateProjectPayload): Promise<Project> {
  return apiFetch<Project>('/projects', idToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getProject(idToken: string, projectId: string): Promise<Project> {
  return apiFetch<Project>(`/projects/${projectId}`, idToken);
}

// ── Root query into an existing (empty) project session ────────────────────
// Same SSE vocabulary as createSessionStream (init/meta/section/done/error) —
// the only difference is the session already exists, so `init`'s sessionId is
// the one the caller already knows.

export interface RootQueryPayload {
  query: string;
  sectionCount?: number;
  webSearch?: boolean;
}

export async function createRootQueryInSessionStream(
  idToken: string,
  sessionId: string,
  payload: RootQueryPayload,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const res = await fetch(`${base()}/sessions/${sessionId}/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    const { message, code } = extractError(text, res.statusText);
    throw new ApiError(res.status, message, code);
  }

  await readSseStream<StreamEvent>(res.body, onEvent);
}

// ── CODE nodes — streaming mocked agent run ─────────────────────────────────

// Mirrors apps/code-api/src/agent/agent-run.util.ts's AgentEvent — `ts` is an
// ISO string, `payload` is `unknown` (in practice always a string from the mock
// agent, but render defensively), and 'truncated' is a synthetic marker kind
// serializeEventsCapped injects when the persisted log was middle-truncated.
export interface AgentEvent {
  seq: number;
  ts: string;
  kind: 'text' | 'tool_call' | 'tool_result' | 'terminal' | 'file_edit' | 'truncated';
  payload: unknown;
}

export interface CreateCodeNodePayload {
  parentNodeId: string;
  instruction: string;
  model?: 'haiku' | 'sonnet' | 'opus' | 'gemini-pro' | 'gemini-flash' | 'gemini-flash-lite' | 'deepseek-pro' | 'deepseek-flash' | 'glm' | 'glm-air';
}

export type CodeStreamEvent =
  | { type: 'init'; node: ApiNode }
  | { type: 'agent-event'; event: AgentEvent }
  | { type: 'commit'; sha: string; branchName: string; message: string; diffSummary: DiffSummary }
  | { type: 'done'; node: ApiNode }
  | { type: 'error'; message: string; status?: number };

export async function createCodeNodeStream(
  idToken: string,
  sessionId: string,
  payload: CreateCodeNodePayload,
  onEvent: (event: CodeStreamEvent) => void,
): Promise<void> {
  const res = await fetch(`${base()}/sessions/${sessionId}/nodes/code/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    const { message, code } = extractError(text, res.statusText);
    throw new ApiError(res.status, message, code);
  }

  await readSseStream<CodeStreamEvent>(res.body, onEvent);
}

// Raw shape returned by GET /sessions/:id/nodes/:nodeId/agent-run — `events` is
// a JSON-serialized string on the wire (see AgentRunItem); parsed here into
// AgentEvent[] so callers never touch JSON.parse themselves.
export interface AgentRun {
  nodeId: string;
  status: 'running' | 'done' | 'error';
  events: AgentEvent[];
  commitSha?: string;
  branchName?: string;
  commitMessage?: string;
  diffSummary?: DiffSummary;
  createdAt: string;
  updatedAt: string;
}

export async function getAgentRun(idToken: string, sessionId: string, nodeId: string): Promise<AgentRun> {
  const raw = await apiFetch<Omit<AgentRun, 'events'> & { events: string }>(
    `/sessions/${sessionId}/nodes/${nodeId}/agent-run`,
    idToken,
  );
  let events: AgentEvent[] = [];
  try { events = JSON.parse(raw.events) as AgentEvent[]; } catch { /* malformed events blob */ }
  return { ...raw, events };
}

export type SupportSubject = 'Bug' | 'Billing' | 'Feature Request' | 'Other';

export async function submitSupportTicket(dto: {
  name: string;
  email: string;
  subject: SupportSubject;
  message: string;
}): Promise<void> {
  const res = await fetch(`${base()}/support`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });
  if (!res.ok) throw new Error('Failed to send support ticket');
}
