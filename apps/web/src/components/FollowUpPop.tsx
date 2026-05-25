'use client';
import { useState, useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (!ref.current) return;
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;
    let top = rect.bottom + 10;
    if (top + h > window.innerHeight - 12) top = rect.top - h - 10;
    if (top < 12) top = 12;
    left = Math.max(12, Math.min(window.innerWidth - w - 12, left));
    setPos({ left, top });
    setTimeout(() => taRef.current?.focus(), 30);
  }, [rect.left, rect.top, rect.width, rect.height, rect.bottom]);

  const handleSubmit = () => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const expanded = SHORTHANDS[trimmed] ?? trimmed;
    setQ(expanded);
    onSubmit(expanded);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && q.trim()) handleSubmit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q, onSubmit, onClose]);

  return (
    <div ref={ref} className="followup-pop" style={{ left: pos.left, top: pos.top }}>
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
          <button className="btn-close" onClick={onClose} title="Close" aria-label="Close">
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
