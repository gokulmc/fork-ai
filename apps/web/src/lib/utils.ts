let _idCounter = 1;
export function uid(): string {
  return `n${Date.now().toString(36)}_${_idCounter++}`;
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

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Walk text nodes and wrap matches in a <span class="persistent-hl"> */
export function wrapTextInElement(
  rootEl: Element,
  item: { text: string; bg: string | null; fg: string | null },
): void {
  const { text: target, bg, fg } = item;
  if (!target || target.length < 3) return;
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  const matches: Array<{ node: Text; idx: number }> = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    if (textNode.parentElement?.closest('.persistent-hl')) continue;
    const idx = textNode.nodeValue?.indexOf(target) ?? -1;
    if (idx >= 0) matches.push({ node: textNode, idx });
  }
  matches.forEach(({ node: textNode, idx }) => {
    try {
      const range = document.createRange();
      range.setStart(textNode, idx);
      range.setEnd(textNode, idx + target.length);
      const span = document.createElement('span');
      span.className = 'persistent-hl';
      if (bg) span.style.background = bg;
      if (fg) span.style.color = fg;
      range.surroundContents(span);
    } catch {
      // Range can't surround cross-element selections — skip
    }
  });
}
