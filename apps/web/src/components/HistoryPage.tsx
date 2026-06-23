'use client';
import { useState } from 'react';
import { ArrowLeft, Highlighter, GitBranch, Link as LinkIcon, ArrowUpRight, Trash } from './Icons';
import { HistoryBubbles } from './HistoryBubbles';
import { ForkTraceGame } from './ForkTraceGame';
import type { SessionSummary } from '@/lib/api';
import { stripCite } from '@/lib/utils';

interface HistoryPageProps {
  sessions: SessionSummary[];
  loading: boolean;
  onLoadSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onBack: () => void;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

function dividerLabel(dayIso: string): string {
  const d = new Date(dayIso);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((startOfToday.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  if (d.getFullYear() === today.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function HistoryPage({ sessions, loading, onLoadSession, onDeleteSession, onBack }: HistoryPageProps) {
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const groups: Array<{ day: string; items: SessionSummary[] }> = [];
  for (const s of sessions) {
    const day = dayKey(s.updatedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(s);
    else groups.push({ day, items: [s] });
  }

  const isEmpty = !loading && sessions.length === 0;

  return (
    <div className="history-page">
      <header className="history-topbar">
        <div style={{ flex: 1 }} />
        <button className="icon-btn" onClick={onBack}>
          <ArrowLeft size={14} /> Back
        </button>
      </header>

      {isEmpty ? (
        <div className="history-game-wrapper">
          <p className="history-game-tagline">Nothing here, let&apos;s play a game</p>
          <p className="history-game-sub">FORK AI · V0.1 · BRANCHING RESEARCH, BY YOU</p>
          <ForkTraceGame />
        </div>
      ) : (
        <div className="history-body">
          <div className="history-title">
            <h2>Research history</h2>
            <p className="history-sub">Pick up where you left off</p>
          </div>

          {loading ? (
            <div className="history-loading">
              <span className="spinner" style={{ width: 22, height: 22 }} />
            </div>
          ) : (
            <>
              <HistoryBubbles sessions={sessions} onLoadSession={onLoadSession} />
              <div className="history-groups">
              {groups.map(group => (
                <section key={group.day} className="history-group">
                  <div className="history-divider">
                    <span className="history-divider-label">{dividerLabel(group.day)}</span>
                    <span className="history-divider-line" />
                  </div>
                  <div className="sessions-grid history-grid">
                    {group.items.map(s => {
                      const sharedByMe = !!s.shareToken;
                      const sharedWithMe = !!s.ownerSub;
                      const isDeleting = deletingIds.has(s.sessionId);
                      return (
                        <div
                          key={s.sessionId}
                          className="session-card"
                          role="button"
                          tabIndex={0}
                          onClick={() => onLoadSession(s.sessionId)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onLoadSession(s.sessionId); }}
                        >
                          <button
                            className="session-card-delete"
                            aria-label="Delete session"
                            title="Delete session"
                            disabled={isDeleting}
                            onClick={e => {
                              e.stopPropagation();
                              setDeletingIds(prev => new Set(prev).add(s.sessionId));
                              onDeleteSession(s.sessionId);
                            }}
                          >
                            {isDeleting
                              ? <span className="spinner" style={{ width: 12, height: 12 }} />
                              : <Trash size={13} />}
                          </button>
                          <span className="session-card-emoji">{s.emoji}</span>
                          <div className="session-card-body">
                            <div className="session-card-title">{s.title}</div>
                            <div className="session-card-lede">{stripCite(s.lede)}</div>
                            <div className="session-card-meta">
                              <span className="meta-chip" title={`${s.nodeCount} node${s.nodeCount !== 1 ? 's' : ''}`}>
                                <GitBranch size={11} /> {s.nodeCount}
                              </span>
                              <span className="meta-chip" title={`${s.highlightCount} highlight${s.highlightCount !== 1 ? 's' : ''}`}>
                                <Highlighter size={11} /> {s.highlightCount}
                              </span>
                              {sharedByMe && (
                                <span className="meta-chip meta-chip--share" title="You shared this session">
                                  <LinkIcon size={11} /> Shared by you
                                </span>
                              )}
                              {sharedWithMe && (
                                <span className="meta-chip meta-chip--share" title="Shared with you">
                                  <ArrowUpRight size={11} /> Shared with you
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
              </div>
            </>
          )}
        </div>
      )}

      {!isEmpty && <div className="landing-foot">FORK AI · V0.1 · BRANCHING RESEARCH, BY YOU</div>}
    </div>
  );
}
