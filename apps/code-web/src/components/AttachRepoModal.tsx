'use client';
import { useEffect, useState } from 'react';
import type { GithubRepo, GithubAppStatus, GithubInstallation, Project } from '@/lib/api';
import { ApiError, getGithubAppStatus, githubAppInstallUrl, installationSettingsUrl, listGithubRepos, attachProjectRepo } from '@/lib/api';
import { useGithubRepoDetect } from '@/hooks/useGithubRepoDetect';
import { X as XIcon, Github } from './Icons';

interface AttachRepoModalProps {
  idToken: string;
  project: Project; // 'new'-provider project being attached
  pendingRun: boolean; // a run is queued behind this modal — show the Skip button
  onClose: () => void;
  onSkip: () => void;
  onAttached: (project: Project) => void;
}

// Attaches a real GitHub repo to a from-scratch ('new'-provider) project.
// Deliberately NOT a mode on NewProjectModal (D4): attach diverges on nearly
// every field (no mock repos, no plugin picker, a Skip escape hatch, a repo
// name that's independent of the project's own name) — the create-on-github
// poll machinery is the only piece worth sharing, via useGithubRepoDetect.
export function AttachRepoModal({ idToken, project, pendingRun, onClose, onSkip, onAttached }: AttachRepoModalProps) {
  const [ghApp, setGhApp] = useState<GithubAppStatus | null>(null);
  const [ghRepos, setGhRepos] = useState<GithubRepo[]>([]);
  const [chosenLogin, setChosenLogin] = useState('');
  const [repoName, setRepoName] = useState(project.repoRef.repo);
  const [pickedRepo, setPickedRepo] = useState<GithubRepo | null>(null);
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const chosenInstallation: GithubInstallation | null =
    ghApp?.installations.find(i => i.accountLogin === chosenLogin) ?? null;

  const {
    phase: ghPhase,
    capExpired: ghCapExpired,
    detectedRepo,
    start: startCreateOnGithub,
    checkNow: pollGithubRepos,
  } = useGithubRepoDetect(idToken, { login: chosenLogin, slug: repoName, description: project.name, visibility, onRepos: setGhRepos });

  // pickedRepo wins whenever it's the more recent action — clicking a row in
  // "pick an existing repo" always sets it, and starting the create-on-github
  // flow always clears it, so whichever the user did last is what "Attach"
  // sends regardless of the order the two flows were touched in.
  const target = pickedRepo ?? detectedRepo;
  const canAttach = !!target && !attaching;

  const submitAttach = async () => {
    if (!target || attaching) return;
    setAttaching(true);
    setError(null);
    try {
      const updated = await attachProjectRepo(idToken, project.projectId, { owner: target.owner, repo: target.repo });
      onAttached(updated);
    } catch (err) {
      // 4xx messages are user-actionable ("install the App on that account…") — show them verbatim.
      const msg = err instanceof ApiError && err.status < 500 && err.message ? err.message : 'Failed to attach repo — please try again.';
      setError(msg);
      setAttaching(false);
    }
  };

  return (
    <div className="proj-modal-overlay" onClick={e => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="proj-modal">
        <div className="proj-modal-head">
          <div className="proj-modal-title">Connect a GitHub repo</div>
          <button className="proj-modal-close" onClick={onClose} aria-label="Close"><XIcon size={14} /></button>
        </div>
        <div className="proj-modal-body">
          <p className="proj-field-caption" style={{ marginTop: -4, fontSize: 12.5 }}>
            {pendingRun
              ? "Connect a GitHub repo so this run's work is saved."
              : "Work in the sandbox is lost when it expires until this project is connected to a real repo."}
          </p>

          {!ghApp ? (
            <div className="proj-field-caption" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span className="spinner" style={{ width: 10, height: 10, flexShrink: 0 }} />
              <span>Checking GitHub connection…</span>
            </div>
          ) : !ghApp.configured ? (
            <div className="proj-field-error">GitHub App not configured on this server.</div>
          ) : !ghApp.installed ? (
            <a
              className="proj-gh-connect"
              href={githubAppInstallUrl()}
              onClick={() => localStorage.setItem('forkai-code.pendingAttach', project.projectId)}
            >
              <Github size={13} />
              Install GitHub App — pick the repos forkai code may access
            </a>
          ) : (
            <>
              <div>
                <div className="proj-field-label">Create on GitHub</div>
                {ghApp.installations.length > 1 && ghPhase === 'idle' && (
                  <div style={{ marginBottom: 10 }}>
                    <div className="proj-field-label">Owner</div>
                    <select className="proj-field-input" value={chosenLogin} onChange={e => setChosenLogin(e.target.value)}>
                      {ghApp.installations.map(inst => (
                        <option key={inst.installationId} value={inst.accountLogin}>{inst.accountLogin}</option>
                      ))}
                    </select>
                  </div>
                )}
                {ghPhase === 'idle' && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input
                      className="proj-field-input"
                      type="text"
                      value={repoName}
                      onChange={e => setRepoName(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <select
                      className="proj-field-input"
                      style={{ width: 'auto', flexShrink: 0 }}
                      value={visibility}
                      onChange={e => setVisibility(e.target.value as 'private' | 'public')}
                      aria-label="Repo visibility"
                    >
                      <option value="private">Private</option>
                      <option value="public">Public</option>
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
                {ghPhase === 'detected' && detectedRepo ? (
                  <div className="proj-gh-chip"><Github size={12} /> {detectedRepo.owner}/{detectedRepo.repo} · detected</div>
                ) : ghPhase === 'waiting' ? (
                  <div className="proj-field-caption" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
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
                ) : (
                  <>
                    <button
                      type="button"
                      className="proj-gh-connect"
                      onClick={() => { setPickedRepo(null); startCreateOnGithub(); }}
                      disabled={!chosenLogin || !repoName.trim()}
                    >
                      <Github size={13} /> Create on GitHub ↗
                    </button>
                    <div className="proj-field-caption">Tick &quot;Add a README&quot; so the repo has a first commit — an empty repo can&apos;t be cloned for a run.</div>
                  </>
                )}
              </div>

              <div>
                <div className="proj-field-label">Pick an existing repo</div>
                <div className="proj-repo-list">
                  {ghRepos.map(repo => (
                    <div
                      key={repo.url}
                      className={`proj-repo-row${pickedRepo?.url === repo.url ? ' selected' : ''}`}
                      onClick={() => setPickedRepo(repo)}
                      title={repo.description}
                    >
                      <span className="proj-repo-name">{repo.fullName}</span>
                      {repo.private && <span className="mock-tag">private</span>}
                    </div>
                  ))}
                  {ghRepos.length === 0 && (
                    <div className="proj-field-caption" style={{ padding: 10 }}>No repos granted to forkai code yet.</div>
                  )}
                </div>
              </div>
            </>
          )}

          {error && <div className="proj-field-error">{error}</div>}
        </div>
        <div className="proj-modal-foot">
          {pendingRun && (
            <button type="button" className="proj-btn-secondary" style={{ marginRight: 'auto' }} onClick={onSkip}>
              Skip — run without GitHub
            </button>
          )}
          <button className="proj-btn-primary" disabled={!canAttach} onClick={() => void submitAttach()}>
            {attaching ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Attaching…</> : 'Attach'}
          </button>
        </div>
      </div>
    </div>
  );
}
