'use client';
import { useState } from 'react';
import { Search, ArrowRight, Clock } from './Icons';

const EXAMPLES = [
  'How do neural networks actually learn?',
  'What caused the fall of the Roman Republic?',
  'Explain the theory of plate tectonics',
  'How does mRNA vaccine technology work?',
];

interface LandingProps {
  onSubmit: (query: string) => void;
  loading: boolean;
  onShowHistory: () => void;
}

export function Landing({ onSubmit, loading, onShowHistory }: LandingProps) {
  const [q, setQ] = useState('');
  const [leaving, setLeaving] = useState(false);

  const onGo = () => {
    if (!q.trim() || loading) return;
    setLeaving(true);
    setTimeout(() => onSubmit(q.trim()), 280);
  };

  return (
    <div className={`landing${leaving ? ' leaving' : ''}`}>
      <nav className="landing-nav">
        <button className="icon-btn" onClick={onShowHistory}>
          <Clock size={14} /> History
        </button>
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
        <div className="examples">
          {EXAMPLES.map(ex => (
            <button key={ex} className="chip" onClick={() => setQ(ex)}>{ex}</button>
          ))}
        </div>
      </div>
      <div className="landing-foot">FORK.AI · V0.1 · BRANCHING RESEARCH, BY YOU</div>
    </div>
  );
}
