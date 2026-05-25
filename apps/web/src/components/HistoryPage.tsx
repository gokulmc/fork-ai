'use client';
import { ArrowLeft, Highlighter, GitBranch, Link as LinkIcon, ArrowUpRight } from './Icons';
import type { SessionSummary } from '@/lib/api';

interface HistoryPageProps {
  sessions: SessionSummary[];
  loading: boolean;
  onLoadSession: (sessionId: string) => void;
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

export function HistoryPage({ sessions, loading, onLoadSession, onBack }: HistoryPageProps) {
  const groups: Array<{ day: string; items: SessionSummary[] }> = [];
  for (const s of sessions) {
    const day = dayKey(s.updatedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(s);
    else groups.push({ day, items: [s] });
  }

  return (
    <div className="history-page">
      <header className="history-topbar">
        <div style={{ flex: 1 }} />
        <button className="icon-btn" onClick={onBack}>
          <ArrowLeft size={14} /> Back
        </button>
      </header>

      <div className="history-body">
        <div className="history-title">
          <h2>Research history</h2>
          <p className="history-sub">Pick up where you left off</p>
        </div>

        {loading ? (
          <div className="history-loading">
            <span className="spinner" style={{ width: 22, height: 22 }} />
          </div>
        ) : sessions.length === 0 ? (
          <div className="history-empty">
            <p>No research sessions yet.</p>
            <button className="submit" style={{ marginTop: 16 }} onClick={onBack}>
              Start your first research
            </button>
          </div>
        ) : (
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
                    return (
                      <button
                        key={s.sessionId}
                        className="session-card"
                        onClick={() => onLoadSession(s.sessionId)}
                      >
                        <span className="session-card-emoji">{s.emoji}</span>
                        <div className="session-card-body">
                          <div className="session-card-title">{s.title}</div>
                          <div className="session-card-lede">{s.lede}</div>
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
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <div className="landing-foot">FORK.AI · V0.1 · BRANCHING RESEARCH, BY YOU</div>
    </div>
  );
}
