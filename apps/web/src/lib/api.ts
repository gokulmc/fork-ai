import type { ForkNode, Annotation, HighlightRecord, PersistentHighlight, CitationSource } from './types';
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
  kind: 'QUERY' | 'DEEPER' | 'ASK';
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
  notionPageUrl?: string | null;
  shareToken?: string | null;
  ownerSub?: string | null;
  isTrial?: boolean;
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
  if (res.status === 401 && idToken && !retried && sessionRefresher) {
    const fresh = await sessionRefresher().catch(() => null);
    const recovered = !!fresh && fresh !== idToken;
    track('auth_401', { path, recovered });
    if (recovered) return apiFetch<T>(path, fresh!, init, true);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Only treat 401 as a session-expired signal when we actually sent a token.
    // A 401 on an empty Bearer means "this endpoint requires auth" — calling
    // signOut() in that case kicks unauthenticated guests off the share page.
    if (res.status === 401 && idToken) unauthorizedHandler?.();
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
  kind?: 'QUERY' | 'DEEPER' | 'ASK';
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

export function getReferralLink(idToken: string): Promise<{ slug: string; url: string }> {
  return apiFetch<{ slug: string; url: string }>('/users/me/referral-link', idToken, { method: 'POST' });
}

export function registerReferral(idToken: string, slug: string): Promise<void> {
  return apiFetch<void>('/users/me/referrer', idToken, {
    method: 'POST',
    body: JSON.stringify({ slug }),
  });
}

// ── Billing ──────────────────────────────────────────────────────────────────

export interface RechargeOrder {
  orderId: string;
  amountInr: number;
  amountUsd: number;
  currency: string;
  keyId: string;
}

export function createRechargeOrder(idToken: string, amountUsd: number): Promise<RechargeOrder> {
  return apiFetch<RechargeOrder>('/billing/orders', idToken, {
    method: 'POST',
    body: JSON.stringify({ amountUsd }),
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

export function updateSessionNotionUrl(
  idToken: string,
  sessionId: string,
  notionPageUrl: string | null,
): Promise<void> {
  return apiFetch<void>(`/sessions/${sessionId}`, idToken, {
    method: 'PATCH',
    body: JSON.stringify({ notionPageUrl: notionPageUrl ?? '' }),
  });
}

export type StreamEvent =
  | { type: 'init'; sessionId: string; nodeId: string; token?: string }
  | { type: 'meta'; title: string; emoji: string; lede: string }
  | { type: 'section'; id: string; heading: string; body: string }
  | { type: 'done'; sessionId: string; nodeId: string; token?: string; sections?: Array<{ id: string; heading: string; body: string }>; sources?: CitationSource[] }
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
async function readSseStream(body: ReadableStream<Uint8Array>, onEvent: (event: StreamEvent) => void): Promise<void> {
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
      let event: StreamEvent;
      try {
        event = JSON.parse(line.slice(6)) as StreamEvent;
      } catch { continue; /* malformed line */ }
      if (event.type === 'error') throw new ApiError(event.status ?? 500, event.message);
      onEvent(event);
    }
  }
}

export async function createTrialSessionStream(
  query: string,
  sectionCount = 5,
  webSearch = false,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const res = await fetch(`${base()}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, sectionCount, webSearch }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    const { message, code } = extractError(text, res.statusText);
    throw new ApiError(res.status, message, code);
  }

  await readSseStream(res.body, onEvent);
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
  model?: 'haiku' | 'sonnet' | 'opus' | 'gemini-pro' | 'gemini-flash' | 'gemini-flash-lite' | 'deepseek-pro' | 'deepseek-flash';
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

// ── Notion ────────────────────────────────────────────────────────────────────

export interface NotionPage {
  id: string;
  title: string;
  url: string;
}

export function getNotionStatus(idToken: string): Promise<{ connected: boolean }> {
  return apiFetch<{ connected: boolean }>('/notion/status', idToken);
}

export function getNotionAuthUrl(idToken: string): Promise<{ url: string }> {
  // redirect:'error' prevents fetch from following a stale 302 cross-origin to api.notion.com
  return apiFetch<{ url: string }>('/notion/auth', idToken, { redirect: 'error' });
}

export function searchNotionPages(idToken: string, q: string): Promise<NotionPage[]> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  return apiFetch<NotionPage[]>(`/notion/pages${qs}`, idToken);
}

export function pushToNotion(
  idToken: string,
  title: string,
  blocks: unknown[],
  childrenMap: unknown[],
  parentPageId?: string,
): Promise<{ url: string }> {
  return apiFetch<{ url: string }>('/notion/push', idToken, {
    method: 'POST',
    body: JSON.stringify({ title, blocks, childrenMap, ...(parentPageId ? { parentPageId } : {}) }),
  });
}

// ── Share API (guest endpoints — no idToken required except claimSession) ────

async function shareFetch<T>(path: string, init?: RequestInit, idToken?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
  const res = await fetch(`${base()}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    const { message, code } = extractError(text, res.statusText);
    throw new ApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text.trim()) return undefined as T;
  return JSON.parse(text) as T;
}

export const shareApi = {
  getSession(token: string): Promise<FullSession> {
    return shareFetch<FullSession>(`/share/${token}`);
  },

  createNode(token: string, payload: CreateNodePayload): Promise<ApiNode> {
    return shareFetch<ApiNode>(`/share/${token}/nodes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  setNodeStar(token: string, nodeId: string, starred: boolean): Promise<void> {
    return shareFetch<void>(`/share/${token}/nodes/${nodeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ starred }),
    });
  },

  createHighlight(token: string, payload: CreateHighlightPayload): Promise<ApiHighlight> {
    return shareFetch<ApiHighlight>(`/share/${token}/highlights`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateHighlight(token: string, hlId: string, payload: { bg?: string | null; fg?: string | null }): Promise<void> {
    return shareFetch<void>(`/share/${token}/highlights/${hlId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteHighlight(token: string, hlId: string): Promise<void> {
    return shareFetch<void>(`/share/${token}/highlights/${hlId}`, { method: 'DELETE' });
  },

  claimSession(token: string, idToken: string): Promise<SessionSummary> {
    return shareFetch<SessionSummary>(`/share/${token}/claim`, { method: 'POST' }, idToken);
  },

  getShareStatus(idToken: string, sessionId: string): Promise<{ active: boolean; token?: string }> {
    return apiFetch<{ active: boolean; token?: string }>(`/sessions/${sessionId}/share`, idToken);
  },

  generateShareToken(idToken: string, sessionId: string): Promise<{ token: string }> {
    return apiFetch<{ token: string }>(`/sessions/${sessionId}/share`, idToken, { method: 'POST' });
  },

  revokeShareToken(idToken: string, sessionId: string): Promise<void> {
    return apiFetch<void>(`/sessions/${sessionId}/share`, idToken, { method: 'DELETE' });
  },
};

// ── Admin API (Cognito `admins` group only — backend enforces via AdminGuard) ─

export interface ProviderSpend {
  anthropic: number;
  gemini: number;
  deepseek: number;
}

export interface MetricsDay {
  date: string;
  users: number;
  sessions: number;
  nodes: number;
  revenueUsd: number;
  llmSpendUsd: number;
  spendByProvider: ProviderSpend;
}

export interface AdminMetrics {
  userCount: number;
  sessionCount: number;
  nodeCount: number;
  revenueUsd: number;
  llmSpendUsd: number;
  outstandingCreditUsd: number;
  llmSpendByProvider: ProviderSpend;
  series: MetricsDay[];
}

export interface AdminDeployment {
  commit: string;
  version: string;
  env: string;
  region: string;
  startedAt: string;
  uptimeSec: number;
}

export interface HealthStatus {
  status: string;
  version?: string;
  commit?: string;
  uptimeSec?: number;
  latencyMs: number;
  ok: boolean;
}

export interface AdminUser {
  sub: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  creditUsd?: number;
  hasOnboarded?: boolean;
  signupCountry?: string;
  signupCity?: string;
}

export interface AdminPayment {
  paymentId: string;
  orderId: string;
  sub: string;
  amountUsd: number;
  amountInr: number;
  createdAt: string;
}

interface AdminPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AdminUserDetail {
  user: AdminUser;
  sessions: SessionSummary[];
  usage: UsageEvent[];
  payments: AdminPayment[];
}

export interface AdminAuditEntry {
  auditId: string;
  actorEmail: string;
  action: string;
  targetSub: string;
  detail: string;
  createdAt: string;
}

export interface DayTotals {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  eventCount: number;
  byKind: Record<string, number>;
  byModel: Record<string, number>;
}

export interface DayUser {
  sub: string;
  email: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  eventCount: number;
  byKind: Record<string, number>;
  byModel: Record<string, number>;
}

export interface DayTopic {
  query: string;
  title: string;
  kind: string;
  model: string;
  email: string;
  sub: string;
  costUsd: number;
  createdAt: string;
}

export interface DayMetrics {
  date: string;
  totals: DayTotals;
  users: DayUser[];
  topics: DayTopic[];
}

export const adminApi = {
  getConfig(idToken: string): Promise<{ signupCreditUsd: number; referralCreditUsd: number; creditMultiplier: number }> {
    return apiFetch<{ signupCreditUsd: number; referralCreditUsd: number; creditMultiplier: number }>('/admin/config', idToken);
  },

  getMetrics(idToken: string, fresh = false): Promise<AdminMetrics> {
    return apiFetch<AdminMetrics>(`/admin/metrics${fresh ? '?fresh=1' : ''}`, idToken);
  },

  getDayMetrics(idToken: string, date: string): Promise<DayMetrics> {
    return apiFetch<DayMetrics>(`/admin/metrics/day/${encodeURIComponent(date)}`, idToken);
  },

  listUsers(idToken: string): Promise<AdminPage<AdminUser>> {
    return apiFetch<AdminPage<AdminUser>>('/admin/users', idToken);
  },

  getUser(idToken: string, sub: string): Promise<AdminUserDetail> {
    return apiFetch<AdminUserDetail>(`/admin/users/${encodeURIComponent(sub)}`, idToken);
  },

  listPayments(idToken: string): Promise<AdminPage<AdminPayment>> {
    return apiFetch<AdminPage<AdminPayment>>('/admin/payments', idToken);
  },

  getDeployment(idToken: string): Promise<AdminDeployment> {
    return apiFetch<AdminDeployment>('/admin/deployment', idToken);
  },

  adjustCredit(
    idToken: string,
    sub: string,
    amountUsd: number,
    mode: 'add' | 'set',
  ): Promise<{ creditUsd: number }> {
    return apiFetch<{ creditUsd: number }>(`/admin/users/${encodeURIComponent(sub)}/credit`, idToken, {
      method: 'POST',
      body: JSON.stringify({ amountUsd, mode }),
    });
  },

  deleteSession(idToken: string, sub: string, sessionId: string): Promise<void> {
    return apiFetch<void>(
      `/admin/sessions/${encodeURIComponent(sub)}/${encodeURIComponent(sessionId)}`,
      idToken,
      { method: 'DELETE' },
    );
  },

  listAudit(idToken: string, limit = 50): Promise<AdminAuditEntry[]> {
    return apiFetch<AdminAuditEntry[]>(`/admin/audit?limit=${limit}`, idToken);
  },

  listBlogSubmissions(idToken: string): Promise<BlogSubmission[]> {
    return apiFetch<BlogSubmission[]>('/blog-submissions', idToken);
  },

  updateBlogSubmissionStatus(
    idToken: string,
    id: string,
    status: 'approved' | 'rejected' | 'pending',
  ): Promise<{ id: string; status: string }> {
    return apiFetch<{ id: string; status: string }>(`/blog-submissions/${encodeURIComponent(id)}`, idToken, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
};

export interface BlogSubmission {
  id: string;
  emoji: string;
  title: string;
  summary: string;
  body: string;
  authorEmail: string;
  authorSub: string;
  status: string;
  createdAt: string;
}

// Public, unauthenticated live-status ping of the API's /health endpoint.
// Measures latency and surfaces the deployed version/commit.
export async function pingHealth(): Promise<HealthStatus> {
  const start = Date.now();
  try {
    const res = await fetch(`${base()}/health`, { cache: 'no-store' });
    const latencyMs = Date.now() - start;
    if (!res.ok) return { status: `HTTP ${res.status}`, latencyMs, ok: false };
    const data = (await res.json()) as Partial<HealthStatus>;
    return { status: data.status ?? 'ok', version: data.version, commit: data.commit, uptimeSec: data.uptimeSec, latencyMs, ok: true };
  } catch {
    return { status: 'unreachable', latencyMs: Date.now() - start, ok: false };
  }
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

// Decodes the Cognito `admins` group claim from an id_token (client-side gate;
// the API is the real boundary).
export function isAdminToken(idToken?: string): boolean {
  if (!idToken) return false;
  try {
    const payload = JSON.parse(
      atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    const groups = payload['cognito:groups'];
    return Array.isArray(groups) && groups.includes('admins');
  } catch {
    return false;
  }
}

// ── Blog submissions ──────────────────────────────────────────────────────────

export interface BlogSubmissionInput {
  title: string;
  summary?: string;
  body: string;
}

export function submitBlogPost(input: BlogSubmissionInput, idToken: string): Promise<{ id: string }> {
  return apiFetch('/blog-submissions', idToken, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listMyBlogSubmissions(idToken: string): Promise<BlogSubmission[]> {
  return apiFetch<BlogSubmission[]>('/blog-submissions/mine', idToken);
}

// ── Published community posts + view counts (public, no auth) ──────────────────

export interface PublishedPost {
  id: string;
  slug: string;
  emoji: string;
  title: string;
  summary: string;
  body: string;
  createdAt: string;
}

export async function listPublishedPosts(): Promise<PublishedPost[]> {
  try {
    const res = await fetch(`${base()}/blog-submissions/published`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as PublishedPost[]) : [];
  } catch {
    return [];
  }
}

export async function getPublishedPost(slug: string): Promise<PublishedPost | null> {
  try {
    const res = await fetch(`${base()}/blog-submissions/by-slug/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as PublishedPost) : null;
  } catch {
    return null;
  }
}

export async function listBlogViews(): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${base()}/blog-views`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export async function getBlogViewCount(slug: string): Promise<number> {
  try {
    const res = await fetch(`${base()}/blog-views/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    return res.ok ? (((await res.json()) as { views: number }).views ?? 0) : 0;
  } catch {
    return 0;
  }
}

export async function incrementBlogView(slug: string): Promise<number> {
  try {
    const res = await fetch(`${base()}/blog-views/${encodeURIComponent(slug)}`, { method: 'POST' });
    return res.ok ? (((await res.json()) as { views: number }).views ?? 0) : 0;
  } catch {
    return 0;
  }
}
