'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { Sparkles, Lightbulb, Copy, Highlighter } from './Icons';

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

type HlAction = 'ask' | 'highlight' | 'callout' | 'copy';

interface HighlightMenuProps {
  visible: boolean;
  rect: Rect;
  lastColors: { bg: string; fg: string | null };
  onAction: (action: HlAction, payload?: { bg: string; fg: string | null }) => void;
  onClose: () => void;
}

// Estimated half-width for viewport clamping (avoids DOM reads that cause Safari selection loss)
const HALF_W = 180;
const MENU_H = 46;

export function HighlightMenu({ visible, rect, lastColors, onAction, onClose }: HighlightMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [showColors, setShowColors] = useState(false);

  const fg = lastColors.fg ?? null;
  const bg = lastColors.bg ?? '#fef08a';

  // Pure-math positioning: left = center of selection (CSS transform handles -50% offset)
  const pos = useMemo(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    // On mobile the +20% toolbar can be wider than the HALF_W estimate, so the
    // viewport-margin clamp leaves a button clipped off-frame. Pin it horizontally
    // centred instead (CSS caps its width + wraps), keeping it fully in-frame.
    const cx = vw <= 768 ? vw / 2 : rect.left + rect.width / 2;
    const left = vw <= 768 ? cx : Math.max(12 + HALF_W, Math.min(vw - 12 - HALF_W, cx));
    const top = rect.top - MENU_H - 10 >= 12 ? rect.top - MENU_H - 10 : rect.bottom + 10;
    return { left, top };
  }, [rect.left, rect.top, rect.width, rect.height, rect.bottom]);

  useEffect(() => {
    if (!visible) setShowColors(false);
  }, [visible]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`hl-menu${visible ? ' hl-menu--visible' : ''}`}
      style={{ left: pos.left, top: pos.top, opacity: visible ? undefined : 0, pointerEvents: visible ? undefined : 'none' }}
      onMouseDown={e => e.preventDefault()}
    >
      <button className="primary" onClick={() => onAction('ask')} title="Ask a follow-up — creates a child node">
        <Sparkles size={14} />
        Ask AI
      </button>
      <span className="sep" />

      {/* Highlight button with embedded color picker */}
      <div className="hl-btn-wrap">
        <button
          className="hl-main-btn"
          style={{ '--hl-color': bg } as React.CSSProperties}
          onClick={() => onAction('highlight', { bg, fg })}
          title="Highlight with current color"
        >
          <Highlighter size={13} />
          <span className="hl-dot" style={{ background: bg }} />
        </button>
        <button
          className="hl-expand-btn"
          onClick={() => setShowColors(v => !v)}
          title="Choose color"
          aria-label="Choose highlight color"
        >
          <span className="hl-chevron" style={{ transform: showColors ? 'rotate(180deg)' : undefined }}>▾</span>
        </button>
        {showColors && (
          <div className="hl-color-pop" onMouseDown={e => e.preventDefault()}>
            <div className="hl-color-row">
              {HL_BG_COLORS.map(c => (
                <button
                  key={c}
                  className={`hl-swatch${bg === c ? ' active' : ''}`}
                  style={{ background: c }}
                  onClick={() => { onAction('highlight', { bg: c, fg }); setShowColors(false); }}
                  title={`Highlight · ${c}`}
                />
              ))}
            </div>
            <div className="hl-color-row">
              {HL_FG_COLORS.map((c, i) => (
                <button
                  key={i}
                  className={`hl-fg-swatch${(fg ?? null) === c.value ? ' active' : ''}`}
                  style={{ color: c.value ?? 'var(--ink)' }}
                  onClick={() => { onAction('highlight', { bg, fg: c.value }); setShowColors(false); }}
                  title={`Text · ${c.label}`}
                >A</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <span className="sep" />
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
