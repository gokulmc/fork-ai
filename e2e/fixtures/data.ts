/** Canned API payloads matching the shapes in apps/web/src/lib/api.ts. */

export const SID = 'ses-01E2ETEST0000000000000001';
export const ROOT_ID = 'node-01E2EROOT000000000000001';
export const CHILD_ID = 'node-01E2ECHILD00000000000001';
export const ASK_ID = 'node-01E2EASK0000000000000001';
export const SHARE_TOKEN = 'e2e-share-token-abc123';

const T0 = '2026-06-01T10:00:00.000Z';

export const ROOT_TITLE = 'Photosynthesis Basics';
export const S1_BODY =
  'Chlorophyll absorbs photons inside the thylakoid membranes and splits water molecules, releasing oxygen as a byproduct of the light-dependent reactions.';
export const S2_BODY =
  'Carbon dioxide is fixed into three-carbon sugars by the enzyme rubisco, consuming the ATP and NADPH produced earlier in the light reactions.';

/** Root QUERY node — `nodeId` (not `id`) mirrors the raw DynamoDB items the real API returns. */
export function rootNode(over: Record<string, unknown> = {}) {
  return {
    nodeId: ROOT_ID,
    parentId: null,
    kind: 'QUERY',
    title: ROOT_TITLE,
    emoji: '🌿',
    query: 'how does photosynthesis work?',
    lede: 'Plants convert light into chemical energy through two coupled stages.',
    sections: [
      { id: 's1', heading: 'Light reactions', body: S1_BODY },
      { id: 's2', heading: 'Calvin cycle', body: S2_BODY },
    ],
    fromSection: null,
    fromText: null,
    createdAt: T0,
    model: 'gemini-2.5-flash',
    ...over,
  };
}

export function deeperNode(over: Record<string, unknown> = {}) {
  return {
    nodeId: CHILD_ID,
    parentId: ROOT_ID,
    kind: 'DEEPER',
    title: 'Thylakoid Electron Transport',
    emoji: '⚡',
    query: 'Light reactions',
    lede: 'Electrons hop along the thylakoid membrane to build a proton gradient.',
    sections: [
      { id: 'd1', heading: 'Photosystem II', body: 'P680 chlorophyll pairs are oxidised by light and re-reduced by water splitting.' },
      { id: 'd2', heading: 'ATP synthase', body: 'The proton gradient drives ATP synthase like a molecular turbine.' },
    ],
    fromSection: 's1',
    fromText: 'Light reactions: …',
    createdAt: T0,
    model: 'haiku',
    ...over,
  };
}

export function askNode(over: Record<string, unknown> = {}) {
  return {
    nodeId: ASK_ID,
    parentId: ROOT_ID,
    kind: 'ASK',
    title: 'Pigments Beyond Chlorophyll',
    emoji: '🎨',
    query: 'What pigments are involved?',
    lede: 'Accessory pigments widen the absorbed light spectrum.',
    sections: [
      { id: 'a1', heading: 'Carotenoids', body: 'Carotenoids absorb blue-green light and pass the energy to chlorophyll.' },
    ],
    fromSection: 's1',
    fromText: 'Chlorophyll absorbs photons',
    createdAt: T0,
    model: 'haiku',
    ...over,
  };
}

export function sessionSummary(over: Record<string, unknown> = {}) {
  return {
    sessionId: SID,
    title: ROOT_TITLE,
    emoji: '🌿',
    lede: 'Plants convert light into chemical energy through two coupled stages.',
    createdAt: T0,
    updatedAt: T0,
    nodeCount: 1,
    highlightCount: 0,
    ...over,
  };
}

export function fullSession(over: Record<string, unknown> = {}) {
  return {
    ...sessionSummary(),
    nodes: [rootNode()],
    annotations: [],
    highlights: [],
    ...over,
  };
}

export function userProfile(over: Record<string, unknown> = {}) {
  return { sub: 'u-e2e-test', email: 'e2e@forkai.test', hasOnboarded: true, creditUsd: 5, ...over };
}

export type StreamEvent = { type: string; [k: string]: unknown };

/** The full SSE event sequence of a successful root-query stream. */
export function rootStreamEvents(opts: { token?: string } = {}): StreamEvent[] {
  const root = rootNode();
  const tok = opts.token ? { token: opts.token } : {};
  return [
    { type: 'init', sessionId: SID, nodeId: ROOT_ID, ...tok },
    { type: 'meta', title: root.title, emoji: root.emoji, lede: root.lede },
    ...root.sections.map(s => ({ type: 'section', ...s })),
    { type: 'done', sessionId: SID, nodeId: ROOT_ID, model: root.model, sections: root.sections, ...tok },
  ];
}
