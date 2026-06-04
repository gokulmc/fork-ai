'use client';
import { GitBranch, FileText } from './Icons';

interface Props {
  open: boolean;
  onToggle: () => void;
}

// Floating liquid-glass pill shown only on narrow viewports (see globals.css
// @media block). Toggles the full-screen mind-map swap; the same button switches
// back, so when the map is open it offers to return to reading.
export function MindMapPill({ open, onToggle }: Props) {
  return (
    <button
      className="mm-pill"
      onClick={onToggle}
      title={open ? 'Back to reading' : 'Open mind map'}
      aria-pressed={open}
    >
      {open ? <FileText size={16} /> : <GitBranch size={16} />}
      {open ? 'Read' : 'Mindmap'}
    </button>
  );
}
