'use client';
import { useMemo, useEffect, useRef } from 'react';
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMd(section.body), [section.body]);

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
