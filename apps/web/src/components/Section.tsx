'use client';
import { useMemo, useEffect, useRef, memo } from 'react';
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import hljs from 'highlight.js';
import type { Section as SectionData, ForkNode, Annotation } from '@/lib/types';
import { CornerDownRight, Branch, ChevronRight, Lightbulb, X } from './Icons';

marked.use({ gfm: true, breaks: false });
// LLMs (esp. Gemini) emit LaTeX like $cos(\theta_{y_i})$ — render it instead of showing raw $…$.
// output:'html' skips KaTeX's duplicate MathML so the rendered text matches what highlight offsets are measured against.
marked.use(markedKatex({ throwOnError: false, output: 'html' }));

function escapeHTML(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Known LaTeX math commands. Used to tell math apart from real inline code: a
// whitelist (not a bare `\` test) so regexes like `\d+` or paths like `C:\Users`
// are never mistaken for math.
const LATEX_CMD =
  /\\(?:frac|sqrt|sum|prod|int|oint|partial|nabla|cdot|times|div|pm|mp|leq?|geq?|neq|approx|equiv|propto|infty|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega|hat|bar|vec|tilde|dot|mathbf|mathbb|mathcal|mathrm|boldsymbol|cos|sin|tan|sec|csc|cot|log|ln|exp|lim|sup|inf|arg|max|min)(?![A-Za-z])/;

// Gemini is inconsistent about math notation: it usually emits valid $…$ LaTeX
// (rendered by the katex extension above), but sometimes wraps the SAME LaTeX in
// an inline-code span (`\cos(\theta_j)`), which would render as monospace text.
// Unwrap code spans whose content is unambiguously LaTeX into $…$ so KaTeX renders
// them — skipping fenced code blocks and anything that isn't clearly math.
function unwrapCodeMath(src: string): string {
  let inFence = false;
  return src
    .split('\n')
    .map(line => {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line; }
      if (inFence) return line;
      return line.replace(/`([^`\n]+)`/g, (m, code) =>
        !code.includes('$') && LATEX_CMD.test(code) ? `$${code}$` : m,
      );
    })
    .join('\n');
}

// DeepSeek/GPT often emit math with LaTeX \(…\) / \[…\] delimiters instead of $…$.
// marked doesn't recognise those: it strips the escaping backslash off the bracket
// (\(→(, \[→[), so the bare LaTeX leaks into the prose (subscripts even become <em>).
// Pre-render these to KaTeX HTML behind an @@MATH-n@@ sentinel so marked never touches
// the math — this also sidesteps marked-katex's $-delimiter quirks (a closing $ adjacent
// to ")" doesn't match, and "$5 … $10" WOULD falsely match) without changing the $…$ path.
const BRACKET_MATH = /\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;
function extractBracketMath(src: string): { text: string; math: string[] } {
  const math: string[] = [];
  const text = src
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((seg, i) =>
      i % 2 === 1
        ? seg // fenced code block — leave the delimiters literal
        : seg.replace(BRACKET_MATH, (_m, block, inline) => {
            math.push(
              katex.renderToString((block ?? inline).trim(), {
                throwOnError: false,
                output: 'html',
                displayMode: block != null,
              }),
            );
            return `@@MATH${math.length - 1}@@`;
          }),
    )
    .join('');
  return { text, math };
}

function renderMd(src: string): string {
  if (!src) return '';
  try {
    const { text, math } = extractBracketMath(unwrapCodeMath(src));
    const html = marked.parse(text) as string;
    return math.length ? html.replace(/@@MATH(\d+)@@/g, (_m, i) => math[+i]) : html;
  } catch {
    return src.split(/\n\n+/).map(p => `<p>${escapeHTML(p)}</p>`).join('');
  }
}


function selectSentenceAtPoint(blockEl: Element, clientX: number, clientY: number) {
  const text = blockEl.textContent ?? '';
  if (!text.trim()) return;

  // Find where the user clicked/tapped within the flattened text
  const caretRange =
    (document.caretRangeFromPoint?.(clientX, clientY)) ??
    (() => {
      const pos = (document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null }).caretPositionFromPoint?.(clientX, clientY);
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
    selectSentenceAtPoint(block, e.nativeEvent.clientX, e.nativeEvent.clientY);
  }
}

// Mobile has no triple-click — a single tap selects the sentence under the finger
// (the touch analog of handleBodyClick's sentence selection). The App-level touchend
// listener then reads the selection and pops the highlight menu. Long-presses (native
// selection) and drags/scrolls are excluded by the duration + movement guards.
const TAP_MOVE_PX = 10;
const TAP_MAX_MS = 350;

function tapSelectHandlers() {
  let start: { x: number; y: number; t: number; hadSelection: boolean } | null = null;
  return {
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) { start = null; return; }
      const t = e.touches[0];
      // Read the selection NOW — React's onTouchStart fires before the browser
      // collapses it on tap (and before App's document touchstart clears the menu).
      const sel = window.getSelection();
      const hadSelection = !!sel && !sel.isCollapsed && sel.toString().trim().length >= 3;
      start = { x: t.clientX, y: t.clientY, t: e.timeStamp, hadSelection };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start;
      start = null;
      if (!s || e.changedTouches.length !== 1) return;
      const t = e.changedTouches[0];
      if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > TAP_MOVE_PX) return; // drag / scroll
      if (e.timeStamp - s.t > TAP_MAX_MS) return;                            // long-press → native selection
      // A tap while a sentence is already selected just dismisses it — the next tap
      // selects fresh. Collapse it so the menu doesn't immediately re-open.
      if (s.hadSelection) { window.getSelection()?.removeAllRanges(); return; }
      const target = e.target as Element;
      if (target.closest?.('a, button, pre, code')) return;                  // don't hijack links / code / controls
      const block = target.closest?.('p, li, blockquote, td, th, h1, h2, h3, h4');
      if (!block) return;
      e.preventDefault(); // stop the synthetic tap from collapsing the selection we set
      selectSentenceAtPoint(block, t.clientX, t.clientY);
    },
  };
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
  const tap = useMemo(tapSelectHandlers, []);

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
      onTouchStart={tap.onTouchStart}
      onTouchEnd={tap.onTouchEnd}
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
      {/* Verbose branch answers (Go Deeper / Ask AI) carry one section with an
          empty heading — render them as flowing prose: no number, no heading,
          no per-section Go-deeper button. Branching there is highlight-driven. */}
      {section.heading && (
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
      )}
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
