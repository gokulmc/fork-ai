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
