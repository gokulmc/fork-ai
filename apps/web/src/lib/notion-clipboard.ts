import { marked } from 'marked';
import type { ForkNode, Annotation, PersistentHighlight } from './types';

marked.use({ gfm: true, breaks: false });

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildChildMap(nodes: Record<string, ForkNode>): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const node of Object.values(nodes)) {
    if (node.parentId) (map[node.parentId] ??= []).push(node.id);
  }
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => (nodes[a]?.createdAt ?? 0) - (nodes[b]?.createdAt ?? 0));
  }
  return map;
}

// ── Color mapping (app hex → Notion color names) ─────────────────────────────

const BG_TO_NOTION: Record<string, string> = {
  '#fef08a': 'yellow_background',
  '#bbf7d0': 'green_background',
  '#bae6fd': 'blue_background',
  '#fbcfe8': 'pink_background',
  '#e5e5e5': 'gray_background',
};

const FG_TO_NOTION: Record<string, string> = {
  '#b91c1c': 'red',
  '#1d4ed8': 'blue',
  '#047857': 'green',
};

function bgNotionColor(bg: string | null): string {
  return BG_TO_NOTION[bg ?? ''] ?? 'yellow_background';
}

function fgNotionColor(fg: string | null): string {
  return FG_TO_NOTION[fg ?? ''] ?? 'default';
}

// ── Notion blocks format ──────────────────────────────────────────────────────

interface NAnnotations {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string;
}

interface NRichText {
  type: 'text';
  text: { content: string; link: null };
  annotations: NAnnotations;
}

type NBlock =
  | { type: 'heading_1'; heading_1: { rich_text: NRichText[]; is_toggleable: true; color: 'default' }; children?: NBlock[] }
  | { type: 'heading_2'; heading_2: { rich_text: NRichText[]; is_toggleable: boolean; color: 'default' }; children?: NBlock[] }
  | { type: 'heading_3'; heading_3: { rich_text: NRichText[]; is_toggleable: boolean; color: 'default' }; children?: NBlock[] }
  | { type: 'paragraph'; paragraph: { rich_text: NRichText[]; color: 'default' } }
  | { type: 'callout'; callout: { rich_text: NRichText[]; icon: { type: 'emoji'; emoji: string }; color: 'default' } }
  | { type: 'code'; code: { rich_text: NRichText[]; caption: []; language: string } }
  | { type: 'quote'; quote: { rich_text: NRichText[]; color: 'default' } }
  | { type: 'bulleted_list_item'; bulleted_list_item: { rich_text: NRichText[]; color: 'default' } };

function makeRT(content: string, ann: Partial<NAnnotations> = {}): NRichText {
  return {
    type: 'text',
    text: { content, link: null },
    annotations: {
      bold: false, italic: false, strikethrough: false,
      underline: false, code: false, color: 'default',
      ...ann,
    },
  };
}

// Apply highlight ranges: split plain text into annotated spans
function applyHlsToRichText(
  base: NRichText[],
  highlights: PersistentHighlight[],
): NRichText[] {
  let spans = base;
  for (const hl of highlights) {
    if (!hl.text) continue;
    const color = fgNotionColor(hl.fg) !== 'default'
      ? fgNotionColor(hl.fg)
      : bgNotionColor(hl.bg);
    const next: NRichText[] = [];
    for (const span of spans) {
      if (span.annotations.color !== 'default') { next.push(span); continue; }
      const idx = span.text.content.indexOf(hl.text);
      if (idx === -1) { next.push(span); continue; }
      if (idx > 0) next.push(makeRT(span.text.content.slice(0, idx), span.annotations));
      next.push(makeRT(hl.text, { ...span.annotations, color }));
      const after = span.text.content.slice(idx + hl.text.length);
      if (after) next.push(makeRT(after, span.annotations));
    }
    spans = next;
  }
  return spans;
}

