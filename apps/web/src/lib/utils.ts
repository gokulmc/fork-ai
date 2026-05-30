let _idCounter = 1;
export function uid(): string {
  return `n${Date.now().toString(36)}_${_idCounter++}`;
}

// Friendly label for a concrete model id stored on a node.
const MODEL_NAMES: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'Claude Haiku',
  'claude-sonnet-4-6': 'Claude Sonnet',
  'claude-opus-4-8': 'Claude Opus',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite',
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

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
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
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
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
