'use client';
import { useMemo } from 'react';
import type { SessionSummary } from '@/lib/api';
import { relativeTime } from '@/lib/utils';

interface HistoryBubblesProps {
  sessions: SessionSummary[];
  onLoadSession: (sessionId: string) => void;
}

// Below this a handful of floating blobs reads as a screensaver — grid only.
const MIN_PROJECTS = 6;
const MIN_D = 56;
const MAX_D = 110;
// Static recency gradient (no drift/repositioning — click targets never move):
// full ink up to an hour old, fully faded by two weeks.
const RECENT_MS = 60 * 60 * 1000;
const DORMANT_MS = 14 * 24 * 60 * 60 * 1000;

interface MomentumBubble {
  session: SessionSummary;
  d: number; // diameter, px
  t: number; // recency 0 (just touched) → 1 (dormant)
}

function diameter(nodeCount: number, min: number, max: number): number {
  if (max <= min) return (MIN_D + MAX_D) / 2;
  const t = Math.sqrt((nodeCount - min) / (max - min)); // area, not radius, tracks count
  return Math.round(MIN_D + t * (MAX_D - MIN_D));
}

function recencyT(iso: string): number {
  const age = Date.now() - new Date(iso).getTime();
  if (age <= RECENT_MS) return 0;
  if (age >= DORMANT_MS) return 1;
  return (age - RECENT_MS) / (DORMANT_MS - RECENT_MS);
}

export function HistoryBubbles({ sessions, onLoadSession }: HistoryBubblesProps) {
  // One bubble per project, biggest (most nodes) first. Layout is plain CSS
  // flex-wrap, not a physics sim — every bubble's position is final the moment
  // it mounts, so nothing here can drift a click target out from under a user.
  const bubbles: MomentumBubble[] = useMemo(() => {
    const counts = sessions.map(s => s.nodeCount);
    const min = counts.length ? Math.min(...counts) : 0;
    const max = counts.length ? Math.max(...counts) : 0;
    return [...sessions]
      .sort((a, b) => b.nodeCount - a.nodeCount)
      .map(s => ({ session: s, d: diameter(s.nodeCount, min, max), t: recencyT(s.updatedAt) }));
  }, [sessions]);

  if (sessions.length < MIN_PROJECTS) return null;

  return (
    <div className="topic-bubbles-wrap">
      <div className="topic-bubbles-head">
        <span className="history-divider-label">Momentum</span>
        <span className="history-divider-line" />
      </div>

      <div className="momentum-stage">
        {bubbles.map(b => (
          <button
            key={b.session.sessionId}
            className="momentum-bubble"
            style={{ width: b.d, height: b.d, '--momentum-t': b.t } as React.CSSProperties}
            onClick={() => onLoadSession(b.session.sessionId)}
            title={`${b.session.title} · ${b.session.nodeCount} node${b.session.nodeCount !== 1 ? 's' : ''} · ${relativeTime(b.session.updatedAt)}`}
          >
            <span className="momentum-bubble-emoji">{b.session.emoji}</span>
            <span className="momentum-bubble-title">{b.session.title}</span>
            <span className="momentum-bubble-time">{relativeTime(b.session.updatedAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
