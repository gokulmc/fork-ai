'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CreateProjectPayload, GithubRepo, GithubAppStatus, GithubInstallation, RepoRef } from '@/lib/api';
import { getGithubAppStatus, githubAppInstallUrl, installationSettingsUrl, listGithubRepos } from '@/lib/api';
import { useGithubRepoDetect } from '@/hooks/useGithubRepoDetect';
import { MOCK_REPOS, SKILL_PLUGINS, HARNESS_PLUGINS } from '@/lib/mockGithub';
import { X as XIcon, Github } from './Icons';

interface NewProjectModalProps {
  idToken: string;
  onClose: () => void;
  onCreate: (payload: CreateProjectPayload) => Promise<void>;
}

// Real repos (once GitHub is connected) and mock fixtures share this shape for
// the picker; a real repo's description falls back to its full name.
type RepoOption = Pick<RepoRef, 'provider' | 'owner' | 'repo' | 'defaultBranch' | 'url' | 'private'> & { description: string };

function toRepoOption(r: GithubRepo): RepoOption {
  return { provider: 'github', owner: r.owner, repo: r.repo, defaultBranch: r.defaultBranch, url: r.url, private: r.private, description: r.description || r.fullName };
}

// Slugifies a project name into the synthesized owner/repo shown for a
// from-scratch ('new' provider) project — no real repo exists to name it.
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
}

// Synthesizes the placeholder repoRef for a from-scratch ('new' provider)
// project — no real repo exists yet, so owner/repo/url are derived from the
// name. Shared with App.tsx's Landing-submit-creates-project flow (authed
// query box skips this modal entirely) so both paths produce the same repoRef
// shape for the same name.
export function synthesizeNewRepoRef(name: string): RepoRef {
  const slug = slugify(name);
  return { provider: 'new', owner: 'you', repo: slug, defaultBranch: 'main', url: `mock://new/${slug}` };
}

const MAX_ROOT_QUERY_ROWS = 6;

type Tab = 'new' | 'attach';

