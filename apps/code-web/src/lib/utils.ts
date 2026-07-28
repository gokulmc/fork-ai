let _idCounter = 1;
export function uid(): string {
  return `n${Date.now().toString(36)}_${_idCounter++}`;
}

// Friendly label for a concrete model id stored on a node.
const MODEL_NAMES: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'Claude Haiku',
  'claude-sonnet-5': 'Claude Sonnet',
  'claude-opus-5': 'Claude Opus',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'glm-5.2': 'GLM 5.2',
  'glm-4.5-air': 'GLM 4.5 Air',
};
export function modelDisplayName(modelId: string | undefined | null): string | null {
  if (!modelId) return null;
  return MODEL_NAMES[modelId] ?? modelId;
}

export function pickEmoji(s: string | null | undefined): string | null {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const first = seg.segment(trimmed)[Symbol.iterator]().next().value;
    return first?.segment ?? trimmed.slice(0, 2);
  } catch {
    return Array.from(trimmed)[0] ?? null;
  }
}

export function short5(s: string): string {
  if (!s) return 'Untitled';
  const words = s.replace(/[''"""']/g, '').split(/\s+/).filter(Boolean);
  if (words.length <= 5) return words.join(' ');
  return words.slice(0, 5).join(' ');
}

export function stripMarkdown(s: string): string {
  if (!s) return '';
  return s
    .replace(/<[^>]+>/g, '') // strip inline HTML (e.g. web-search <cite>/<sup> citation tags)
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[image]')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

// Remove web-search citation markup for plain-text descriptions/ledes where
// footnotes aren't rendered: drop <sup> footnote markers, unwrap <cite> tags
// (keeping the cited text).
export function stripCite(s: string): string {
  if (!s) return '';
  return s
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<cite\b[^>]*>([\s\S]*?)<\/cite>/gi, '$1')
    .trim();
}

// LLM section headings sometimes arrive with their markdown ATX hashes intact
// (e.g. "## Foo", "##Foo", or "## Foo ##"), which would render as a literal `##`
// in the <h2>. Strip the leading/closing heading markers. Two+ leading hashes are
// dropped even without a following space (never legitimate text); a single leading
// hash must be space-separated so "#hashtag" is left alone, and a trailing run must
// be space-separated so internal/trailing `#` ("C#", "F#") survives.
export function cleanHeading(s: string): string {
  if (!s) return '';
  return s
    .replace(/^\s*#{2,6}\s*/, '')
    .replace(/^\s*#\s+/, '')
    .replace(/\s+#{1,6}\s*$/, '')
    .trim();
}

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

// Shared by HistoryPage (card footer) and HistoryBubbles (bubble label).
export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// #237 Phase 1b — inline note markers (see Section.tsx's SectionBody) are
// real DOM elements injected into the rendered section body, and highlight
// offsets are character offsets into that body's plain text as walked by
// document.createTreeWalker(root, NodeFilter.SHOW_TEXT, …). The marker is
// built with zero text nodes so it never actually appears in that walk —
// this filter is belt-and-braces: if a future edit ever puts real text
// inside a [data-inline-note] marker, it gets excluded here instead of
// silently shifting every highlight offset after it in the section.
export function rejectInlineNoteText(node: Node): number {
  return node.parentElement?.closest('[data-inline-note]')
    ? NodeFilter.FILTER_REJECT
    : NodeFilter.FILTER_ACCEPT;
}

/**
 * Compute start/end character offsets of a Range within the plain text
 * of a root element (as walked by TreeWalker). Returns null if either
 * boundary node is not found inside root.
 */
export function getRangeOffsets(
  root: Element,
  range: Range,
): { start: number; end: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, rejectInlineNoteText);
  let pos = 0;
  let start = -1;
  let end = -1;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    const len = (t.nodeValue ?? '').length;
    if (start < 0 && t === range.startContainer) start = pos + range.startOffset;
    if (t === range.endContainer) { end = pos + range.endOffset; break; }
    pos += len;
  }
  if (start < 0 || end < 0) return null;
  return { start, end };
}
