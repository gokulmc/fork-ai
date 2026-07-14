'use client';
import { useMemo } from 'react';
import type { SessionSummary } from '@/lib/api';

interface HistoryBubblesProps {
  sessions: SessionSummary[];
  onLoadSession: (sessionId: string) => void;
}

// "Continue where you left off" rail (fix-continue-rail.html) — replaces the
// old variable-size momentum-bubble cluster with uniform cards, so the row
// reads as one scannable status board instead of a jumble of differently-
// weighted bubbles. A single lonely project has nothing to shortcut past the
// list right below it, so the rail only earns its keep once there's a choice.
const MIN_SESSIONS = 2;
const MAX_CARDS = 5; // slots total, INCLUDING a trailing "+more" card once sessions overflow it

// Status dot class + action label per SessionSummary.lastRunStatus (the
// status of the session's most recent CODE run). Undefined — older sessions
// written before the field existed, and research-only sessions with no CODE
// run — reads as the neutral done/Open state, never an error. The dot class
// family is the same running/done/failed status-color system the map accents
// and agent timeline use (note the 'error' status maps to the '--failed' dot
// class, matching that system's naming).
function railState(status: SessionSummary['lastRunStatus']): { dot: 'running' | 'done' | 'failed'; label: string; action: string; retry: boolean } {
  if (status === 'running') return { dot: 'running', label: 'running', action: 'Resume →', retry: false };
  if (status === 'error') return { dot: 'failed', label: 'failed', action: 'Retry →', retry: true };
  return { dot: 'done', label: 'done', action: 'Open →', retry: false };
}

export function HistoryBubbles({ sessions, onLoadSession }: HistoryBubblesProps) {
  const ranked = useMemo(
    () => [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [sessions],
  );

  if (sessions.length < MIN_SESSIONS) return null;

  const overflow = ranked.length > MAX_CARDS;
  const shown = overflow ? ranked.slice(0, MAX_CARDS - 1) : ranked.slice(0, MAX_CARDS);
  const moreCount = ranked.length - shown.length;

  return (
    <div className="topic-bubbles-wrap">
      <div className="topic-bubbles-head">
        <span className="history-divider-label">Continue where you left off</span>
        <span className="history-divider-line" />
      </div>

      <div className="continue-rail">
        {shown.map(s => {
          const { dot, label, action, retry } = railState(s.lastRunStatus);
          return (
            <button
              key={s.sessionId}
              type="button"
              className="continue-card"
              onClick={() => onLoadSession(s.sessionId)}
              title={s.title}
            >
              <div className="continue-card-head">
                <span className="continue-card-emoji">{s.emoji}</span>
                <span className="continue-card-name">{s.title}</span>
              </div>
              <span className="continue-card-repo">{s.repoRef ? `${s.repoRef.owner}/${s.repoRef.repo}` : '—'}</span>
              <div className="continue-card-status-row">
                <span className="continue-card-status">
                  <span className={`continue-card-status-dot continue-card-status-dot--${dot}`} />
                  {label}
                </span>
                <span className={`continue-card-action${retry ? ' continue-card-action--retry' : ''}`}>{action}</span>
              </div>
            </button>
          );
        })}
        {overflow && (
          <div className="continue-card continue-card--more">
            <span className="continue-card--more-label">+{moreCount} more</span>
          </div>
        )}
      </div>
    </div>
  );
}
