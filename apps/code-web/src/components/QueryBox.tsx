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
  // Width of the textarea while in pill mode, captured on every pill-mode pass.
  // The `multi` decision below always measures wrap at this width, never at
  // whichever width happens to be rendered — see the comment inside the effect.
  const pillWidthRef = useRef<number | null>(null);
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
    if (!multi) pillWidthRef.current = el.clientWidth;

    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    // el.scrollHeight includes the textarea's own vertical padding (border-box
    // sizing), but `lineHeight * MAX_ROWS` was pure text height with no
    // padding allowance -- the two sides of this clamp must be in the same
    // units, or "six rows" starts scrolling before six rows of text fit.
    const verticalPadding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    if (baseHeightRef.current === null) baseHeightRef.current = el.scrollHeight;
    if (valueChanged) {
      // Guarding re-decisions to value-changed passes (above) stops the
      // mode-change re-measure from flip-flopping, but typing itself changes
      // `value` on every keystroke, and pill (~463px) vs. card (~612px) width
      // wrap different lengths — so deciding from scrollHeight at whichever
      // width is CURRENTLY rendered still oscillates every keystroke at
      // boundary lengths. Pin the decision to the captured pill width instead:
      // the outcome can no longer feed back into the width it's measured at.
      // Restore the real width before the final height measurement below so
      // the box still renders at its actual current width.
      //
      // .qb-input is `flex: 1` (flex-basis: 0%) in CSS, so the flex algorithm
      // sizes it by growing to fill `.qb-main` regardless of the `width`
      // property -- setting style.width alone is a no-op while flex-grow is
      // still active, silently measuring at the real (possibly card) width
      // and reproducing the exact oscillation this is meant to fix. Zero out
      // flex-grow too so the explicit width actually takes hold.
      const pillWidth = pillWidthRef.current;
      if (pillWidth !== null) { el.style.flex = 'none'; el.style.width = `${pillWidth}px`; }
      const wrapHeight = el.scrollHeight;
      if (pillWidth !== null) { el.style.flex = ''; el.style.width = ''; }
      const isMulti = wrapHeight > baseHeightRef.current + 2;
      setMulti(prev => (prev === isMulti ? prev : isMulti));
    }
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_ROWS + verticalPadding)}px`;
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
