'use client';
import { useState, useEffect, useRef } from 'react';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
}

interface BranchPopupProps {
  rect: Rect;
  fromSha: string; // short sha shown in the header, e.g. "a1b2c3d"
  onSubmit: (branchName: string) => void;
  onClose: () => void;
}

const BRANCH_NAME_RE = /^[A-Za-z0-9._/-]+$/;

export function BranchPopup({ rect, fromSha, onSubmit, onClose }: BranchPopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && BRANCH_NAME_RE.test(trimmed);

  // Position below the commit pill, same clamping approach as FollowUpPop.
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
      if (e.key === 'Enter' && valid) onSubmit(trimmed);
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
  }, [valid, trimmed, onSubmit, onClose]);

  return (
    <div ref={ref} className="branch-popup" style={{ left: pos.left, top: pos.top }}>
      <div className="branch-popup-header">Fork from <code>{fromSha}</code></div>
      <input
        ref={inputRef}
        className="branch-popup-input"
        type="text"
        value={name}
        placeholder="feature/my-branch"
        onChange={e => setName(e.target.value)}
      />
      <button className="branch-popup-btn" disabled={!valid} onClick={() => valid && onSubmit(trimmed)}>
        Fork branch
      </button>
      <p className="branch-popup-hint">Creates a new branch at this commit and starts a new lane on the map.</p>
    </div>
  );
}
