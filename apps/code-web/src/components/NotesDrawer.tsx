'use client';
import { useState } from 'react';
import type { Annotation, HighlightRecord } from '@/lib/types';
import { Bookmark, X, Highlighter, Lightbulb, PageIcon, Trash } from './Icons';

interface NotesDrawerProps {
  open: boolean;
  onClose: () => void;
  highlights: HighlightRecord[];
  callouts: Annotation[];
  onJump: (nodeId: string) => void;
  onRemoveHighlight: (hlId: string) => void;
  onRemoveCallout: (id: string) => void;
}

export function NotesDrawer({ open, onClose, highlights, callouts, onJump, onRemoveHighlight, onRemoveCallout }: NotesDrawerProps) {
  const [tab, setTab] = useState<'all' | 'highlights' | 'callouts'>('all');

  const total = highlights.length + callouts.length;

  return (
    <>
      <div className={`drawer-scrim${open ? ' open' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="drawer-head">
          <h3><Bookmark className="ic" /> Highlights &amp; Callouts</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="drawer-tabs">
          <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>All · {total}</button>
          <button className={tab === 'highlights' ? 'active' : ''} onClick={() => setTab('highlights')}>Highlights · {highlights.length}</button>
          <button className={tab === 'callouts' ? 'active' : ''} onClick={() => setTab('callouts')}>Callouts · {callouts.length}</button>
        </div>
        <div className="drawer-body">
          {tab === 'all' && total === 0 && (
            <div className="drawer-empty">
              <div className="icon"><Bookmark size={32} /></div>
              Highlight any passage<br />to save it here.
            </div>
          )}
          {tab === 'highlights' && highlights.length === 0 && (
            <div className="drawer-empty">
              <div className="icon"><Highlighter size={32} /></div>
              No highlights yet.
            </div>
          )}
          {tab === 'callouts' && callouts.length === 0 && (
            <div className="drawer-empty">
              <div className="icon"><Lightbulb size={32} /></div>
              No callouts yet.
            </div>
          )}

          {(tab === 'all' || tab === 'highlights') && highlights.map(h => (
            <div key={h.hlId} className="note-card highlight">
              <div className="ic-kind"><Highlighter className="ic" /> Highlight</div>
              <div className="src">{h.text}</div>
              <div className="meta">
                <span className="from" onClick={() => onJump(h.nodeId)}>
                  <PageIcon className="ic" /> {h.fromTitle}
                </span>
                <button className="del" onClick={() => onRemoveHighlight(h.hlId)} title="Delete">
                  <Trash size={14} />
                </button>
              </div>
            </div>
          ))}

          {(tab === 'all' || tab === 'callouts') && callouts.map(c => (
            <div key={c.id} className="note-card callout">
              <div className="ic-kind"><Lightbulb className="ic" /> Callout</div>
              <div className="src">{c.text}</div>
              <div className="meta">
                <span className="from" onClick={() => onJump(c.nodeId)}>
                  <PageIcon className="ic" /> {c.fromTitle}
                </span>
                <button className="del" onClick={() => onRemoveCallout(c.id)} title="Delete">
                  <Trash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
