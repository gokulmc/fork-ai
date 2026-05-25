'use client';
import { useMemo, useEffect, useRef, memo } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import type { Section as SectionData, ForkNode, Annotation } from '@/lib/types';
import { CornerDownRight, Branch, ChevronRight, Lightbulb, X } from './Icons';

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

// Isolated so its DOM is never touched when sectionChildren or callouts change.
// Browser text selection inside the body survives concurrent node arrivals.
const SectionBody = memo(function SectionBody({
  body,
  sectionId,
  sectionHeading,
  isFirst,
}: {
  body: string;
  sectionId: string;
  sectionHeading: string;
  isFirst?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMd(body), [body]);

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

  return (
    <div
      className="section-body md"
      data-section-id={sectionId}
      data-section-heading={sectionHeading}
      {...(isFirst ? { 'data-tour': 'tour-highlight' } : {})}
      ref={bodyRef}
      onClick={handleBodyClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

interface SectionProps {
  idx: number;
  section: SectionData;
  node: ForkNode;
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
  onDeeper,
  deeperLoading,
  sectionChildren,
  onChildClick,
  calloutsForSection,
  onRemoveCallout,
}: SectionProps) {
  const num = String(idx + 1).padStart(2, '0');

  return (
    <section
      className="section appear"
      data-section-id={section.id}
      style={{ animationDelay: `${idx * 70}ms` }}
      {...(idx === 0 ? { 'data-tour': 'tour-sections' } : {})}
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
      <SectionBody
        body={section.body}
        sectionId={section.id}
        sectionHeading={section.heading}
        isFirst={idx === 0}
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
