'use client';
import { useMemo, useEffect, useRef } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import type { Section as SectionData, ForkNode, Annotation, PersistentHighlight } from '@/lib/types';
import { CornerDownRight, Branch, ChevronRight, Lightbulb, X } from './Icons';

const CSS_HL_SUPPORTED = typeof window !== 'undefined' && typeof CSS !== 'undefined' && 'highlights' in CSS;

// Module-level adopted stylesheet — one rule per section ID, created lazily.
let _hlSheet: CSSStyleSheet | null = null;
const _hlRules = new Set<string>();

function ensureHlRule(sectionId: string): void {
  if (_hlRules.has(sectionId)) return;
  if (!_hlSheet) {
    _hlSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, _hlSheet];
  }
  _hlSheet.insertRule(
    `::highlight(hl-${sectionId}) { background-color: var(--hl-persistent, #fef08a); }`,
  );
  _hlRules.add(sectionId);
}

marked.use({ gfm: true, breaks: false });

function escapeHTML(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMd(src: string): string {
  if (!src) return '';
  try {
    return marked.parse(src) as string;
  } catch {
    return src.split(/\n\n+/).map(p => `<p>${escapeHTML(p)}</p>`).join('');
  }
}


function selectSentenceAtPoint(blockEl: Element, e: MouseEvent) {
  const text = blockEl.textContent ?? '';
  if (!text.trim()) return;

  // Find where the user clicked within the flattened text
  const caretRange =
    (document.caretRangeFromPoint?.(e.clientX, e.clientY)) ??
    (() => {
      const pos = (document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null }).caretPositionFromPoint?.(e.clientX, e.clientY);
      if (!pos) return null;
      const r = document.createRange();
      r.setStart(pos.offsetNode, pos.offset);
      return r;
    })();
  if (!caretRange) return;

  // Map clicked text-node offset → absolute offset in blockEl's text
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT, null);
  let abs = 0;
  let clickedAbs = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node === caretRange.startContainer) { clickedAbs = abs + caretRange.startOffset; break; }
    abs += (node.nodeValue ?? '').length;
  }

  // Find sentence boundaries (end = ". " / "! " / "? " patterns)
  let start = 0;
  let end = text.length;
  const bound = /[.!?]['"'’”]?\s+/g;
  let m: RegExpExecArray | null;
  while ((m = bound.exec(text)) !== null) {
    const b = m.index + m[0].length;
    if (b <= clickedAbs) start = b;
    else { end = b - 1; break; }
  }
  // trim leading whitespace
  while (start < end && /\s/.test(text[start])) start++;

  // Build a range over [start, end] in the block's text nodes
  const range = document.createRange();
  let pos = 0;
  let startSet = false;
  const w2 = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT, null);
  while ((node = w2.nextNode())) {
    const len = (node.nodeValue ?? '').length;
    if (!startSet && pos + len > start) {
      range.setStart(node, start - pos);
      startSet = true;
    }
    if (startSet && pos + len >= end) {
      range.setEnd(node, Math.min(end - pos, len));
      break;
    }
    pos += len;
  }
  if (startSet) {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}

function handleBodyClick(e: React.MouseEvent<HTMLDivElement>) {
  if (e.detail < 3) return;
  e.preventDefault();

  const target = e.target as Element;
  const block =
    target.closest?.('p, li, blockquote, td, th, h1, h2, h3, h4, pre') ??
    (target.nodeType === 3 ? target.parentElement : target);
  if (!block) return;

  if (e.detail >= 4) {
    // Select entire block element
    const range = document.createRange();
    range.selectNodeContents(block);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } else {
    // Triple-click → select sentence
    selectSentenceAtPoint(block, e.nativeEvent);
  }
}

interface SectionProps {
  idx: number;
  section: SectionData;
  node: ForkNode;
  highlights: PersistentHighlight[];
  onDeeper: (section: SectionData) => void;
  deeperLoading: boolean;
  sectionChildren: ForkNode[];
  onChildClick: (id: string) => void;
  calloutsForSection: Annotation[];
  onRemoveCallout: (id: string) => void;
}

