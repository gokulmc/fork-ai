'use client';
import { useRef, useState } from 'react';
import { Sparkles } from '@/components/Icons';

interface ChipPos { top: number; left: number }

// Beat: Alex highlights the exact sentence she'll need to defend later, and
// branches "Ask AI" from it. Mirrors HighlightMenu.tsx's selection→chip idea,
// reimplemented standalone with local state only — no annotation persistence.
export function HighlightAskAIMock() {
  const containerRef = useRef<HTMLParagraphElement>(null);
  const rangeRef = useRef<Range | null>(null);
  const [chipPos, setChipPos] = useState<ChipPos | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [marked, setMarked] = useState(false);

  const onSelect = () => {
    const sel = window.getSelection();
    const container = containerRef.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !container) {
      setChipPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setChipPos(null);
      return;
    }
    if (!range.toString().trim()) {
      setChipPos(null);
      return;
    }
    rangeRef.current = range.cloneRange();
    const rect = range.getBoundingClientRect();
    const hostRect = container.getBoundingClientRect();
    setChipPos({ top: rect.top - hostRect.top - 38, left: rect.left - hostRect.left + rect.width / 2 });
  };

  const onAskAI = () => {
    const range = rangeRef.current;
    if (range && !marked) {
      try {
        const mark = document.createElement('mark');
        mark.className = 'wp-demo-mark';
        range.surroundContents(mark);
        setMarked(true);
      } catch {
        // Selection crossed element boundaries — skip the visual wrap, still reveal the answer.
      }
    }
    setChipPos(null);
    setRevealed(true);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="wp-highlight-demo">
      <p
        ref={containerRef}
        className="wp-highlight-text"
        onMouseUp={onSelect}
        onTouchEnd={onSelect}
      >
        Socioeconomic status significantly moderates this relationship — lower-income residents
        see larger mental health gains from nearby green space, plausibly because they have fewer
        alternative ways to decompress.
      </p>
      <div className="wp-highlight-hint">Try selecting a sentence above ↑</div>
      {chipPos && (
        <button
          type="button"
          className="wp-ask-chip"
          style={{ top: chipPos.top, left: chipPos.left }}
          onMouseDown={e => e.preventDefault()}
          onClick={onAskAI}
        >
          <Sparkles size={12} /> Ask AI
        </button>
      )}
      {revealed && (
        <div className="wp-branch-card wp-branch-card-in">
          <div className="wp-branch-card-kicker">Ask AI · on the highlighted sentence</div>
          <p>
            This is the line Alex will need to defend later. The strongest citation for it is a
            longitudinal cohort study across multiple UK cities — worth pinning in her citation
            manager, not just the general claim.
          </p>
        </div>
      )}
    </div>
  );
}
