'use client';
import { useState, useEffect, useRef } from 'react';
import { Sparkles, FileText, Lightbulb, Copy } from './Icons';

const HL_BG_COLORS = ['#fef08a', '#bbf7d0', '#bae6fd', '#fbcfe8', '#e5e5e5'];
const HL_FG_COLORS = [
  { value: null, label: 'Default' },
  { value: '#b91c1c', label: 'Red' },
  { value: '#1d4ed8', label: 'Blue' },
  { value: '#047857', label: 'Green' },
];

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
}

type HlAction =
  | 'ask'
  | 'highlight'
  | 'note'
  | 'callout'
  | 'copy';

interface HighlightMenuProps {
  rect: Rect;
  lastColors: { bg: string; fg: string | null };
  onAction: (action: HlAction, payload?: { bg: string; fg: string | null }) => void;
  onClose: () => void;
}

export function HighlightMenu({ rect, lastColors, onAction, onClose }: HighlightMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!ref.current) return;
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;
    let top = rect.top - h - 10;
    if (top < 12) top = rect.bottom + 10;
    left = Math.max(12, Math.min(window.innerWidth - w - 12, left));
    setPos({ left, top });
  }, [rect.left, rect.top, rect.width, rect.height, rect.bottom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fg = lastColors.fg ?? null;
  const bg = lastColors.bg ?? '#fef08a';

  return (
    <div
      ref={ref}
      className="hl-menu"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={e => e.preventDefault()}
    >
      <button className="primary" onClick={() => onAction('ask')} title="Ask a follow-up — creates a child node">
        <Sparkles size={14} />
        Ask AI
      </button>
      <span className="sep" />
      <div className="hl-colors" title="Highlight color">
        {HL_BG_COLORS.map(c => (
          <button
            key={c}
            className={`hl-swatch${bg === c ? ' active' : ''}`}
            style={{ background: c }}
            onClick={() => onAction('highlight', { bg: c, fg })}
            title={`Highlight · ${c}`}
            aria-label={`Highlight background ${c}`}
          />
        ))}
      </div>
      <span className="sep" />
      <div className="hl-fg-colors" title="Text color">
        {HL_FG_COLORS.map((c, i) => (
          <button
            key={i}
            className={`hl-fg-swatch${(fg ?? null) === c.value ? ' active' : ''}`}
            style={{ color: c.value ?? 'var(--ink)' }}
            onClick={() => onAction('highlight', { bg, fg: c.value })}
            title={`Text · ${c.label}`}
            aria-label={`Text color ${c.label}`}
          >A</button>
        ))}
      </div>
      <span className="sep" />
      <button onClick={() => onAction('note')} title="Save to Notes">
        <FileText size={14} />
        Note
      </button>
      <button onClick={() => onAction('callout')} title="Pin as callout">
        <Lightbulb size={14} />
        Callout
      </button>
      <button onClick={() => onAction('copy')} title="Copy">
        <Copy size={14} />
      </button>
    </div>
  );
}
