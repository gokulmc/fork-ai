'use client';
import { useState } from 'react';
import { Search, ArrowRight, ArrowUpRight, Clock } from './Icons';
import { CookiePreferencesLink } from './CookiePreferencesLink';

interface LandingProps {
  onSubmit: (query: string) => void;
  loading: boolean;
  onShowHistory: () => void;
  outOfCredit?: boolean;
  initialTopics?: string[];
  loggedIn?: boolean;
  onLogin?: () => void;
}

export function Landing({ onSubmit, loading, onShowHistory, outOfCredit, initialTopics = [], loggedIn, onLogin }: LandingProps) {
  const [q, setQ] = useState('');
  const [leaving, setLeaving] = useState(false);

  const onGo = () => {
    if (!q.trim() || loading) return;
    setLeaving(true);
    // Keep this in sync with the .landing transition in globals.css — it blocks
    // the network request, so it must stay short (~animation + one paint).
    setTimeout(() => onSubmit(q.trim()), 100);
  };

  return (
    <div className={`landing${leaving ? ' leaving' : ''}`}>
      <nav className="landing-nav">
        <button className="icon-btn" onClick={onShowHistory}>
          <Clock size={14} /> History
        </button>
        {!loggedIn && (
          <button className="icon-btn" onClick={onLogin}>
            <ArrowUpRight size={14} /> Login
          </button>
        )}
      </nav>

      <div className="landing-inner">
        <div className="landing-mark">A branching research workspace</div>
        <h1>Ask once. <em>Branch</em> forever.</h1>
        <p className="landing-sub">
          Type a question. Get an answer split into sections you can dive deeper into, highlight,
          and branch from. Every detour becomes a node on your mind map.
        </p>
        <div className="query-box" data-tour="tour-query">
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
        {outOfCredit && (
          <div style={{ marginTop: 10, fontSize: 11, color: '#c0392b', letterSpacing: '0.04em', fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace" }}>
            Out of credit — open Billing in account settings to recharge.
          </div>
        )}
        <div className="examples">
          {initialTopics.map(ex => (
            <button key={ex} className="chip" title={ex} onClick={() => setQ(ex)}>{ex}</button>
          ))}
        </div>
      </div>
      <div className="landing-foot">
        FORK AI · V0.1 · BRANCHING RESEARCH, BY YOU
        <span className="landing-foot-links">
          <a href="/blog">Blog</a>
          <a href="/privacy-policy">Privacy</a>
          <a href="/terms">Terms</a>
          <CookiePreferencesLink />
        </span>
      </div>
    </div>
  );
}
