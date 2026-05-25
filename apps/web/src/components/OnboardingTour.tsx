'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { patchMe } from '@/lib/api';

interface TourStep {
  dataTour: string;
  title: string;
  body: string;
  position: 'top' | 'bottom' | 'left' | 'right';
  phase: 'landing' | 'session';
}

const TOUR_STEPS: TourStep[] = [
  {
    dataTour: 'tour-query',
    title: 'Ask anything',
    body: 'Type a research question and press Enter. fork.ai structures the answer into sections you can explore.',
    position: 'bottom',
    phase: 'landing',
  },
  {
    dataTour: 'tour-sections',
    title: 'Research sections',
    body: 'Your answer is split into sections. Scroll through, or dive deeper into any of them.',
    position: 'left',
    phase: 'session',
  },
  {
    dataTour: 'tour-mindmap',
    title: 'Your mind map',
    body: 'Every branch you explore becomes a node here. Click any node to navigate. Drag to pan, scroll to zoom.',
    position: 'right',
    phase: 'session',
  },
  {
    dataTour: 'tour-highlight',
    title: 'Highlight text',
    body: 'Select any passage in a section — a menu appears to highlight it, pin it as a callout, or ask a follow-up.',
    position: 'top',
    phase: 'session',
  },
  {
    dataTour: 'tour-highlight',
    title: 'Ask AI',
    body: 'After selecting text, tap "Ask AI" to branch into a follow-up question — it becomes a new node on your map.',
    position: 'top',
    phase: 'session',
  },
  {
    dataTour: 'tour-notion',
    title: 'Save to Notion',
    body: 'Export your full research tree to Notion as a structured page — mind map diagram, toggle sections, and all.',
    position: 'bottom',
    phase: 'session',
  },
  {
    dataTour: 'tour-share',
    title: 'Share your research',
    body: 'Generate a shareable link. Anyone with the link can view and branch from your session.',
    position: 'bottom',
    phase: 'session',
  },
  {
    dataTour: 'tour-history',
    title: 'Your history',
    body: 'All your past research sessions live here. Pick up any thread, any time.',
    position: 'bottom',
    phase: 'session',
  },
];

const TIP_W = 280;
const TIP_H = 130;
const GAP = 14;

interface TooltipPos {
  top: number;
  left: number;
  arrowSide: 'top' | 'bottom' | 'left' | 'right';
}

function computePos(rect: DOMRect, position: TourStep['position']): TooltipPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top: number;
  let left: number;
  let arrowSide: TooltipPos['arrowSide'];

  switch (position) {
    case 'bottom':
      top = rect.bottom + GAP;
      left = rect.left + rect.width / 2 - TIP_W / 2;
      arrowSide = 'top';
      break;
    case 'top':
      top = rect.top - TIP_H - GAP;
      left = rect.left + rect.width / 2 - TIP_W / 2;
      arrowSide = 'bottom';
      break;
    case 'right':
      top = rect.top + rect.height / 2 - TIP_H / 2;
      left = rect.right + GAP;
      arrowSide = 'left';
      break;
    case 'left':
      top = rect.top + rect.height / 2 - TIP_H / 2;
      left = rect.left - TIP_W - GAP;
      arrowSide = 'right';
      break;
  }

  return {
    top: Math.max(12, Math.min(vh - TIP_H - 12, top)),
    left: Math.max(12, Math.min(vw - TIP_W - 12, left)),
    arrowSide,
  };
}

interface OnboardingTourProps {
  phase: 'landing' | 'session';
  idToken: string;
  onDone: () => void;
}

export function OnboardingTour({ phase, idToken, onDone }: OnboardingTourProps) {
  const [step, setStep] = useState(0);
  const [pos, setPos] = useState<TooltipPos | null>(null);
  const prevElRef = useRef<Element | null>(null);

  // Advance past landing-phase steps when the session workspace loads
  useEffect(() => {
    if (phase === 'session' && TOUR_STEPS[step]?.phase === 'landing') {
      setStep(1);
    }
  }, [phase, step]);

  const current = TOUR_STEPS[step];

  // Poll for target element, attach pulse ring, compute position
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    let tries = 0;

    prevElRef.current?.removeAttribute('data-tour-active');
    prevElRef.current = null;
    setPos(null);

    function attempt() {
      if (cancelled) return;
      tries++;
      const el = document.querySelector(`[data-tour="${current.dataTour}"]`);
      if (el) {
        el.setAttribute('data-tour-active', '1');
        prevElRef.current = el;
        setPos(computePos(el.getBoundingClientRect(), current.position));
      } else if (tries < 80) {
        setTimeout(attempt, 250);
      }
    }
    attempt();

    return () => {
      cancelled = true;
      prevElRef.current?.removeAttribute('data-tour-active');
      prevElRef.current = null;
    };
  }, [step, current]);

  const finish = useCallback(() => {
    patchMe(idToken, { hasOnboarded: true }).catch(() => {});
    onDone();
  }, [idToken, onDone]);

  const next = () => {
    if (step < TOUR_STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      finish();
    }
  };

  if (!pos || !current) return null;

  return (
    <div
      className="tour-tooltip"
      style={{ top: pos.top, left: pos.left }}
      data-arrow={pos.arrowSide}
    >
      <div className="tour-step">{step + 1} / {TOUR_STEPS.length}</div>
      <div className="tour-title">{current.title}</div>
      <div className="tour-body">{current.body}</div>
      <div className="tour-actions">
        <button className="tour-skip" onClick={finish}>Skip tour</button>
        <button className="tour-next" onClick={next}>
          {step < TOUR_STEPS.length - 1 ? 'Next →' : 'Done ✓'}
        </button>
      </div>
    </div>
  );
}
