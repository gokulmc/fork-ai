import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { DiffSummary } from '@/dynamo/dynamo.interfaces';
import { GithubAppService } from './github-app.service';

export interface GithubRepo {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  url: string;
  description: string | null;
}

export interface RepoSeedCommit {
  sha: string;
  message: string;
  date: string;
}

// What ProjectsService needs to seed a Project's map: the branch's HEAD commit
// and the very first commit on it (see getRepoSeed). Both null for an empty repo.
export interface RepoSeed {
  defaultBranch: string;
  head: RepoSeedCommit | null;
  first: RepoSeedCommit | null;
}

interface GithubCommitApi {
  sha: string;
  commit: { message: string; author: { date: string } | null };
  parents?: Array<{ sha: string }>;
}

export interface GithubBranch {
  name: string;
  headSha: string;
}

export interface RepoCommit extends RepoSeedCommit {
  parents: string[];
}

export interface RepoCompare {
  mergeBaseSha: string;
  commits: RepoSeedCommit[];
}

const GITHUB_API = 'https://api.github.com';
// listBranches hard-stops here — a repo-import fan-out over more branches than
// this isn't worth the API calls (see repo-import.service.ts's BRANCH_COUNT_CAP,
// which independently re-caps whatever this returns).
const MAX_BRANCHES = 20;

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  constructor(private readonly githubApp: GithubAppService) {}

  private authHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  // ── Repo seed (root-commit history for D1 project seeding) ────────────────

  async getRepoSeed(sub: string, owner: string, repo: string, branch: string): Promise<RepoSeed> {
    const token = await this.githubApp.mintInstallationToken(sub, owner, repo);
    if (!token) throw new UnauthorizedException(`GitHub App not installed on ${owner}/${repo}`);
    const headers = this.authHeaders(token);

    const headRes = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`,
      { headers },
    );
    if (headRes.status === 409) {
      // Empty repo — GitHub 409s "Git Repository is empty" instead of a 200 with [].
      return { defaultBranch: branch, head: null, first: null };
    }
    if (!headRes.ok) throw new UnauthorizedException(`Failed to read commits for ${owner}/${repo}`);
    const headCommits = (await headRes.json()) as GithubCommitApi[];
    const head = headCommits[0] ? toRepoSeedCommit(headCommits[0]) : null;
    if (!head) return { defaultBranch: branch, head: null, first: null };

    // FIRST commit: with per_page=1, the Link header's page count equals the
    // total commit count — its rel="last" URL fetches exactly the oldest commit.
    // No Link header ⇒ this was the only page ⇒ a single commit ⇒ first === head.
    const lastPageUrl = parseLastPageUrl(headRes.headers.get('link'));
    if (!lastPageUrl) return { defaultBranch: branch, head, first: head };

    const firstRes = await fetch(lastPageUrl, { headers });
    if (!firstRes.ok) return { defaultBranch: branch, head, first: head };
    const firstCommits = (await firstRes.json()) as GithubCommitApi[];
    const first = firstCommits[0] ? toRepoSeedCommit(firstCommits[0]) : head;
    return { defaultBranch: branch, head, first };
  }

  // ── Full history import (repo-import.service.ts) ───────────────────────────

  async listBranches(sub: string, owner: string, repo: string): Promise<GithubBranch[]> {
    const token = await this.githubApp.mintInstallationToken(sub, owner, repo);
    if (!token) throw new UnauthorizedException(`GitHub App not installed on ${owner}/${repo}`);
    const headers = this.authHeaders(token);
    const branches: GithubBranch[] = [];
    let url: string | null = `${GITHUB_API}/repos/${owner}/${repo}/branches?per_page=100`;
    while (url && branches.length < MAX_BRANCHES) {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new UnauthorizedException(`Failed to list branches for ${owner}/${repo}`);
      const data = (await res.json()) as Array<{ name: string; commit: { sha: string } }>;
      for (const b of data) {
        if (branches.length >= MAX_BRANCHES) break;
        branches.push({ name: b.name, headSha: b.commit.sha });
      }
      url = parseNextPageUrl(res.headers.get('link'));
    }
    return branches;
  }

  async listCommits(sub: string, owner: string, repo: string, branch: string, cap: number): Promise<RepoCommit[]> {
    const token = await this.githubApp.mintInstallationToken(sub, owner, repo);
    if (!token) throw new UnauthorizedException(`GitHub App not installed on ${owner}/${repo}`);
    const headers = this.authHeaders(token);
    const commits: RepoCommit[] = [];
    let url: string | null = `${GITHUB_API}/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=100`;
    while (url && commits.length < cap) {
      const res = await fetch(url, { headers });
      if (res.status === 409) {
        // Empty repo — GitHub 409s "Git Repository is empty" instead of a 200 with [].
        // Only possible on the first page; a later page 409ing would mean an
        // already-fetched earlier page lied, which can't happen.
        break;
      }
      if (!res.ok) throw new UnauthorizedException(`Failed to list commits for ${owner}/${repo}@${branch}`);
      const data = (await res.json()) as GithubCommitApi[];
      for (const c of data) {
        if (commits.length >= cap) break;
        commits.push({ ...toRepoSeedCommit(c), parents: (c.parents ?? []).map((p) => p.sha) });
      }
      url = parseNextPageUrl(res.headers.get('link'));
    }
    return commits;
  }

  async compareCommits(sub: string, owner: string, repo: string, base: string, head: string): Promise<RepoCompare> {
    const token = await this.githubApp.mintInstallationToken(sub, owner, repo);
    if (!token) throw new UnauthorizedException(`GitHub App not installed on ${owner}/${repo}`);
    const headers = this.authHeaders(token);
    const res = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      { headers },
    );
    if (!res.ok) throw new UnauthorizedException(`Failed to compare ${base}...${head} for ${owner}/${repo}`);
    const data = (await res.json()) as {
      merge_base_commit: GithubCommitApi;
      commits: GithubCommitApi[];
    };
    return {
      mergeBaseSha: data.merge_base_commit.sha,
      commits: data.commits.map(toRepoSeedCommit),
    };
  }

  // Per-commit file-level diff for an imported commit — compareCommits above
  // only carries {sha,message,date} per commit, never files[]. Never throws:
  // a partial import (§2c) must not fail because one commit's diff fetch did.
  async getCommitDiff(sub: string, owner: string, repo: string, sha: string): Promise<DiffSummary | null> {
    try {
      const token = await this.githubApp.mintInstallationToken(sub, owner, repo);
      if (!token) return null;
      const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits/${sha}`, { headers: this.authHeaders(token) });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        files?: Array<{ filename: string; status: string; additions: number; deletions: number }>;
      };
      const files = (data.files ?? []).map((f) => ({
        path: f.filename,
        status: toDiffStatus(f.status),
        additions: f.additions,
        deletions: f.deletions,
      }));
      return {
        filesChanged: files.length,
        additions: files.reduce((sum, f) => sum + f.additions, 0),
        deletions: files.reduce((sum, f) => sum + f.deletions, 0),
        files,
      };
    } catch (err) {
      this.logger.warn(`getCommitDiff failed for ${owner}/${repo}@${sha}: ${(err as Error).message}`);
      return null;
    }
  }
}

