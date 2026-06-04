'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, X } from './Icons';
import { truncate } from '@/lib/utils';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
}

interface FollowUpPopProps {
  rect: Rect;
  sourceText: string;
  loading: boolean;
  onSubmit: (question: string) => void;
  onClose: () => void;
}

const SHORTHANDS: Record<string, string> = {
  '?': 'what',
  '!?': 'how',
  '/?': 'why',
  '>?': 'explain',
};

export function FollowUpPop({ rect, sourceText, loading, onSubmit, onClose }: FollowUpPopProps) {
  const ref = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [closing, setClosing] = useState(false);

  // Mobile only: play the slide-left exit, then unmount. Desktop closes instantly
  // (X / Esc) as before. closingRef guards against double-fire.
  const closingRef = useRef(false);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    if (window.innerWidth > 768) { onClose(); return; }
    closingRef.current = true;
    setClosing(true);
    setTimeout(onClose, 300); // keep in sync with popOutLeft duration in globals.css
  }, [onClose]);

  useEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (window.innerWidth <= 768) {
        // Mobile: always centre on the *visible* viewport. visualViewport excludes
        // the on-screen keyboard, so the popup stays centred in the area the user
        // can actually see (and re-centres when the keyboard opens — see listeners).
        // `left` is the CENTRE x, not the edge: the shared hlIn animation leaves a
        // persistent transform: translateX(-50%) on the popup (fill: both), so the
        // element is shifted left by half its width — feeding it the centre cancels out.
        const vv = window.visualViewport;
        const availW = vv?.width ?? window.innerWidth;
        const availH = vv?.height ?? window.innerHeight;
        const offX = vv?.offsetLeft ?? 0;
        const offY = vv?.offsetTop ?? 0;
        setPos({ left: offX + availW / 2, top: offY + Math.max(12, (availH - h) / 2) });
        return;
      }
      let left = rect.left + rect.width / 2 - w / 2;
      let top = rect.bottom + 10;
      if (top + h > window.innerHeight - 12) top = rect.top - h - 10;
      if (top < 12) top = 12;
      left = Math.max(12, Math.min(window.innerWidth - w - 12, left));
      setPos({ left, top });
    };
    place();
    // preventScroll: the popup is already centred in view, so don't let focusing the
    // textarea scroll/zoom the reading pane behind it to "reveal" the input (iOS does
    // this, leaving the prose shifted after the popup closes).
    setTimeout(() => taRef.current?.focus({ preventScroll: true }), 30);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    return () => {
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
    };
  }, [rect.left, rect.top, rect.width, rect.height, rect.bottom]);

  const handleSubmit = () => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const expanded = SHORTHANDS[trimmed] ?? trimmed;
    setQ(expanded);
    onSubmit(expanded);
    // Mobile: close on branch (slide-left exit) — the loading node already shows on
    // the map and the popup covers the whole small screen. Desktop keeps it open so a
    // follow-up question can be asked while the first one loads.
    if (window.innerWidth <= 768) requestClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && q.trim()) handleSubmit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q, onSubmit, requestClose]);

  return (
    <div ref={ref} className={`followup-pop${closing ? ' followup-pop--closing' : ''}`} style={{ left: pos.left, top: pos.top }}>
      <div className="src">{truncate(sourceText, 180)}</div>
      <textarea
        ref={taRef}
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Ask anything about this passage…"
        disabled={loading}
      />
      <div className="actions">
        <span className="hint">⌘ + ⏎ to send · Esc to close</span>
        <div className="actions-right">
          <button className="btn-close" onClick={requestClose} title="Close" aria-label="Close">
            <X size={14} />
          </button>
          <button
            className="btn-primary"
            disabled={!q.trim() || loading}
            onClick={handleSubmit}
          >
            {loading ? (
              <><span className="spinner" style={{ width: 10, height: 10 }} /> Asking…</>
            ) : (
              <><Sparkles size={13} /> Branch</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
