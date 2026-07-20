'use client';
import { useState } from 'react';
import type { Project } from '@/lib/api';
import { QueryBox } from './QueryBox';

interface ProjectStartProps {
  project: Project;
  loading: boolean;
  onSubmit: (query: string) => void;
  // Locally dismisses this interstitial so imported history is browsable
  // without asking — the project's seeded commits already exist on the map.
  onOpenMap: () => void;
}

// Shown when a project's session has no learn-kind node yet — reuses the
// .landing/.query-box shell so the "first question" moment matches Landing's
// look exactly. The project's seeded CODE root (and any imported commits)
// already exist on the map underneath this — "Open map" just dismisses it.
export function ProjectStart({ project, loading, onSubmit, onOpenMap }: ProjectStartProps) {
  const [q, setQ] = useState('');

  const onGo = () => {
    if (!q.trim() || loading) return;
    onSubmit(q.trim());
  };

  return (
    <div className="landing">
      <nav className="landing-nav">
        <button className="icon-btn" onClick={onOpenMap}>
          Open map ↗
        </button>
      </nav>
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
        <QueryBox
          value={q}
          onChange={setQ}
          onSubmit={onGo}
          placeholder="What are we building?"
          loading={loading}
          autoFocus
        />
      </div>
    </div>
  );
}
