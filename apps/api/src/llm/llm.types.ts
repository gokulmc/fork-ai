export interface LlmSection {
  heading: string;
  body: string; // GitHub-flavoured markdown
}

export interface CitationSource {
  title: string;
  url: string;
}

export interface LlmResponse {
  title: string;   // ≤5 words
  emoji: string;   // single emoji
  lede: string;    // one sentence summary
  sections: LlmSection[];
  sources?: CitationSource[];
}

export type NodeKind = 'QUERY' | 'DEEPER' | 'ASK';
