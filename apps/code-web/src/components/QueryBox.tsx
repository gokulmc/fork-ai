'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Search, ArrowRight, FileText } from './Icons';

const MAX_ROWS = 6;

interface QueryBoxProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  loading?: boolean;
  autoFocus?: boolean;
  readOnly?: boolean;
  submitLabel?: string;
  submitDisabled?: boolean;
  onPickFile?: () => void;
  fileBusy?: boolean;
  className?: string;
  children?: React.ReactNode;
}

// Shared by Landing, ProjectStart, and LandingHero so the query pill can't
// diverge across call sites. Single line renders pixel-identical to the old
// <input>-based box (see .query-box in globals.css); past one line it morphs
// into a card via the .query-box--multi class, driven by the `multi` state below.
export function QueryBox({
  value, onChange, onSubmit, placeholder, loading, autoFocus, readOnly,
  submitLabel, submitDisabled, onPickFile, fileBusy, className, children,
}: QueryBoxProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const baseHeightRef = useRef<number | null>(null);
  const prevValueRef = useRef(value);
  const [multi, setMulti] = useState(false);

  // Auto-grow 1→MAX_ROWS: reset to 'auto' first so shrinking (e.g. deleting
  // text back to one line) re-measures from zero instead of only ever growing.
  // `multi` is in the deps so the box re-measures once `.query-box` has flipped
  // row→column (which widens .qb-main and can change the wrap count) — without
  // this the height freezes at the stale, narrower-width wrap count, leaving a
  // dead gap. But re-*deciding* `multi` from that re-measurement would flip-flop
  // forever on boundary-length text (wraps at pill width → enters card mode →
  // fits one line at the wider card width → exits → wraps again → …), so `multi`
  // is only ever decided when `value` itself actually changed.
  useLayoutEffect(() => {
    if (readOnly) return;
    const el = textareaRef.current;
    if (!el) return;
    const valueChanged = prevValueRef.current !== value;
    prevValueRef.current = value;

    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    // el.scrollHeight includes the textarea's own vertical padding (border-box
    // sizing), but `lineHeight * MAX_ROWS` was pure text height with no
    // padding allowance -- the two sides of this clamp must be in the same
    // units, or "six rows" starts scrolling before six rows of text fit.
    const verticalPadding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    if (baseHeightRef.current === null) baseHeightRef.current = el.scrollHeight;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_ROWS + verticalPadding)}px`;
    if (valueChanged) {
      const isMulti = el.scrollHeight > baseHeightRef.current + 2;
      setMulti(prev => (prev === isMulti ? prev : isMulti));
    }
  }, [value, multi, readOnly]);

  // The page loads Google Fonts via <link> — a font swap after first paint
  // changes the textarea's line-box height, so the baseline captured on mount
  // can go stale and misfire the one-line/multi-line comparison. Recapture it
  // once fonts settle, with the field back at its natural (empty) height.
  useEffect(() => {
    if (readOnly || typeof document === 'undefined' || !document.fonts) return;
    document.fonts.ready.then(() => {
      const el = textareaRef.current;
      if (!el || el.value) return;
      el.style.height = 'auto';
      baseHeightRef.current = el.scrollHeight;
    });
  }, [readOnly]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') { (e.target as HTMLTextAreaElement).blur(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  const disabled = submitDisabled ?? (!value.trim() || loading);

  return (
    <div className={`query-box${multi ? ' query-box--multi' : ''}${className ?? ''}`} data-tour="tour-query">
      <div className="qb-main">
        <span className="icon"><Search size={20} /></span>
        <textarea
          ref={textareaRef}
          className="qb-input"
          rows={1}
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder}
          readOnly={readOnly}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="qb-actions">
        {onPickFile && (
          <button
            type="button"
            className="qb-file"
            disabled={loading || fileBusy}
            onClick={onPickFile}
            title="Build a mind map from a PDF, image, or text file"
            aria-label="Upload a PDF, image, or text file"
          >
            {fileBusy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <FileText size={18} />}
          </button>
        )}
        <button className="submit" disabled={disabled} onClick={onSubmit}>
          {loading ? (
            <><span className="spinner" style={{ width: 11, height: 11 }} /> Thinking…</>
          ) : (
            <>{submitLabel ?? 'Begin'} <ArrowRight size={13} /></>
          )}
        </button>
      </div>
      {children}
    </div>
  );
}
