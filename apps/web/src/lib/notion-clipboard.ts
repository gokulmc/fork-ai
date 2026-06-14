import { marked } from 'marked';
import type { ForkNode, Annotation, PersistentHighlight, CitationSource } from './types';

marked.use({ gfm: true, breaks: false });

const NOTION_LANGUAGES = new Set(['abap','abc','agda','arduino','ascii art','assembly','bash','basic','bnf','c','c#','c++','clojure','coffeescript','coq','css','dart','dhall','diff','docker','ebnf','elixir','elm','erlang','f#','flow','fortran','gherkin','glsl','go','graphql','groovy','haskell','hcl','html','idris','java','javascript','json','julia','kotlin','latex','less','lisp','livescript','llvm ir','lua','makefile','markdown','markup','matlab','mathematica','mermaid','nix','notion formula','objective-c','ocaml','pascal','perl','php','plain text','powershell','prolog','protobuf','purescript','python','r','racket','reason','ruby','rust','sass','scala','scheme','scss','shell','smalltalk','solidity','sql','swift','toml','typescript','vb.net','verilog','vhdl','visual basic','webassembly','xml','yaml','java/c/c++/c#']);

function toNotionLang(lang: string): string {
  const l = lang.toLowerCase();
  return NOTION_LANGUAGES.has(l) ? l : 'plain text';
}

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
  text: { content: string; link: { url: string } | null };
  annotations: NAnnotations;
}

type NBlock =
  | { type: 'heading_1'; heading_1: { rich_text: NRichText[]; is_toggleable: boolean; color: string }; children?: NBlock[] }
  | { type: 'heading_2'; heading_2: { rich_text: NRichText[]; is_toggleable: boolean; color: string }; children?: NBlock[] }
  | { type: 'heading_3'; heading_3: { rich_text: NRichText[]; is_toggleable: boolean; color: string }; children?: NBlock[] }
  | { type: 'paragraph'; paragraph: { rich_text: NRichText[]; color: string } }
  | { type: 'callout'; callout: { rich_text: NRichText[]; icon: { type: 'emoji'; emoji: string }; color: string } }
  | { type: 'code'; code: { rich_text: NRichText[]; caption: []; language: string } }
  | { type: 'quote'; quote: { rich_text: NRichText[]; color: string } }
  | { type: 'bulleted_list_item'; bulleted_list_item: { rich_text: NRichText[]; color: string } }
  | { type: 'numbered_list_item'; numbered_list_item: { rich_text: NRichText[]; color: string } }
  | { type: 'table'; table: { table_width: number; has_column_header: boolean; has_row_header: boolean; children: NBlock[] } }
  | { type: 'table_row'; table_row: { cells: NRichText[][] } };

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

function makeLink(content: string, url: string, ann: Partial<NAnnotations> = {}): NRichText {
  return {
    type: 'text',
    text: { content, link: { url } },
    annotations: {
      bold: false, italic: false, strikethrough: false,
      underline: false, code: false, color: 'default',
      ...ann,
    },
  };
}

// The LLM pipeline emits inline citations in two forms that Notion's line-by-line
// parser would otherwise dump as literal HTML text:
//   • processed (child nodes): …<sup class="cite-ref"><a …>[N]</a></sup>
//   • raw (streamed root nodes): <cite index="5-3,5-4">…</cite>
// Strip the hyperlink wrappers — keep the [N] marker (it lines up with the numbered
// "Sources" list), and unwrap raw <cite> tags to their plain inner text.
function stripCiteRefs(body: string): string {
  return body
    .replace(/<sup class="cite-ref">(?:<a\b[^>]*>)?(\[\d+\])(?:<\/a>)?<\/sup>/g, '$1')
    .replace(/<cite\b[^>]*>([\s\S]*?)<\/cite>/g, '$1');
}