// Extracted out of ProjectsPage (D2) and given two tabs: "New repo" seeds a
// from-scratch project with a rootQuery that fills the map's BRANCH root right
// after creation (see App.tsx's submitFillRoot); "Attach existing" is the
// original GitHub/mock repo picker, unchanged.
export function NewProjectModal({ idToken, onClose, onCreate }: NewProjectModalProps) {
  const [tab, setTab] = useState<Tab>('new');
  const [name, setName] = useState('');
  const [rootQuery, setRootQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<RepoOption>(MOCK_REPOS[0]);
  const [plugins, setPlugins] = useState<Set<string>>(new Set());
  const [pluginHint, setPluginHint] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ghApp, setGhApp] = useState<GithubAppStatus | null>(null);
  const [ghRepos, setGhRepos] = useState<GithubRepo[]>([]);

  // New-repo-on-GitHub flow (only reachable once ghApp.installed).
  const [chosenLogin, setChosenLogin] = useState('');

  useEffect(() => {
    getGithubAppStatus(idToken)
      .then(st => {
        setGhApp(st);
        if (st.installed) {
          listGithubRepos(idToken).then(setGhRepos).catch(() => {});
          if (st.installations.length) setChosenLogin(st.installations[0].accountLogin);
        }
      })
      .catch(() => setGhApp({ configured: false, installed: false, installations: [] }));
  }, [idToken]);

  const togglePlugin = (id: string) => {
    setPlugins(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Auto-grow 1→6 rows, same technique as CodeComposer's textarea.
  const rootQueryRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = rootQueryRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_ROOT_QUERY_ROWS)}px`;
  }, [rootQuery]);

  const slug = slugify(name);
  const chosenInstallation: GithubInstallation | null =
    ghApp?.installations.find(i => i.accountLogin === chosenLogin) ?? null;
  const usingRealRepo = tab === 'new' && !!ghApp?.installed;

  const {
    phase: ghPhase,
    capExpired: ghCapExpired,
    detectedRepo,
    start: startCreateOnGithub,
    checkNow: pollGithubRepos,
  } = useGithubRepoDetect(idToken, { login: chosenLogin, slug, description: rootQuery, onRepos: setGhRepos });

  const canSubmit = tab === 'attach'
    ? !!name.trim()
    : usingRealRepo
      ? !!name.trim() && !!rootQuery.trim() && !!detectedRepo
      : !!name.trim() && !!rootQuery.trim();

  const submit = async () => {
    if (!canSubmit || creating) return;
    setCreating(true);
    setError(null);
    try {
      if (usingRealRepo) {
        if (!detectedRepo) throw new Error('no repo detected'); // canSubmit already guards this
        const { provider, owner, repo, defaultBranch, url, private: isPrivate } = toRepoOption(detectedRepo);
        await onCreate({
          name: name.trim(),
          repoRef: { provider, owner, repo, defaultBranch, url, private: isPrivate },
          plugins: [...plugins],
          rootQuery: rootQuery.trim(),
        });
      } else if (tab === 'new') {
        // No real repo exists yet — owner/url are synthesized placeholders
        // consistent with the mock fixtures' shape (RepoRefDto.url just needs
        // to be a non-empty string).
        await onCreate({
          name: name.trim(),
          repoRef: synthesizeNewRepoRef(name),
          plugins: [...plugins],
          rootQuery: rootQuery.trim(),
        });
      } else {
        const { provider, owner, repo, defaultBranch, url, private: isPrivate } = selectedRepo;
        await onCreate({ name: name.trim(), repoRef: { provider, owner, repo, defaultBranch, url, private: isPrivate }, plugins: [...plugins] });
      }
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
        <div className="proj-modal-tabs">
          <button type="button" className={`proj-tab${tab === 'new' ? ' active' : ''}`} onClick={() => setTab('new')}>New repo</button>
          <button type="button" className={`proj-tab${tab === 'attach' ? ' active' : ''}`} onClick={() => setTab('attach')}>Attach existing</button>
        </div>
        <div className="proj-modal-body">
          <div>
            <div className="proj-field-label">{tab === 'new' ? 'Project & repo name' : 'Name'}</div>
            <input
              className="proj-field-input"
              type="text"
              value={name}
              placeholder="billing-service"
              onChange={e => setName(e.target.value)}
              autoFocus
            />
            {tab === 'new' && name.trim() && (
              <div className="proj-field-hint">{usingRealRepo ? chosenLogin || '…' : 'you'}/{slug}</div>
            )}
          </div>

          {tab === 'new' ? (
            <div>
              <div className="proj-field-label">What are you building?</div>
              <textarea
                ref={rootQueryRef}
                className="proj-field-textarea"
                rows={1}
                value={rootQuery}
                placeholder="A billing dashboard with Stripe subscriptions and usage metering…"
                onChange={e => setRootQuery(e.target.value)}
              />
              {usingRealRepo && ghApp ? (
                <>
                  {ghApp.installations.length > 1 && ghPhase === 'idle' && (
                    <div style={{ marginTop: 10 }}>
                      <div className="proj-field-label">Owner</div>
                      <select className="proj-field-input" value={chosenLogin} onChange={e => setChosenLogin(e.target.value)}>
                        {ghApp.installations.map(inst => (
                          <option key={inst.installationId} value={inst.accountLogin}>{inst.accountLogin}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {ghPhase === 'idle' && chosenInstallation?.repositorySelection === 'selected' && (
                    <div className="proj-field-caption">
                      forkai code only sees repos you&apos;ve granted it. To auto-detect the repo you&apos;re about to create,{' '}
                      <a href={installationSettingsUrl(chosenInstallation)} target="_blank" rel="noreferrer">switch the installation to All repositories</a>{' '}
                      — or add the new repo to it afterwards.
                    </div>
                  )}
                  {name.trim() && (
                    <div style={{ marginTop: 10 }}>
                      {ghPhase === 'detected' && detectedRepo ? (
                        <div className="proj-gh-chip"><Github size={12} /> {detectedRepo.owner}/{detectedRepo.repo} · detected</div>
                      ) : (
                        <>
                          <button type="button" className="proj-gh-connect" onClick={startCreateOnGithub} disabled={!chosenLogin}>
                            <Github size={13} /> Create on GitHub ↗
                          </button>
                          <div className="proj-field-caption">Tick &quot;Add a README&quot; so the repo has a first commit.</div>
                        </>
                      )}
                      {ghPhase === 'waiting' && (
                        <div className="proj-field-caption" style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6 }}>
                          {!ghCapExpired && <span className="spinner" style={{ width: 10, height: 10, flexShrink: 0 }} />}
                          <span>{ghCapExpired ? 'Not seeing it — check repo access, then try again.' : 'Waiting for the new repo… (create it in the GitHub tab)'}</span>
                          <button
                            type="button"
                            onClick={pollGithubRepos}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--ink-2)', textDecoration: 'underline', flexShrink: 0 }}
                          >
                            I&apos;ve created it — check now
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="proj-field-caption">The repository is simulated for now — GitHub write access ships later.</div>
                  {ghApp?.configured && (
                    <div className="proj-field-caption">
                      Installing the GitHub App lets forkai code create a real repo —{' '}
                      <a href={githubAppInstallUrl()} target="_blank" rel="noreferrer">install it</a>.
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div>
              <div className="proj-field-label">Repository</div>
              {ghApp?.installed ? (
                <div className="proj-gh-chip"><Github size={12} /> {ghApp.installations.map(i => i.accountLogin).join(', ')}</div>
              ) : ghApp?.configured ? (
                <a className="proj-gh-connect" href={githubAppInstallUrl()}>
                  <Github size={13} />
                  Install GitHub App — pick the repos forkai code may access
                </a>
              ) : ghApp && !ghApp.configured ? (
                <div className="proj-field-error">GitHub App not configured on this server.</div>
              ) : null}
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
          )}

          <div>
            <div className="proj-field-label">
              Plugins{plugins.size > 0 && <span className="proj-plugin-count"> · {plugins.size} selected</span>}
            </div>
            {[{ label: 'Skills', items: SKILL_PLUGINS }, { label: 'Harnesses', items: HARNESS_PLUGINS }].map(g => (
              <div key={g.label}>
                <div className="proj-plugin-group-label">{g.label}</div>
                <div className="proj-plugin-chips">
                  {g.items.map(p => (
                    <button
                      type="button"
                      key={p.id}
                      className={`proj-plugin-chip${plugins.has(p.id) ? ' on' : ''}`}
                      aria-pressed={plugins.has(p.id)}
                      title={p.desc}
                      onClick={() => togglePlugin(p.id)}
                      onMouseEnter={() => setPluginHint(`${p.name} — ${p.desc}`)}
                      onMouseLeave={() => setPluginHint(null)}
                    >
                      <span className="proj-plugin-chip-icon">{p.icon}</span> {p.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="proj-plugin-hint">{pluginHint ?? 'Tap to toggle — hover a plugin for details'}</div>
          </div>
          {error && <div className="proj-field-error">{error}</div>}
        </div>
        <div className="proj-modal-foot">
          <button className="proj-btn-primary" disabled={!canSubmit || creating} onClick={submit}>
            {creating
              ? <><span className="spinner" style={{ width: 11, height: 11 }} /> {tab === 'attach' && selectedRepo.provider === 'github' ? 'Importing repository…' : 'Creating…'}</>
              : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
