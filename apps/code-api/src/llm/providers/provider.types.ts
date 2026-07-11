import { LlmSection, LlmUsage, CitationSource } from '../llm.types';

export interface CompleteOptions {
  model: string; // concrete provider model id
  maxTokens: number;
  webSearch: boolean;
}

export interface CompleteResult {
  rawText: string; // accumulated model text, pre-JSON-parse
  usage: LlmUsage;
  // True when generation stopped because it hit maxTokens (the length limit),
  // so rawText is a cut-off — distinct from a genuinely unparseable answer.
  truncated?: boolean;
  // Provider-specific citation finisher: given the parsed sections, returns the
  // sections with inline footnote markers injected + the cited-only sources list.
  // Undefined when there was no web search / no usable sources.
  applyCitations?: (sections: LlmSection[]) => { sections: LlmSection[]; sources: CitationSource[] };
}

// A provider exposes only a non-streaming completion. Root-query streaming stays
// on a direct Anthropic client in LlmService (Gemini is branches-only).
export interface LlmProvider {
  complete(prompt: string, opts: CompleteOptions): Promise<CompleteResult>;
}
