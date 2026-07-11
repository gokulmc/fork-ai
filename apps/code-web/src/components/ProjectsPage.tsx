'use client';
import { useState } from 'react';
import type { Project, CreateProjectPayload } from '@/lib/api';
import { MOCK_REPOS, PLUGINS, type MockRepo } from '@/lib/mockGithub';
import { Clock, ArrowUpRight, Plus, X as XIcon, Check } from './Icons';

interface ProjectsPageProps {
  projects: Project[];
  loading: boolean;
  onOpenProject: (project: Project) => void;
  onCreateProject: (payload: CreateProjectPayload) => Promise<Project>;
  onShowHistory: () => void;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  const wk = Math.round(day / 7);
  return `${wk} week${wk === 1 ? '' : 's'} ago`;
}

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (payload: CreateProjectPayload) => Promise<void> }) {
  const [name, setName] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<MockRepo>(MOCK_REPOS[0]);
  const [plugins, setPlugins] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const togglePlugin = (id: string) => {
    setPlugins(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const { provider, owner, repo, defaultBranch, url } = selectedRepo;
      await onCreate({ name: name.trim(), repoRef: { provider, owner, repo, defaultBranch, url }, plugins: [...plugins] });
    } catch {
      setError('Failed to create project — please try again.');
      setCreating(false);
    }
  };

  return (
    <div className="proj-modal-overlay" onClick={e => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="proj-modal">
        <div className="proj-modal-head">
          <div className="proj-modal-title">New project</div>
          <button className="proj-modal-close" onClick={onClose} aria-label="Close"><XIcon size={14} /></button>
        </div>
        <div className="proj-modal-body">
          <div>
            <div className="proj-field-label">Name</div>
            <input
              className="proj-field-input"
              type="text"
              value={name}
              placeholder="billing-service"
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <div className="proj-field-label">Repository</div>
            <div className="proj-repo-list">
              {MOCK_REPOS.map(repo => (
                <div
                  key={repo.url}
                  className={`proj-repo-row${repo.url === selectedRepo.url ? ' selected' : ''}`}
                  onClick={() => setSelectedRepo(repo)}
                  title={repo.description}
                >
                  <span className="proj-repo-name">{repo.owner}/{repo.repo}</span>
                  <span className="mock-tag">mock</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="proj-field-label">Plugins</div>
            {PLUGINS.map(p => (
              <div className="proj-plugin-row" key={p.id}>
                <div>
                  <div className="proj-plugin-name">{p.name}</div>
                  <div className="proj-plugin-desc">{p.desc}</div>
                </div>
                <button
                  type="button"
                  className={`proj-switch${plugins.has(p.id) ? ' on' : ''}`}
                  role="switch"
                  aria-checked={plugins.has(p.id)}
                  aria-label={p.name}
                  onClick={() => togglePlugin(p.id)}
                />
              </div>
            ))}
          </div>
          {error && <div className="proj-field-error">{error}</div>}
        </div>
        <div className="proj-modal-foot">
          <button className="proj-btn-primary" disabled={!name.trim() || creating} onClick={submit}>
            {creating ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Creating…</> : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectsPage({ projects, loading, onOpenProject, onCreateProject, onShowHistory }: ProjectsPageProps) {
  const [showModal, setShowModal] = useState(false);
  const [leavingId, setLeavingId] = useState<string | null>(null);

  const openProject = (project: Project) => {
    setLeavingId(project.projectId);
    setTimeout(() => onOpenProject(project), 100);
  };

  return (
    <div className={`proj-page${leavingId ? ' leaving' : ''}`}>
      <nav className="landing-nav">
        <button className="icon-btn" onClick={onShowHistory}>
          <Clock size={14} /> History
        </button>
      </nav>

      <div className="proj-body">
        <div className="proj-body-head">
          <div>
            <h1 className="proj-page-title">Projects</h1>
            <p className="proj-page-sub">Every project tracks one repo. Branch into learn nodes, plan nodes, and code runs from any commit.</p>
          </div>
          <button className="proj-btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={14} /> New project
          </button>
        </div>

        {loading ? (
          <div className="proj-empty">Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="proj-empty">
            No projects yet — create one to start branching plans and code onto a repo.
          </div>
        ) : (
          <div className="proj-grid">
            {projects.map(p => (
              <div
                key={p.projectId}
                className="proj-card"
                role="button"
                tabIndex={0}
                onClick={() => openProject(p)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') openProject(p); }}
              >
                <div className="proj-card-head">
                  <div className="proj-card-name">{p.name}</div>
                  {p.plugins.length > 0 && (
                    <div className="proj-card-plugins">
                      <Check size={11} /> {p.plugins.length} plugin{p.plugins.length === 1 ? '' : 's'}
                    </div>
                  )}
                </div>
                <div className="proj-card-repo">{p.repoRef.owner}/{p.repoRef.repo}</div>
                <div className="proj-card-meta">
                  Last activity {relativeTime(p.updatedAt)}
                  <ArrowUpRight size={11} className="proj-card-arrow" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <NewProjectModal
          onClose={() => setShowModal(false)}
          onCreate={async payload => {
            const project = await onCreateProject(payload);
            setShowModal(false);
            openProject(project);
          }}
        />
      )}
    </div>
  );
}
