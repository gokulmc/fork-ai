'use client';
import { useState } from 'react';
import type { Project } from '@/lib/api';
import { Search, ArrowRight } from './Icons';

interface ProjectStartProps {
  project: Project;
  loading: boolean;
  onSubmit: (query: string) => void;
}

// Shown when a project's session has zero nodes — reuses the .landing/.query-box
// shell so the "first question" moment matches Landing's look exactly.
export function ProjectStart({ project, loading, onSubmit }: ProjectStartProps) {
  const [q, setQ] = useState('');

  const onGo = () => {
    if (!q.trim() || loading) return;
    onSubmit(q.trim());
  };

  return (
    <div className="landing">
      <div className="landing-inner">
        <div
          className="landing-mark"
          style={{ fontFamily: "ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace", textTransform: 'none', letterSpacing: '0.02em' }}
        >
          {project.repoRef.owner}/{project.repoRef.repo}
        </div>
        <h1>{project.name}</h1>
        <p className="landing-sub">
          Ask a question, sketch a plan, or start coding — every branch lands on this project&apos;s map.
        </p>
        <div className="query-box">
          <span className="icon"><Search size={20} /></span>
          <input
            type="text"
            autoFocus
            value={q}
            placeholder="What are we building?"
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
      </div>
    </div>
  );
}
