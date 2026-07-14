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
  onSubmit: (title: string) => void;
  onClose: () => void;
}

// Client-side preview only — mirrors the backend's slugifyBranchName
// (nodes.service.ts) so the popup can show what will actually be created.
// Collision dedup (the `-2` suffix) is decided server-side against every
// existing branchName; this preview doesn't know that set, so it always
// shows the un-suffixed slug.
function slugPreview(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `fork/${slug || 'plan'}`;
}

export function BranchPopup({ rect, fromSha, onSubmit, onClose }: BranchPopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const trimmed = title.trim();
  const valid = trimmed.length > 0;

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
      <label className="branch-popup-label" htmlFor="branch-popup-title">What is this branch for?</label>
      <input
        id="branch-popup-title"
        ref={inputRef}
        className="branch-popup-input"
        type="text"
        value={title}
        placeholder="e.g. Try a sliding-window algorithm"
        onChange={e => setTitle(e.target.value)}
      />
      <div className="branch-popup-slug-preview">
        <span className="slug-preview-label">Creates</span>
        <span className="slug-preview-arrow">→</span>
        <span className="slug-preview-value">{slugPreview(trimmed)}</span>
      </div>
      <button className="branch-popup-btn" disabled={!valid} onClick={() => valid && onSubmit(trimmed)}>
        Fork branch
      </button>
      <p className="branch-popup-hint">Creates a new branch at this commit and starts a new lane on the map.</p>
    </div>
  );
}
