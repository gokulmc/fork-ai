'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Branch, X } from './Icons';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
}

interface InlineNotePopProps {
  rect: Rect;
  question: string | undefined;
  // undefined while the answer is still in flight (optimistic marker, request pending).
  answer: string | undefined;
  onBranch: () => void;
  onClose: () => void;
}

// #237 Phase 1b — compact read-only popover opened by clicking a passage's
// inline-note marker. Positioning/exit-animation approach mirrors FollowUpPop
// (same hlIn/popOutLeft keyframes, same rect-relative placement), but this one
// also closes on outside click since it isn't a form — there's no "did the
// user mean to dismiss unsaved input" concern.
export function InlineNotePop({ rect, question, answer, onBranch, onClose }: InlineNotePopProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [closing, setClosing] = useState(false);

  const closingRef = useRef(false);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(onClose, 500); // keep in sync with popOutLeft duration in globals.css
  }, [onClose]);

  useEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (window.innerWidth <= 768) {
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
    const vv = window.visualViewport;
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    return () => {
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
    };
  }, [rect.left, rect.top, rect.width, rect.height, rect.bottom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) requestClose();
    };
    window.addEventListener('keydown', onKey);
    // capture phase: the marker's own click listener runs first (bubble) on the
    // click that opened this popover — a plain bubble-phase document listener
    // added synchronously in that same click would also fire on it and instantly
    // re-close. Using mousedown (not click) alongside React's synthetic click
    // batching already avoids that race, but capture keeps this listener
    // ordering-independent of any stopPropagation() elsewhere in the tree.
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('touchstart', onPointerDown, true);
    };
  }, [requestClose]);

  return (
    <div ref={ref} className={`inline-note-pop${closing ? ' inline-note-pop--closing' : ''}`} style={{ left: pos.left, top: pos.top }}>
      {question && <div className="q">{question}</div>}
      <div className="a">{answer ?? <><span className="spinner" style={{ width: 10, height: 10 }} /> Thinking…</>}</div>
      <div className="actions">
        <button className="btn-close" onClick={requestClose} title="Close" aria-label="Close">
          <X size={13} />
        </button>
        <button className="btn-branch" disabled={!answer} onClick={onBranch}>
          <Branch size={12} /> Branch this out
        </button>
      </div>
    </div>
  );
}
