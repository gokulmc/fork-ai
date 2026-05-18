'use client';
import { useState } from 'react';
import { Search, ArrowRight } from './Icons';
import type { SessionSummary } from '@/lib/api';

const EXAMPLES = [
  'How do neural networks actually learn?',
  'What caused the fall of the Roman Republic?',
  'Explain the theory of plate tectonics',
  'How does mRNA vaccine technology work?',
];

interface LandingProps {
  onSubmit: (query: string) => void;
  loading: boolean;
  sessions?: SessionSummary[];
  loadingSessions?: boolean;
  onLoadSession?: (sessionId: string) => void;
}

export function Landing({ onSubmit, loading, sessions, loadingSessions, onLoadSession }: LandingProps) {
  const [q, setQ] = useState('');
  const [leaving, setLeaving] = useState(false);

  const onGo = () => {
    if (!q.trim() || loading) return;
    setLeaving(true);
    setTimeout(() => onSubmit(q.trim()), 280);
  };

  const hasSessions = sessions && sessions.length > 0;

  return (
    <div className={`landing${leaving ? ' leaving' : ''}`}>
      <div className="landing-inner">
        <div className="landing-mark">A branching research workspace</div>
        <h1>Ask once. <em>Branch</em> forever.</h1>
        <p className="landing-sub">
          Type a question. Get an answer split into sections you can dive deeper into, highlight,
          and branch from. Every detour becomes a node on your mind map.
        </p>
        <div className="query-box">
          <span className="icon"><Search size={20} /></span>
          <input
            type="text"
            autoFocus
            value={q}
            placeholder="Try: how does photosynthesis work?"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onGo()}
          />
          <button className="submit" disabled={!q.trim() || loading} onClick={onGo}>
            {loading ? (
              <><span className="spinner" style={{ width: 11, height: 11 }} /> Thinking…</>
            ) : (
              <>Begin <ArrowRight size={13} /></>
            )}
          </button>
        </div>
        <div className="examples">
          {EXAMPLES.map(ex => (
            <button key={ex} className="chip" onClick={() => setQ(ex)}>{ex}</button>
          ))}
        </div>

        {(loadingSessions || hasSessions) && (
          <div className="past-sessions">
            <div className="sessions-label">Recent research</div>
            {loadingSessions ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <span className="spinner" style={{ width: 18, height: 18 }} />
              </div>
            ) : (
              <div className="sessions-grid">
                {sessions?.map(s => (
                  <button
                    key={s.sessionId}
                    className="session-card"
                    onClick={() => onLoadSession?.(s.sessionId)}
                  >
                    <span className="session-card-emoji">{s.emoji}</span>
                    <div>
                      <div className="session-card-title">{s.title}</div>
                      <div className="session-card-lede">{s.lede}</div>
                      <div className="session-card-meta">
                        {s.nodeCount} node{s.nodeCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="landing-foot">FORK.AI · V0.1 · BRANCHING RESEARCH, BY YOU</div>
    </div>
  );
}