export function Section({
  idx,
  section,
  node: _node,
  highlights,
  onDeeper,
  deeperLoading,
  sectionChildren,
  onChildClick,
  calloutsForSection,
  onRemoveCallout,
}: SectionProps) {
  const num = String(idx + 1).padStart(2, '0');
  const bodyRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => renderMd(section.body), [section.body]);

  // Syntax highlighting for code blocks
  useEffect(() => {
    if (!bodyRef.current) return;
    bodyRef.current.querySelectorAll('pre').forEach(pre => {
      const codeEl = pre.querySelector('code');
      const m = codeEl?.className.match(/language-([a-zA-Z0-9+\-_#]+)/);
      if (m) pre.setAttribute('data-lang', m[1]);
    });
    bodyRef.current.querySelectorAll('pre code:not(.hljs)').forEach(el => {
      try { hljs.highlightElement(el as HTMLElement); } catch { /* ignore */ }
    });
  }, [html]);

  // Persistent highlights via CSS Custom Highlight API
  useEffect(() => {
    if (!CSS_HL_SUPPORTED || !bodyRef.current) return;
    const name = `hl-${section.id}`;
    CSS.highlights.delete(name);

    const withOffsets = highlights.filter(h => h.start != null && h.end != null);
    if (!withOffsets.length) return;

    ensureHlRule(section.id);
    const ranges: Range[] = [];

    for (const hl of withOffsets) {
      const walker = document.createTreeWalker(bodyRef.current, NodeFilter.SHOW_TEXT, null);
      let pos = 0;
      let startNode: Text | null = null, startOff = 0;
      let endNode: Text | null = null, endOff = 0;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const t = node as Text;
        const len = (t.nodeValue ?? '').length;
        if (!startNode && pos + len > hl.start!) { startNode = t; startOff = hl.start! - pos; }
        if (startNode && pos + len >= hl.end!) { endNode = t; endOff = hl.end! - pos; break; }
        pos += len;
      }
      if (startNode && endNode) {
        const r = new Range();
        r.setStart(startNode, startOff);
        r.setEnd(endNode, endOff);
        ranges.push(r);
      }
    }

    if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
    return () => { CSS.highlights.delete(name); };
  }, [highlights, html, section.id]);

  return (
    <section
      className="section appear"
      data-section-id={section.id}
      style={{ animationDelay: `${idx * 70}ms` }}
    >
      <div className="section-head">
        <span className="section-num">{num}</span>
        <h2 data-section-heading>{section.heading}</h2>
        <button
          className={`deeper-btn${deeperLoading ? ' loading' : ''}`}
          onClick={() => onDeeper(section)}
          disabled={deeperLoading}
          aria-label="Go deeper on this section"
          title="Go deeper — creates a child node"
        >
          {deeperLoading ? (
            <><span className="spinner" /> Thinking…</>
          ) : (
            <><CornerDownRight size={13} /> Go deeper</>
          )}
        </button>
      </div>
      <div
        className="section-body md"
        data-section-id={section.id}
        data-section-heading={section.heading}
        ref={bodyRef}
        onClick={handleBodyClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {calloutsForSection.length > 0 && (
        <div className="section-callouts">
          {calloutsForSection.map(c => (
            <div key={c.id} className="inline-callout">
              <Lightbulb size={18} className="ic" />
              <div className="body">
                <div className="kicker">Callout</div>
                {c.text}
              </div>
              <button className="close" onClick={() => onRemoveCallout(c.id)} title="Remove">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {sectionChildren.length > 0 && (
        <div className="section-children">
          {sectionChildren.map(c => (
            <button key={c.id} className="chip" onClick={() => onChildClick(c.id)}>
              <Branch size={13} className="ic" />
              {c.title}
              <ChevronRight size={11} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
