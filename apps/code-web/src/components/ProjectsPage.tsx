'use client';
import { useEffect, useState } from 'react';
import type { Project, CreateProjectPayload, GithubRepo, GithubStatus, RepoRef } from '@/lib/api';
import { getGithubStatus, getGithubAuthUrl, listGithubRepos, ApiError } from '@/lib/api';
import { MOCK_REPOS, PLUGINS } from '@/lib/mockGithub';
import { Clock, ArrowUpRight, Plus, X as XIcon, Check, Github } from './Icons';

interface ProjectsPageProps {
  projects: Project[];
  loading: boolean;
  idToken: string;
  onOpenProject: (project: Project) => void;
  onCreateProject: (payload: CreateProjectPayload) => Promise<Project>;
  onShowHistory: () => void;
  // Auto-opens the New Project modal once, after a `?github=connected` round-trip.
  initialModalOpen?: boolean;
}

// Real repos (once GitHub is connected) and mock fixtures share this shape for
// the picker; a real repo's description falls back to its full name.
type RepoOption = Pick<RepoRef, 'provider' | 'owner' | 'repo' | 'defaultBranch' | 'url'> & { description: string };

function toRepoOption(r: GithubRepo): RepoOption {
  return { provider: 'github', owner: r.owner, repo: r.repo, defaultBranch: r.defaultBranch, url: r.url, description: r.description || r.fullName };
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

function NewProjectModal({ idToken, onClose, onCreate }: { idToken: string; onClose: () => void; onCreate: (payload: CreateProjectPayload) => Promise<void> }) {
  const [name, setName] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<RepoOption>(MOCK_REPOS[0]);
  const [plugins, setPlugins] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ghStatus, setGhStatus] = useState<GithubStatus | null>(null);
  const [ghRepos, setGhRepos] = useState<GithubRepo[]>([]);
  const [ghConnecting, setGhConnecting] = useState(false);
  const [ghHint, setGhHint] = useState<string | null>(null);

  useEffect(() => {
    getGithubStatus(idToken)
      .then(status => {
        setGhStatus(status);
        if (status.connected) listGithubRepos(idToken).then(setGhRepos).catch(() => {});
      })
      .catch(() => setGhStatus({ connected: false }));
  }, [idToken]);

  const connectGithub = async () => {
    setGhConnecting(true);
    setGhHint(null);
    try {
      const { url } = await getGithubAuthUrl(idToken);
      window.location.href = url;
    } catch (err) {
      setGhHint(err instanceof ApiError && err.status === 503 ? 'GitHub OAuth not configured' : 'Could not start GitHub connect — try again.');
      setGhConnecting(false);
    }
  };

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
            {ghStatus?.connected ? (
              <div className="proj-gh-chip"><Github size={12} /> {ghStatus.login}</div>
            ) : (
              <button type="button" className="proj-gh-connect" disabled={ghConnecting} onClick={connectGithub}>
                {ghConnecting ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Github size={13} />}
                Connect GitHub (read-only — we only ever read, never push)
              </button>
            )}
            {ghHint && <div className="proj-field-error">{ghHint}</div>}
            <div className="proj-repo-list">
              {ghRepos.map(repo => (
                <div
                  key={repo.url}
                  className={`proj-repo-row${repo.url === selectedRepo.url ? ' selected' : ''}`}
                  onClick={() => setSelectedRepo(toRepoOption(repo))}
                  title={repo.description}
                >
                  <span className="proj-repo-name">{repo.fullName}</span>
                  {repo.private && <span className="mock-tag">private</span>}
                </div>
              ))}
              {ghRepos.length > 0 && <div className="proj-repo-divider">mock repos</div>}
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

export function ProjectsPage({ projects, loading, idToken, onOpenProject, onCreateProject, onShowHistory, initialModalOpen }: ProjectsPageProps) {
  const [showModal, setShowModal] = useState(false);
  const [leavingId, setLeavingId] = useState<string | null>(null);

  // initialModalOpen can flip true AFTER this component has already mounted
  // (App.tsx sets it once the `?github=connected` query param is parsed) — a
  // reactive effect, not a useState initializer, so the late arrival still opens it.
  useEffect(() => { if (initialModalOpen) setShowModal(true); }, [initialModalOpen]);

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
          idToken={idToken}
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
