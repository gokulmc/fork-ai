'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GithubRepo } from '@/lib/api';
import { listGithubRepos } from '@/lib/api';

// Real-repo detection polling (New repo tab, GitHub App installed): how often
// to re-list repos after "Create on GitHub" is clicked, and how long to keep
// polling automatically before falling back to the manual "check now" button.
const REPO_POLL_INTERVAL_MS = 3000;
const REPO_POLL_CAP_MS = 120_000;

// State machine for the "Create on GitHub" flow once the GitHub App is
// installed: idle (name/owner picked, nothing created yet) → waiting
// (github.com/new opened in a new tab, polling for the repo to appear) →
// detected (repo found, ready to submit). Changing name/description never
// leaves 'detected' automatically — resubmitting "Create on GitHub" would
// restart the cycle.
export type GhCreatePhase = 'idle' | 'waiting' | 'detected';

interface UseGithubRepoDetectOpts {
  login: string;
  slug: string;
  description: string;
  visibility?: 'private' | 'public';
  onRepos?: (repos: GithubRepo[]) => void;
}

interface UseGithubRepoDetectResult {
  phase: GhCreatePhase;
  capExpired: boolean;
  detectedRepo: GithubRepo | null;
  start: () => void;
  checkNow: () => void;
}

// Mechanical extraction of NewProjectModal's create-on-github poll machinery
// so AttachRepoModal can reuse it. `onRepos` fires with each poll's full repo
// list so callers can refresh their own listing (e.g. the "attach existing"
// picker).
export function useGithubRepoDetect(idToken: string, opts: UseGithubRepoDetectOpts): UseGithubRepoDetectResult {
  const { login, slug, description, visibility = 'private', onRepos } = opts;
  const [phase, setPhase] = useState<GhCreatePhase>('idle');
  const [capExpired, setCapExpired] = useState(false);
  const [detectedRepo, setDetectedRepo] = useState<GithubRepo | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollBaselineRef = useRef<Set<string>>(new Set());
  const baselineReadyRef = useRef(false);
  const pollStartRef = useRef(0);
  const pollInFlightRef = useRef(false);

  // Poll cleanup on unmount — the interval must not outlive the caller.
  useEffect(() => () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); }, []);

  // Re-lists repos and checks for a match; guarded against overlapping calls
  // since it's invoked both by the 3s interval and the manual "check now" click.
  const checkNow = useCallback(() => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    (async () => {
      try {
        const repos = await listGithubRepos(idToken);
        onRepos?.(repos);
        const match =
          repos.find(r => r.owner === login && r.repo === slug) ??
          (baselineReadyRef.current ? repos.find(r => !pollBaselineRef.current.has(r.url)) : undefined);
        if (match) {
          setDetectedRepo(match);
          setPhase('detected');
          if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
        }
      } catch {
        // Transient network/API blip — the next tick (or a manual check-now click) retries.
      } finally {
        pollInFlightRef.current = false;
      }
    })();
  }, [idToken, login, slug, onRepos]);

  const start = useCallback(() => {
    if (!login) return;
    const url = `https://github.com/new?owner=${encodeURIComponent(login)}&name=${encodeURIComponent(slug)}&description=${encodeURIComponent(description.slice(0, 100))}&visibility=${visibility}`;
    window.open(url, '_blank', 'noopener,noreferrer');

    const startedAt = Date.now();
    pollStartRef.current = startedAt;
    setCapExpired(false);
    setDetectedRepo(null);
    setPhase('waiting');
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }

    // The not-in-baseline fallback needs a baseline snapshotted at THIS click
    // — the caller's repo list may still be empty (the mount fetch is async and
    // loses the race to a fast user), and an empty baseline makes the first poll
    // "detect" an arbitrary pre-existing repo. The popup must open synchronously
    // above (popup blockers), so the fresh listing happens after; only a
    // successful fetch arms the fallback — the exact owner/slug match works
    // either way. startedAt guards a re-click: a superseded click's async tail
    // must not start a second interval.
    void (async () => {
      try {
        const repos = await listGithubRepos(idToken);
        onRepos?.(repos);
        pollBaselineRef.current = new Set(repos.map(r => r.url));
        baselineReadyRef.current = true;
      } catch {
        baselineReadyRef.current = false;
      }
      if (pollStartRef.current !== startedAt) return;
      pollIntervalRef.current = setInterval(() => {
        if (Date.now() - pollStartRef.current > REPO_POLL_CAP_MS) {
          if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
          setCapExpired(true);
          return;
        }
        checkNow();
      }, REPO_POLL_INTERVAL_MS);
    })();
  }, [idToken, login, slug, description, visibility, onRepos, checkNow]);

  return { phase, capExpired, detectedRepo, start, checkNow };
}
