'use client';
import { useState, useEffect, useRef } from 'react';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
}

interface CodeInstructionPopupProps {
  rect: Rect;
  mode: 'implement' | 'continue';
  onSubmit: (instruction: string) => void;
  onClose: () => void;
}

// Reuses .branch-popup's exact CSS (anchored panel: header/input/button/hint) —
// same interaction shape, different content, so no new visual language needed.
export function CodeInstructionPopup({ rect, mode, onSubmit, onClose }: CodeInstructionPopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const trimmed = text.trim();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (top + h > window.innerHeight - 12) top = rect.top - h - 8;
    if (top < 12) top = 12;
    left = Math.max(12, Math.min(window.innerWidth - w - 12, left));
    setPos({ left, top });
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [rect.left, rect.top, rect.bottom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && trimmed) onSubmit(trimmed);
    };
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [trimmed, onSubmit, onClose]);

  return (
    <div ref={ref} className="branch-popup" style={{ left: pos.left, top: pos.top }}>
      <div className="branch-popup-header">{mode === 'continue' ? 'Continue coding' : 'Implement this'}</div>
      <input
        ref={inputRef}
        className="branch-popup-input"
        type="text"
        value={text}
        placeholder="What should the agent do?"
        onChange={e => setText(e.target.value)}
      />
      <button className="branch-popup-btn" disabled={!trimmed} onClick={() => trimmed && onSubmit(trimmed)}>
        {mode === 'continue' ? 'Continue' : 'Implement'}
      </button>
      <p className="branch-popup-hint">Runs a mocked coding agent and lands a commit on this branch.</p>
    </div>
  );
}