function toRepoSeedCommit(c: GithubCommitApi): RepoSeedCommit {
  return { sha: c.sha, message: c.commit.message, date: c.commit.author?.date ?? new Date().toISOString() };
}

// Maps GitHub's per-file commit status onto the app's own DiffSummary status
// vocabulary — 'added'/'modified'/'deleted'/'renamed'/'copied', the same
// values a real agent run's own diffSummaryBetween (git-diff.ts's
// STATUS_WORDS + name-status R/C handling) produces. GitHub's 'removed' maps
// to 'deleted'; its rarer 'changed'/'unchanged' (mode-only or no-op diffs)
// fall back to 'modified' like an unrecognised git status code does.
function toDiffStatus(githubStatus: string): string {
  if (githubStatus === 'removed') return 'deleted';
  if (githubStatus === 'added' || githubStatus === 'renamed' || githubStatus === 'copied') return githubStatus;
  return 'modified';
}

// Extracts the rel="last" URL from a GitHub Link header, e.g.
// `<https://api.github.com/...?page=2>; rel="next", <...?page=42>; rel="last"`.
function parseLastPageUrl(link: string | null): string | null {
  if (!link) return null;
  const part = link.split(',').find((p) => p.includes('rel="last"'));
  const match = part?.match(/<([^>]+)>/);
  return match ? match[1] : null;
}

// Same shape as parseLastPageUrl but for rel="next" — drives listBranches'/
// listCommits' page-by-page walk.
function parseNextPageUrl(link: string | null): string | null {
  if (!link) return null;
  const part = link.split(',').find((p) => p.includes('rel="next"'));
  const match = part?.match(/<([^>]+)>/);
  return match ? match[1] : null;
}
