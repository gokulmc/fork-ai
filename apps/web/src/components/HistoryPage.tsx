'use client';
import { ArrowLeft } from './Icons';
import type { SessionSummary } from '@/lib/api';

interface HistoryPageProps {
  sessions: SessionSummary[];
  loading: boolean;
  onLoadSession: (sessionId: string) => void;
  onBack: () => void;
}

export function HistoryPage({ sessions, loading, onLoadSession, onBack }: HistoryPageProps) {
  return (
    <div className="history-page">
      <header className="history-topbar">
        <div className="brand" style={{ cursor: 'pointer' }} onClick={onBack}>
          <span className="mark">F</span> fork.ai
        </div>
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
          <div className="sessions-grid history-grid">
            {sessions.map(s => (
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
                    {s.nodeCount} node{s.nodeCount !== 1 ? 's' : ''} &middot;{' '}
                    {new Date(s.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="landing-foot">FORK.AI · V0.1 · BRANCHING RESEARCH, BY YOU</div>
    </div>
  );
}
