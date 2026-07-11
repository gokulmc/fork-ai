'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles } from '@/components/Icons';
import { useInView } from '../useInView';
import { useStory } from '../StoryContext';
import { estimateQueryCostUsd } from '../pricingConstants';
import { FORK_PASSAGE, ASK_AI_ANSWER, GO_DEEPER_ANSWER } from '../storyContent';

interface ChipPos { top: number; left: number }

const MAX_VISITOR_HIGHLIGHTS = 3;
const AUTO_DEMO_DELAY_MS = 6000;
const perQueryCost = estimateQueryCostUsd('haiku');

// Beat: Alex highlights the exact sentence she'll need to defend later and
// branches "Ask AI" from it, or takes the whole passage deeper. Visitor
// selections add real nodes to the persistent constellation. If the visitor
// does nothing, the scene auto-plays Go Deeper so the story never stalls.
export function SceneFork() {
  const { ref: sceneRef, inView } = useInView<HTMLDivElement>(0.2);
  const { addNode, recordVisitorBranch } = useStory();

  const passageRef = useRef<HTMLParagraphElement>(null);
  const [chipPos, setChipPos] = useState<ChipPos | null>(null);
  const [askRevealed, setAskRevealed] = useState(false);
  const [deeperRevealed, setDeeperRevealed] = useState(false);
  const [deeperFired, setDeeperFired] = useState(false);
  const highlightCountRef = useRef(0);

  const autoTimerRef = useRef<number | null>(null);
  const autoFiredRef = useRef(false);
  const [enteredMostly, setEnteredMostly] = useState(false);

  // ≥60% in-view trigger for the auto-demo countdown, separate from the
  // 0.2 threshold used for the general scene entry animation.
  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setEnteredMostly(entry.isIntersecting),
      { threshold: 0.6 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const fireGoDeeper = useCallback(
    (visitorInitiated: boolean) => {
      setDeeperRevealed(true);
      if (!deeperFired) {
        setDeeperFired(true);
        addNode({ id: 'moderating-factors', parentId: 'root', label: 'Moderating factors', kind: 'story' });
      }
      if (visitorInitiated && autoTimerRef.current != null) {
        window.clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    },
    [addNode, deeperFired]
  );

  useEffect(() => {
    if (!enteredMostly || autoFiredRef.current || deeperFired) return;
    autoTimerRef.current = window.setTimeout(() => {
      if (autoFiredRef.current || deeperFired) return;
      autoFiredRef.current = true;
      fireGoDeeper(false);
    }, AUTO_DEMO_DELAY_MS);
    return () => {
      if (autoTimerRef.current != null) window.clearTimeout(autoTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enteredMostly, deeperFired]);

  const cancelAutoDemo = useCallback(() => {
    autoFiredRef.current = true;
    if (autoTimerRef.current != null) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, []);

  const onSelect = () => {
    const sel = window.getSelection();
    const container = passageRef.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !container || !sel.toString().trim()) {
      setChipPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setChipPos(null);
      return;
    }
    if (highlightCountRef.current >= MAX_VISITOR_HIGHLIGHTS) {
      setChipPos(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const hostRect = container.getBoundingClientRect();
    setChipPos({ top: rect.top - hostRect.top - 38, left: rect.left - hostRect.left + rect.width / 2 });
  };

  const onAskAI = () => {
    cancelAutoDemo();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.toString().trim()) return;
    const range = sel.getRangeAt(0);
    const container = passageRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) return;

    const text = range.toString();
    try {
      const mark = document.createElement('mark');
      mark.className = 'wp-fork-mark';
      range.surroundContents(mark);
    } catch {
      // Selection crossed element boundaries — skip the visual wrap, still fire the rest.
    }

    setChipPos(null);
    setAskRevealed(true);
    window.getSelection()?.removeAllRanges();

    if (highlightCountRef.current < MAX_VISITOR_HIGHLIGHTS) {
      highlightCountRef.current += 1;
      const label = text.length > 24 ? `${text.slice(0, 24)}…` : text;
      addNode({
        id: `visitor-hl-${highlightCountRef.current}`,
        parentId: 'root',
        label,
        kind: 'visitor',
      });
      recordVisitorBranch(perQueryCost);
    }
  };

  return (
    <section id="scene-fork" data-time="1291" className="wp-scene wp-scene-fork" ref={sceneRef}>
      <div className="wp-wrap">
        <div className="wp-stamp">
          <span className="wp-stamp-label">9:31 PM</span>
          <span className="wp-stamp-rule" />
        </div>
        <h2 className="wp-h2 wp-reveal">The fork</h2>
        <p className={`wp-sub wp-reveal ${inView ? 'wp-in-view' : ''}`}>
          Section two holds the claim her whole argument leans on. Do what Alex did — select the
          sentence.
        </p>

        <div className="wp-fork-grid">
          <div>
            <div className="wp-passage-card">
              <div className="wp-passage-wrap">
                <p ref={passageRef} className="wp-passage" onMouseUp={onSelect} onTouchEnd={onSelect}>
                  {FORK_PASSAGE}
                </p>
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
              </div>

              <div className="wp-godeeper-row">
                <button
                  type="button"
                  className="wp-btn-outline"
                  onClick={() => {
                    cancelAutoDemo();
                    fireGoDeeper(true);
                  }}
                  disabled={deeperFired}
                >
                  {deeperFired ? 'Branch created' : 'Go Deeper'}
                </button>
              </div>
            </div>

            <div className="wp-branch-cards">
              <div>
                <div className={`wp-branch-card ${askRevealed ? 'wp-branch-card-show' : ''}`}>
                  <span className="wp-branch-kicker">ASK AI · ON THE HIGHLIGHTED SENTENCE</span>
                  <p className="wp-branch-body">{ASK_AI_ANSWER}</p>
                </div>
                {askRevealed && (
                  <p className="wp-why">№3 — The structure is the interaction: highlight → branch → node.</p>
                )}
              </div>
              <div>
                <div className={`wp-branch-card ${deeperRevealed ? 'wp-branch-card-show' : ''}`}>
                  <span className="wp-branch-kicker">GO DEEPER · MODERATING FACTORS</span>
                  <p className="wp-branch-body">{GO_DEEPER_ANSWER}</p>
                </div>
                {deeperRevealed && (
                  <p className="wp-why">№2 — Each branch carries only its own thread. Cleaner context in, sharper answers out.</p>
                )}
              </div>
            </div>
          </div>

          <div className="wp-side-note">Every tangent becomes its own node. Nothing buries anything.</div>
        </div>
      </div>
    </section>
  );
}