// Parse a single line of inline markdown → NRichText[]
function inlineToRT(line: string, baseAnn: Partial<NAnnotations> = {}): NRichText[] {
  const result: NRichText[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|([^*`]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m[2]) result.push(makeRT(m[2], { ...baseAnn, bold: true }));
    else if (m[3]) result.push(makeRT(m[3], { ...baseAnn, italic: true }));
    else if (m[4]) result.push(makeRT(m[4], { ...baseAnn, code: true }));
    else if (m[5]) result.push(makeRT(m[5], baseAnn));
  }
  return result.length ? result : [makeRT(line, baseAnn)];
}

// Parse a markdown body → NBlock[]
function mdToBlocks(body: string, highlights: PersistentHighlight[]): NBlock[] {
  const blocks: NBlock[] = [];
  // Split off fenced code blocks first
  const parts = body.split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    const codeMatch = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
    if (codeMatch) {
      blocks.push({
        type: 'code',
        code: {
          rich_text: [makeRT(codeMatch[2].trimEnd())],
          caption: [],
          language: codeMatch[1] || 'plain text',
        },
      });
      continue;
    }
    // Split by paragraphs
    for (const para of part.split(/\n\n+/)) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      const lines = trimmed.split('\n');
      const firstLine = lines[0];

      // Heading
      const hm = firstLine.match(/^(#{1,4})\s+(.+)/);
      if (hm) {
        const level = Math.min(hm[1].length, 3);
        const rt = applyHlsToRichText(inlineToRT(hm[2]), highlights);
        if (level === 1) blocks.push({ type: 'heading_1', heading_1: { rich_text: rt, is_toggleable: false as unknown as true, color: 'default' } });
        else if (level === 2) blocks.push({ type: 'heading_2', heading_2: { rich_text: rt, is_toggleable: false, color: 'default' } });
        else blocks.push({ type: 'heading_3', heading_3: { rich_text: rt, is_toggleable: false, color: 'default' } });
        continue;
      }
      // Blockquote
      if (firstLine.startsWith('> ')) {
        const rt = applyHlsToRichText(inlineToRT(firstLine.slice(2)), highlights);
        blocks.push({ type: 'quote', quote: { rich_text: rt, color: 'default' } });
        continue;
      }
      // Bullet list
      if (firstLine.match(/^[-*]\s/)) {
        for (const line of lines) {
          const lm = line.match(/^[-*]\s+(.+)/);
          if (lm) {
            const rt = applyHlsToRichText(inlineToRT(lm[1]), highlights);
            blocks.push({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt, color: 'default' } });
          }
        }
        continue;
      }
      // Paragraph: inline-parse all lines joined
      const rt = inlineToRT(trimmed.replace(/\n/g, ' '));
      const rtWithHl = applyHlsToRichText(rt, highlights);
      blocks.push({ type: 'paragraph', paragraph: { rich_text: rtWithHl, color: 'default' } });
    }
  }
  return blocks;
}

// ── Notion blocks: recursive node renderer ────────────────────────────────────

function nodeToNBlocks(
  node: ForkNode,
  depth: number,
  nodes: Record<string, ForkNode>,
  childMap: Record<string, string[]>,
  persistentHl: Record<string, PersistentHighlight[]>,
  annotations: Annotation[],
): NBlock[] {
  const children = (childMap[node.id] ?? [])
    .map(id => nodes[id])
    .filter((n): n is ForkNode => !!n && !n.loading);

  // Group children by their fromSection
  const bySection: Record<string, ForkNode[]> = {};
  const orphans: ForkNode[] = [];
  for (const c of children) {
    if (c.fromSection && node.sections.some(s => s.id === c.fromSection)) {
      (bySection[c.fromSection] ??= []).push(c);
    } else {
      orphans.push(c);
    }
  }

  const sectionBlocks: NBlock[] = [];
  const sectionHeadingLevel = Math.min(depth < 2 ? 2 : depth + 1, 4) as 2 | 3 | 4;

  for (const section of node.sections) {
    const hls = persistentHl[`${node.id}::${section.id}`] ?? [];
    const callouts = annotations.filter(a => a.nodeId === node.id && a.sectionId === section.id);

    // Section heading (h2/h3 in Notion; use bold paragraph for h4)
    if (sectionHeadingLevel === 2) {
      sectionBlocks.push({ type: 'heading_2', heading_2: { rich_text: [makeRT(section.heading)], is_toggleable: false, color: 'default' } });
    } else if (sectionHeadingLevel === 3) {
      sectionBlocks.push({ type: 'heading_3', heading_3: { rich_text: [makeRT(section.heading)], is_toggleable: false, color: 'default' } });
    } else {
      sectionBlocks.push({ type: 'paragraph', paragraph: { rich_text: [makeRT(section.heading, { bold: true })], color: 'default' } });
    }

    sectionBlocks.push(...mdToBlocks(section.body, hls));

    for (const c of callouts) {
      sectionBlocks.push({
        type: 'callout',
        callout: { rich_text: [makeRT(c.text)], icon: { type: 'emoji', emoji: '💡' }, color: 'default' },
      });
    }

    // Children spawned from this section (interleaved)
    for (const child of bySection[section.id] ?? []) {
      sectionBlocks.push(...nodeToNBlocks(child, depth + 1, nodes, childMap, persistentHl, annotations));
    }
  }

  // Orphan children after all sections
  for (const child of orphans) {
    sectionBlocks.push(...nodeToNBlocks(child, depth + 1, nodes, childMap, persistentHl, annotations));
  }

  if (depth === 0) {
    // Root: flat layout
    const root: NBlock[] = [
      { type: 'heading_1', heading_1: { rich_text: [makeRT(node.title)], is_toggleable: false as unknown as true, color: 'default' } },
      { type: 'paragraph', paragraph: { rich_text: [makeRT(node.lede)], color: 'default' } },
      ...sectionBlocks,
    ];
    return root;
  }

  // Child: toggle heading
  const toggleLevel = Math.min(depth, 3);
  const innerBlocks: NBlock[] = [
    { type: 'paragraph', paragraph: { rich_text: [makeRT(node.lede, { italic: true })], color: 'default' } },
    ...sectionBlocks,
  ];
  if (toggleLevel === 1) {
    return [{ type: 'heading_1', heading_1: { rich_text: [makeRT(node.title)], is_toggleable: true, color: 'default' }, children: innerBlocks }];
  } else if (toggleLevel === 2) {
    return [{ type: 'heading_2', heading_2: { rich_text: [makeRT(node.title)], is_toggleable: true, color: 'default' }, children: innerBlocks }];
  } else {
    return [{ type: 'heading_3', heading_3: { rich_text: [makeRT(node.title)], is_toggleable: true, color: 'default' }, children: innerBlocks }];
  }
}

// ── HTML format ───────────────────────────────────────────────────────────────

function applyHlsToHtml(html: string, highlights: PersistentHighlight[]): string {
  let result = html;
  for (const hl of highlights) {
    if (!hl.text) continue;
    const style = [`background-color: ${hl.bg ?? '#fef08a'}`, hl.fg ? `color: ${hl.fg}` : null]
      .filter(Boolean).join('; ');
    const esc = hl.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(esc), `<mark style="${style}">${hl.text}</mark>`);
  }
  return result;
}

function sectionsToHtml(
  node: ForkNode,
  sectionHeadingLevel: number,
  persistentHl: Record<string, PersistentHighlight[]>,
  annotations: Annotation[],
  childrenBySection: Record<string, ForkNode[]>,
  depth: number,
  nodes: Record<string, ForkNode>,
  childMap: Record<string, string[]>,
): string {
  let html = '';
  node.sections.forEach((section, i) => {
    if (i > 0) html += '<hr>\n';
    const htag = `h${sectionHeadingLevel}`;
    html += `<${htag}>${escHtml(section.heading)}</${htag}>\n`;
    const hls = persistentHl[`${node.id}::${section.id}`] ?? [];
    let bodyHtml: string;
    try { bodyHtml = marked.parse(section.body) as string; }
    catch { bodyHtml = `<p>${escHtml(section.body)}</p>`; }
    html += applyHlsToHtml(bodyHtml, hls);
    for (const c of annotations.filter(a => a.nodeId === node.id && a.sectionId === section.id)) {
      html += `<blockquote>💡 ${escHtml(c.text)}</blockquote>\n`;
    }
    for (const child of childrenBySection[section.id] ?? []) {
      html += renderNodeHtml(child, depth + 1, nodes, childMap, persistentHl, annotations);
    }
  });
  return html;
}

function renderNodeHtml(
  node: ForkNode,
  depth: number,
  nodes: Record<string, ForkNode>,
  childMap: Record<string, string[]>,
  persistentHl: Record<string, PersistentHighlight[]>,
  annotations: Annotation[],
): string {
  const children = (childMap[node.id] ?? [])
    .map(id => nodes[id])
    .filter((n): n is ForkNode => !!n && !n.loading);

  const bySection: Record<string, ForkNode[]> = {};
  const orphans: ForkNode[] = [];
  for (const c of children) {
    if (c.fromSection && node.sections.some(s => s.id === c.fromSection)) {
      (bySection[c.fromSection] ??= []).push(c);
    } else {
      orphans.push(c);
    }
  }

  const sectionHeadingLevel = Math.min(depth < 2 ? 2 : depth + 1, 4);
  const sectionsHtml = sectionsToHtml(node, sectionHeadingLevel, persistentHl, annotations, bySection, depth, nodes, childMap);
  const orphansHtml = orphans.map(c => renderNodeHtml(c, depth + 1, nodes, childMap, persistentHl, annotations)).join('');

  if (depth === 0) {
    return `<h1>${escHtml(node.title)}</h1>\n<p>${escHtml(node.lede)}</p>\n${sectionsHtml}${orphansHtml}`;
  }

  const toggleLevel = Math.min(depth, 3);
  const ttag = `h${toggleLevel}`;
  const inner = `<p><em>${escHtml(node.lede)}</em></p>\n${sectionsHtml}${orphansHtml}`;
  return `<details><summary><${ttag}>${escHtml(node.title)}</${ttag}></summary>\n${inner}</details>\n`;
}

// ── Plain text ────────────────────────────────────────────────────────────────

function renderNodePlain(
  node: ForkNode,
  depth: number,
  nodes: Record<string, ForkNode>,
  childMap: Record<string, string[]>,
  annotations: Annotation[],
): string {
  const children = (childMap[node.id] ?? [])
    .map(id => nodes[id])
    .filter((n): n is ForkNode => !!n && !n.loading);

  const bySection: Record<string, ForkNode[]> = {};
  const orphans: ForkNode[] = [];
  for (const c of children) {
    if (c.fromSection && node.sections.some(s => s.id === c.fromSection)) {
      (bySection[c.fromSection] ??= []).push(c);
    } else {
      orphans.push(c);
    }
  }

  const hLevel = depth === 0 ? 1 : Math.min(depth, 3);
  const hashes = '#'.repeat(hLevel);
  const sHashes = '#'.repeat(Math.min(hLevel + 1, 4));
  let text = `${hashes} ${node.title}\n\n${node.lede}\n\n`;

  for (const section of node.sections) {
    text += `${sHashes} ${section.heading}\n\n${section.body}\n\n`;
    for (const c of annotations.filter(a => a.nodeId === node.id && a.sectionId === section.id)) {
      text += `> 💡 ${c.text}\n\n`;
    }
    for (const child of bySection[section.id] ?? []) {
      text += renderNodePlain(child, depth + 1, nodes, childMap, annotations);
    }
  }
  for (const child of orphans) {
    text += renderNodePlain(child, depth + 1, nodes, childMap, annotations);
  }
  return text;
}

// ── Block tree splitting ──────────────────────────────────────────────────────
// Notion's pages.create rejects blocks with inline `children`. We split the
// nested tree into a flat block array + a recursive children map so the server
// can do a depth-first append after creating the page flat.

export interface ChildEntry {
  index: number;
  children: Record<string, unknown>[];
  childrenMap: ChildEntry[];
}

function splitBlocks(blocks: NBlock[]): {
  flat: Record<string, unknown>[];
  childrenMap: ChildEntry[];
} {
  const flat: Record<string, unknown>[] = [];
  const childrenMap: ChildEntry[] = [];

  blocks.forEach((b, i) => {
    const { children, ...rest } = b as Record<string, unknown> & { children?: NBlock[] };
    flat.push(rest);
    if (Array.isArray(children) && children.length > 0) {
      const sub = splitBlocks(children);
      childrenMap.push({ index: i, children: sub.flat, childrenMap: sub.childrenMap });
    }
  });

  return { flat, childrenMap };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function buildNotionClipboard(
  nodes: Record<string, ForkNode>,
  rootId: string,
  persistentHl: Record<string, PersistentHighlight[]>,
  annotations: Annotation[],
): { html: string; plain: string; blocks: Record<string, unknown>[]; childrenMap: ChildEntry[] } {
  const root = nodes[rootId];
  if (!root) return { html: '', plain: '', blocks: [], childrenMap: [] };

  const childMap = buildChildMap(nodes);

  const body = renderNodeHtml(root, 0, nodes, childMap, persistentHl, annotations);
  const html = `<!DOCTYPE html><html><body>\n${body}</body></html>`;
  const plain = renderNodePlain(root, 0, nodes, childMap, annotations);
  const nested = nodeToNBlocks(root, 0, nodes, childMap, persistentHl, annotations);
  const { flat: blocks, childrenMap } = splitBlocks(nested);

  return { html, plain, blocks, childrenMap };
}
