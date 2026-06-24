export interface LlmSection {
  heading: string;
  body: string; // GitHub-flavoured markdown
}

export interface CitationSource {
  title: string;
  url: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  title: string;   // ≤5 words
  emoji: string;   // single emoji
  lede: string;    // one sentence summary
  sections: LlmSection[];
  sources?: CitationSource[];
  usage: LlmUsage;
}

export type NodeKind = 'QUERY' | 'DEEPER' | 'ASK';

// ── Document upload → mind-map ──────────────────────────────────────────────
// One topic in the mind-map extracted from an uploaded document. `description`
// is an information-dense brief drawn from the document; the per-node content
// pass expands it into full sections WITHOUT re-reading the document (the doc is
// read exactly once, in extractDocumentOutline). See SessionsService.createDocumentStreaming.
export interface OutlineNode {
  tempId: string;
  parentTempId: string | null; // null = attach directly under the root
  title: string;
  emoji: string;
  description: string;
}

export interface DocumentOutline {
  title: string;           // root + session title (≤5 words)
  emoji: string;           // root + session emoji
  lede: string;            // one-sentence framing
  rootDescription: string; // dense overview brief used to generate the root node's content
  nodes: OutlineNode[];    // non-root topics
  usage: LlmUsage;
}
