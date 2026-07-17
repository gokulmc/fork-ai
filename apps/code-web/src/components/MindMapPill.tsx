'use client';
import { GitBranch, FileText } from './Icons';

interface Props {
  open: boolean;
  onToggle: () => void;
}

// Floating liquid-glass pill (same as the original forkai app's mm-pill) shown
// only on narrow viewports. Toggles the full-screen mind-map swap; the same
// button switches back, so when the map is open it offers to return to reading.
// Rendered inside .code-composer-wrap (just above the composer) when the
// composer is visible, or standalone (fixed bottom-center) when it isn't —
// see App.tsx; the wrap variant is repositioned via CSS.
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