// Numbered references list at the bottom of a node, ordered to match the [N] markers.
function sourcesNBlocks(sources: CitationSource[] | undefined): NBlock[] {
  if (!sources?.length) return [];
  const blocks: NBlock[] = [
    { type: 'heading_3', heading_3: { rich_text: [makeRT('Sources', { bold: true })], is_toggleable: false, color: 'default' } },
  ];
  for (const src of sources) {
    blocks.push({
      type: 'numbered_list_item',
      numbered_list_item: { rich_text: [makeLink(src.title, src.url)], color: 'default' },
    });
  }
  return blocks;
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

// Split a table row on | while ignoring | inside backtick spans
function splitTableRow(row: string): NRichText[][] {
  const cells: NRichText[][] = [];
  let cur = '';
  let inCode = false;
  for (const ch of row) {
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) { cells.push(inlineToRT(cur.trim())); cur = ''; }
    else cur += ch;
  }
  cells.push(inlineToRT(cur.trim()));
  return cells.slice(1, -1); // drop the empty strings from leading/trailing |
}

// Parse a markdown body → NBlock[] (line-by-line to handle mixed content correctly)
function mdToBlocks(body: string, highlights: PersistentHighlight[]): NBlock[] {
  const blocks: NBlock[] = [];
  // Split off fenced code blocks first; process the rest line by line
  const parts = body.split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    const codeMatch = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
    if (codeMatch) {
      blocks.push({
        type: 'code',
        code: {
          rich_text: [makeRT(codeMatch[2].trimEnd())],
          caption: [],
          language: toNotionLang(codeMatch[1] || 'plain text'),
        },
      });
      continue;
    }

    const lines = part.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      // Heading
      const hm = line.match(/^(#{1,4})\s+(.+)/);
      if (hm) {
        const level = Math.min(hm[1].length, 3);
        const rt = applyHlsToRichText(inlineToRT(hm[2]), highlights);
        if (level === 1) blocks.push({ type: 'heading_1', heading_1: { rich_text: rt, is_toggleable: false as unknown as true, color: 'default' } });
        else if (level === 2) blocks.push({ type: 'heading_2', heading_2: { rich_text: rt, is_toggleable: false, color: 'default' } });
        else blocks.push({ type: 'heading_3', heading_3: { rich_text: rt, is_toggleable: false, color: 'default' } });
        i++; continue;
      }

      // Blockquote
      if (line.startsWith('> ')) {
        const rt = applyHlsToRichText(inlineToRT(line.slice(2)), highlights);
        blocks.push({ type: 'quote', quote: { rich_text: rt, color: 'default' } });
        i++; continue;
      }

      // Bullet list item
      if (line.match(/^[-*]\s/)) {
        const lm = line.match(/^[-*]\s+(.+)/);
        if (lm) {
          const rt = applyHlsToRichText(inlineToRT(lm[1]), highlights);
          blocks.push({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt, color: 'default' } });
        }
        i++; continue;
      }

      // Numbered list item
      if (line.match(/^\d+\.\s/)) {
        const lm = line.match(/^\d+\.\s+(.+)/);
        if (lm) {
          const rt = applyHlsToRichText(inlineToRT(lm[1]), highlights);
          blocks.push({ type: 'numbered_list_item', numbered_list_item: { rich_text: rt, color: 'default' } });
        }
        i++; continue;
      }

      // Table — consume all consecutive pipe-starting lines
      if (line.trimStart().startsWith('|')) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].trimStart().startsWith('|')) {
          tableLines.push(lines[i]);
          i++;
        }
        // Drop separator rows (e.g. |---|---|)
        const dataRows = tableLines.filter(l => !l.match(/^\|[-:\s|]+\|$/));
        if (dataRows.length > 0) {
          const parsedRows = dataRows.map(splitTableRow);
          const tableWidth = Math.max(...parsedRows.map(r => r.length));
          const tableChildren: NBlock[] = parsedRows.map(cells => {
            const padded = [...cells];
            while (padded.length < tableWidth) padded.push([makeRT('')]);
            return { type: 'table_row' as const, table_row: { cells: padded } };
          });
          blocks.push({
            type: 'table' as const,
            table: { table_width: tableWidth, has_column_header: true, has_row_header: false, children: tableChildren },
          });
        }
        continue;
      }

      // Paragraph — collect consecutive plain lines (stop at blank, special syntax, or code fence)
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].match(/^(#{1,4}\s|>|[-*]\s|\d+\.\s)/) &&
        !lines[i].trimStart().startsWith('|') &&
        !lines[i].startsWith('```')
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length > 0) {
        const rt = applyHlsToRichText(inlineToRT(paraLines.join(' ')), highlights);
        blocks.push({ type: 'paragraph', paragraph: { rich_text: rt, color: 'default' } });
      }
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

  for (const section of node.sections) {
    const hls = persistentHl[`${node.id}::${section.id}`] ?? [];
    const callouts = annotations.filter(a => a.nodeId === node.id && a.sectionId === section.id);

    // depth 0 → H1 blue; depth 1 → H3 default; depth 2+ → bold paragraph.
    // Verbose branch answers carry one section with an empty heading — skip the
    // heading block entirely so the body reads as flowing prose.
    if (section.heading) {
      if (depth === 0) {
        sectionBlocks.push({ type: 'heading_1', heading_1: { rich_text: [makeRT(section.heading, { color: 'blue' })], is_toggleable: false, color: 'default' } });
      } else if (depth === 1) {
        sectionBlocks.push({ type: 'heading_3', heading_3: { rich_text: [makeRT(section.heading)], is_toggleable: false, color: 'default' } });
      } else {
        sectionBlocks.push({ type: 'paragraph', paragraph: { rich_text: [makeRT(section.heading, { bold: true })], color: 'default' } });
      }
    }

    sectionBlocks.push(...mdToBlocks(stripCiteRefs(section.body), hls));

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

  // References for this node's cited sources, at the bottom of its content
  sectionBlocks.push(...sourcesNBlocks(node.sources));

  if (depth === 0) {
    return [
      { type: 'paragraph', paragraph: { rich_text: [makeRT(stripCiteRefs(node.lede))], color: 'default' } },
      ...sectionBlocks,
    ];
  }

  // Child: toggle heading — depth 1 = H2 purple, depth 2 = H3 green, depth 3+ = H3 yellow
  const emojiPrefix = node.emoji ? `${node.emoji} ` : '';
  const innerBlocks: NBlock[] = [
    { type: 'paragraph', paragraph: { rich_text: [makeRT(stripCiteRefs(node.lede), { italic: true })], color: 'default' } },
    ...sectionBlocks,
  ];
  if (depth === 1) {
    return [{ type: 'heading_2', heading_2: { rich_text: [makeRT(`${emojiPrefix}${node.title}`, { color: 'purple' })], is_toggleable: true, color: 'default' }, children: innerBlocks }];
  } else if (depth === 2) {
    return [{ type: 'heading_3', heading_3: { rich_text: [makeRT(`${emojiPrefix}${node.title}`, { color: 'green' })], is_toggleable: true, color: 'default' }, children: innerBlocks }];
  } else {
    return [{ type: 'heading_3', heading_3: { rich_text: [makeRT(`${emojiPrefix}${node.title}`, { color: 'yellow' })], is_toggleable: true, color: 'default' }, children: innerBlocks }];
  }
}

// ── Mermaid mind map ──────────────────────────────────────────────────────────

function buildMermaid(
  nodes: Record<string, ForkNode>,
  rootId: string,
  childMap: Record<string, string[]>,
  depthCap = 5,
): NBlock {
  const lines: string[] = ['graph TD'];
  const idMap = new Map<string, string>();
  let counter = 0;

  function safeId(nodeId: string): string {
    if (!idMap.has(nodeId)) idMap.set(nodeId, `n${counter++}`);
    return idMap.get(nodeId)!;
  }

  function visit(nodeId: string, depth: number): void {
    if (depth > depthCap) return;
    const node = nodes[nodeId];
    if (!node || node.loading) return;
    const label = `${node.emoji ? node.emoji + ' ' : ''}${node.title}`.replace(/"/g, "'");
    lines.push(`  ${safeId(nodeId)}["${label}"]`);
    for (const kidId of childMap[nodeId] ?? []) {
      if (!nodes[kidId] || nodes[kidId].loading) continue;
      lines.push(`  ${safeId(nodeId)} --> ${safeId(kidId)}`);
      visit(kidId, depth + 1);
    }
  }

  visit(rootId, 0);

  return {
    type: 'code',
    code: { rich_text: [makeRT(lines.join('\n'))], caption: [], language: 'mermaid' },
  };
}

// ── HTML format ───────────────────────────────────────────────────────────────

function applyHlsToHtml(html: string, highlights: PersistentHighlight[]): string {
  let result = html;
  for (const hl of highlights) {
    if (!hl.text) continue;
    // hl.bg may be a non-hex sentinel (e.g. 'branch' for Ask-AI source text) — fall
    // back to a real colour so the inline style is valid CSS.
    const bgCss = hl.bg?.startsWith('#') ? hl.bg : '#e5e5e5';
    const style = [`background-color: ${bgCss}`, hl.fg ? `color: ${hl.fg}` : null]
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
    if (section.heading) {
      const htag = `h${sectionHeadingLevel}`;
      html += `<${htag}>${escHtml(section.heading)}</${htag}>\n`;
    }
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
    return `<h1>${escHtml(node.title)}</h1>\n<p>${escHtml(stripCiteRefs(node.lede))}</p>\n${sectionsHtml}${orphansHtml}`;
  }

  const toggleLevel = Math.min(depth, 3);
  const ttag = `h${toggleLevel}`;
  const inner = `<p><em>${escHtml(stripCiteRefs(node.lede))}</em></p>\n${sectionsHtml}${orphansHtml}`;
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
  let text = `${hashes} ${node.title}\n\n${stripCiteRefs(node.lede)}\n\n`;

  for (const section of node.sections) {
    text += section.heading ? `${sHashes} ${section.heading}\n\n${section.body}\n\n` : `${section.body}\n\n`;
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
// Notion's pages.create rejects toggle-heading blocks with inline `children`.
// We split those into a flat block array + a recursive children map so the
// server can depth-first append them after page creation.
//
// Tables are exempt: their rows live inside `table.children` (not block-level
// `children`), so splitBlocks never sees them and they travel inline as-is.

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

// ── Starred nodes section ─────────────────────────────────────────────────────

// One starred node's own content (lede + sections + callouts + sources) as a
// heading_3 toggle. Descendants are intentionally NOT walked — they already
// appear in the main body, so re-rendering them here would duplicate content.
function starredNodeBlocks(
  node: ForkNode,
  persistentHl: Record<string, PersistentHighlight[]>,
  annotations: Annotation[],
): NBlock {
  const inner: NBlock[] = [
    { type: 'paragraph', paragraph: { rich_text: [makeRT(stripCiteRefs(node.lede), { italic: true })], color: 'default' } },
  ];

  for (const section of node.sections) {
    const hls = persistentHl[`${node.id}::${section.id}`] ?? [];
    const callouts = annotations.filter(a => a.nodeId === node.id && a.sectionId === section.id);

    if (section.heading) {
      inner.push({ type: 'paragraph', paragraph: { rich_text: [makeRT(section.heading, { bold: true })], color: 'default' } });
    }
    inner.push(...mdToBlocks(stripCiteRefs(section.body), hls));
    for (const c of callouts) {
      inner.push({ type: 'callout', callout: { rich_text: [makeRT(c.text)], icon: { type: 'emoji', emoji: '💡' }, color: 'default' } });
    }
  }

  inner.push(...sourcesNBlocks(node.sources));

  const emojiPrefix = node.emoji ? `${node.emoji} ` : '';
  return { type: 'heading_3', heading_3: { rich_text: [makeRT(`${emojiPrefix}${node.title}`, { color: 'yellow' })], is_toggleable: true, color: 'default' }, children: inner };
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
  const mermaid = buildMermaid(nodes, rootId, childMap);
  const nested = nodeToNBlocks(root, 0, nodes, childMap, persistentHl, annotations);

  const starred = Object.values(nodes)
    .filter(n => n.starred && !n.loading)
    .sort((a, b) => a.createdAt - b.createdAt);
  const starredSection: NBlock[] = starred.length
    ? [{
        type: 'heading_2',
        heading_2: { rich_text: [makeRT('⭐ Starred nodes')], is_toggleable: true, color: 'default' },
        children: starred.map(n => starredNodeBlocks(n, persistentHl, annotations)),
      }]
    : [];

  const { flat: blocks, childrenMap } = splitBlocks([mermaid, ...starredSection, ...nested]);

  return { html, plain, blocks, childrenMap };
}
