export interface LlmSection {
  heading: string;
  body: string; // GitHub-flavoured markdown
}

export interface LlmResponse {
  title: string;   // ≤5 words
  emoji: string;   // single emoji
  lede: string;    // one sentence summary
  sections: LlmSection[];
}

export type NodeKind = 'QUERY' | 'DEEPER' | 'ASK';
