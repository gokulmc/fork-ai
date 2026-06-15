import { LlmSection, CitationSource } from './llm.types';

// ── Anthropic web-search citations ──────────────────────────────────────────

// Collect all web search results (title + url) in order from all tool result blocks.
// The <cite index="N-..."> first number is the 1-based index into this list.
export function extractAnthropicSources(blocks: Array<{ type: string; content?: unknown }>): CitationSource[] {
  const sources: CitationSource[] = [];
  for (const block of blocks) {
    if (block.type !== 'web_search_tool_result') continue;
    // On a failed search Anthropic sets `content` to an error OBJECT
    // ({ type: 'web_search_tool_result_error', error_code }) rather than the
    // usual results array — iterating it threw "object is not iterable" and
    // crashed the whole branch call. Skip anything that isn't a results array.
    if (!Array.isArray(block.content)) continue;
    for (const item of block.content as Array<{ type: string; title?: string; url?: string }>) {
      if (item.type === 'web_search_result' && item.title && item.url) {
        sources.push({ title: item.title, url: item.url });
      }
    }
  }
  return sources;
}

// Process all sections in one pass with a shared footnote map so that:
// - numbering is sequential across all sections in order of first appearance
// - only sources that are actually cited in the text are included in the output
export function processCitations(
  sections: LlmSection[],
  allSources: CitationSource[],
): { sections: LlmSection[]; sources: CitationSource[] } {
  const docToFootnote = new Map<number, number>();
  let nextFootnote = 1;

  const processed = sections.map(s => ({
    ...s,
    body: s.body.replace(
      /<cite\s+index="([^"]+)">([^<]*)<\/cite>/g,
      (_match, indexAttr: string, text: string) => {
        const docIdx = parseInt(indexAttr.split('-')[0], 10);
        if (docIdx < 1 || docIdx > allSources.length) return text;
        if (!docToFootnote.has(docIdx)) {
          docToFootnote.set(docIdx, nextFootnote++);
        }
        const fn = docToFootnote.get(docIdx)!;
        const url = allSources[docIdx - 1].url;
        return `${text}<sup class="cite-ref"><a href="${url}" target="_blank" rel="noopener noreferrer">[${fn}]</a></sup>`;
      },
    ),
  }));

  // Build cited-only sources array ordered by footnote number (1-based)
  const citedSources: CitationSource[] = new Array(docToFootnote.size);
  docToFootnote.forEach((footnoteNum, docIdx) => {
    citedSources[footnoteNum - 1] = allSources[docIdx - 1];
  });

  return { sections: processed, sources: citedSources };
}

// ── Gemini Google-Search grounding citations ────────────────────────────────

export interface GeminiGroundingMetadata {
  groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
  groundingSupports?: Array<{
    segment?: { text?: string; startIndex?: number; endIndex?: number };
    groundingChunkIndices?: number[];
  }>;
}

const footnoteHtml = (fn: number, url: string) =>
  `<sup class="cite-ref"><a href="${url}" target="_blank" rel="noopener noreferrer">[${fn}]</a></sup>`;

// Gemini grounding gives text segments + the chunk (source) indices that support
// them. Its segment.startIndex/endIndex address the raw model output, NOT the
// parsed section bodies — so we string-match segment.text into the bodies and
// inject the footnote there. Output shape mirrors processCitations exactly, so
// downstream code (nodes.service, frontend renderer) needs no changes.
export function applyGeminiGrounding(
  sections: LlmSection[],
  meta: GeminiGroundingMetadata,
): { sections: LlmSection[]; sources: CitationSource[] } {
  const chunks = meta.groundingChunks ?? [];
  const supports = (meta.groundingSupports ?? [])
    .filter(s => s.segment?.text && s.groundingChunkIndices?.length)
    // Longest segment first so a longer match isn't clobbered by a nested shorter one.
    .sort((a, b) => (b.segment!.text!.length - a.segment!.text!.length));

  const urlToFootnote = new Map<string, number>();
  const sources: CitationSource[] = [];
  const footnoteFor = (chunkIdx: number): number | null => {
    const web = chunks[chunkIdx]?.web;
    if (!web?.uri) return null;
    if (!urlToFootnote.has(web.uri)) {
      urlToFootnote.set(web.uri, sources.length + 1);
      sources.push({ title: web.title || web.uri, url: web.uri });
    }
    return urlToFootnote.get(web.uri)!;
  };

  const bodies = sections.map(s => s.body);
  for (const sup of supports) {
    const needle = sup.segment!.text!.trim();
    if (!needle) continue;
    const footnotes = [...new Set(
      sup.groundingChunkIndices!.map(footnoteFor).filter((n): n is number => n != null),
    )];
    if (!footnotes.length) continue;
    const supHtml = footnotes.map(fn => footnoteHtml(fn, sources[fn - 1].url)).join('');

    for (let i = 0; i < bodies.length; i++) {
      const idx = bodies[i].indexOf(needle);
      if (idx === -1) continue;
      const end = idx + needle.length;
      // Skip if this span is already footnoted (avoids double markers on overlap).
      if (bodies[i].slice(end, end + 30).includes('cite-ref')) break;
      bodies[i] = bodies[i].slice(0, end) + supHtml + bodies[i].slice(end);
      break; // attribute to first matching section only
    }
  }

  return { sections: sections.map((s, i) => ({ ...s, body: bodies[i] })), sources };
}
