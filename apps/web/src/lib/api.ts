import type { ForkNode, Annotation } from './types';

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
}

export interface ApiAnnotation {
  id: string;
  kind: 'note' | 'callout';
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
}

export interface FullSession extends SessionSummary {
  nodes: ApiNode[];
  annotations: ApiAnnotation[];
  highlights: ApiHighlight[];
}

// ── Conversion helpers ───────────────────────────────────────────────────────

export function toForkNode(n: ApiNode): ForkNode {
  return {
    ...n,
    createdAt: typeof n.createdAt === 'string' ? new Date(n.createdAt).getTime() : (n.createdAt as number),
    loading: false,
  };
}

export function toAnnotation(a: ApiAnnotation): Annotation {
  return {
    ...a,
    createdAt: typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : (a.createdAt as number),
  };
}

/** Build the persistentHl map from the flat highlights list returned by the API. */
export function toHlMap(
  highlights: ApiHighlight[],
): Record<string, Array<{ text: string; bg: string | null; fg: string | null }>> {
  const m: Record<string, Array<{ text: string; bg: string | null; fg: string | null }>> = {};
  for (const h of highlights) {
    const key = `${h.nodeId}::${h.sectionId}`;
    (m[key] = m[key] ?? []).push({ text: h.text, bg: h.bg, fg: h.fg });
  }
  return m;
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
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export function listSessions(idToken: string): Promise<SessionSummary[]> {
  return apiFetch<SessionSummary[]>('/sessions', idToken);
}

export function createSession(
  idToken: string,
  query: string,
  sectionCount = 5,
): Promise<FullSession> {
  return apiFetch<FullSession>('/sessions', idToken, {
    method: 'POST',
    body: JSON.stringify({ query, sectionCount }),
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

// ── Nodes ─────────────────────────────────────────────────────────────────────

export interface CreateNodePayload {
  kind: 'DEEPER' | 'ASK';
  parentNodeId: string;
  fromSection: string;
  query: string;
  sectionBody?: string;    // for DEEPER
  highlightText?: string;  // for ASK
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
  kind: 'note' | 'callout';
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
