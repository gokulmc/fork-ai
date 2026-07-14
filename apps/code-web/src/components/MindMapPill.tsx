'use client';
import { GitBranch, FileText } from './Icons';

interface Props {
  open: boolean;
  onToggle: () => void;
}

// Round 2 (WS-C / r2-session-topbar.html): a top-center segmented Map/Read
// toggle docked directly under the topbar — replaces the old floating
// bottom-center pill, which could strand mid-canvas or drift over the
// composer. Only rendered on narrow viewports (see App.tsx's isNarrow gate);
// CSS scopes `.mrt-dock` to the same <768px breakpoint the old `.mm-pill` used.
export function MindMapPill({ open, onToggle }: Props) {
  return (
    <div className="mrt-dock">
      <div className="map-read-toggle" role="tablist" aria-label="Map or Read view">
        <button
          type="button"
          role="tab"
          aria-selected={open}
          className={`mrt-seg${open ? ' mrt-seg--active' : ''}`}
          onClick={() => { if (!open) onToggle(); }}
        >
          <GitBranch size={13} /> Map
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!open}
          className={`mrt-seg${!open ? ' mrt-seg--active' : ''}`}
          onClick={() => { if (open) onToggle(); }}
        >
          <FileText size={13} /> Read
        </button>
      </div>
    </div>
  );
}
