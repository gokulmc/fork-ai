import type { ForkNode, Annotation, HighlightRecord, PersistentHighlight, CitationSource } from './types';

// Called on any 401 — set once at app startup to trigger sign-out
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { unauthorizedHandler = fn; }

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
  ) {
    super(message);
  }
}

// ── Core fetch helper ────────────────────────────────────────────────────────

const base = () => process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

async function apiFetch<T>(
  path: string,
  idToken: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    // Only treat 401 as a session-expired signal when we actually sent a token.
    // A 401 on an empty Bearer means "this endpoint requires auth" — calling
    // signOut() in that case kicks unauthenticated guests off the share page.
    if (res.status === 401 && idToken) unauthorizedHandler?.();
    throw new ApiError(res.status, msg);
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
  | { type: 'meta'; title: string; emoji: string; lede: string }
  | { type: 'section'; id: string; heading: string; body: string }
  | { type: 'done'; sessionId: string; nodeId: string }
  | { type: 'error'; message: string };

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
    const msg = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, msg);
  }

  const reader = res.body.getReader();
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
      try {
        const event = JSON.parse(line.slice(6)) as StreamEvent;
        onEvent(event);
      } catch { /* ignore malformed lines */ }
    }
  }
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
  parentPageId: string,
): Promise<{ url: string }> {
  return apiFetch<{ url: string }>('/notion/push', idToken, {
    method: 'POST',
    body: JSON.stringify({ title, blocks, childrenMap, parentPageId }),
  });
}

// ── Share API (guest endpoints — no idToken required except claimSession) ────

async function shareFetch<T>(path: string, init?: RequestInit, idToken?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
  const res = await fetch(`${base()}${path}`, { ...init, headers });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, msg);
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
