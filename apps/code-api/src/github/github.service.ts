import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { DiffSummary } from '@/dynamo/dynamo.interfaces';

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

  // Short-lived in-memory map: state → sub+email (survives only the OAuth round-trip, ~60 s)
  private readonly pendingStates = new Map<string, { sub: string; email: string; expiresAt: number }>();

  constructor(
    private readonly cfg: ConfigService,
    private readonly db: DynamoRepository,
  ) {}

  // ── OAuth ──────────────────────────────────────────────────────────────────

  buildAuthUrl(sub: string, email: string): string {
    const clientId = this.cfg.get<string>('github.clientId');
    if (!clientId) {
      throw new ServiceUnavailableException('GitHub integration not configured');
    }

    const state = `${sub}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.pendingStates.set(state, { sub, email, expiresAt: Date.now() + 5 * 60_000 });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.cfg.get<string>('github.redirectUri')!,
      // OAuth Apps have no true read-only scope — `repo` is the narrowest scope
      // that can read a private repo's commits. We only ever GET, never write.
      scope: 'repo',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async handleCallback(code: string, state: string): Promise<string> {
    const entry = this.pendingStates.get(state);
    if (!entry || Date.now() > entry.expiresAt) {
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }
    this.pendingStates.delete(state);

    const { sub, email } = entry;
    const token = await this.exchangeCode(code);
    const login = await this.fetchLogin(token);

    // Upsert UserMeta so the record exists even if the user never called GET /users/me
    const existing = await this.db.getUserMeta(sub);
    if (!existing) {
      const now = new Date().toISOString();
      await this.db.putUserMeta({ PK: `USER#${sub}`, SK: 'METADATA', sub, email, createdAt: now, updatedAt: now });
    }
    await this.db.updateGithubToken(sub, token, login);
    return sub;
  }

  private async exchangeCode(code: string): Promise<string> {
    const clientId = this.cfg.get<string>('github.clientId')!;
    const clientSecret = this.cfg.get<string>('github.clientSecret')!;
    const redirectUri = this.cfg.get<string>('github.redirectUri')!;

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Without this GitHub replies with a form-encoded body instead of JSON.
        Accept: 'application/json',
      },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new UnauthorizedException(`GitHub token exchange failed: ${text}`);
    }
    // GitHub returns HTTP 200 even for a bad/expired code — the error rides in
    // the JSON body (e.g. { error: 'bad_verification_code', ... }).
    const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
    if (!data.access_token) {
      throw new UnauthorizedException(`GitHub token exchange failed: ${data.error_description ?? data.error ?? 'unknown error'}`);
    }
    return data.access_token;
  }

  private async fetchLogin(token: string): Promise<string> {
    const res = await fetch(`${GITHUB_API}/user`, { headers: this.authHeaders(token) });
    if (!res.ok) throw new UnauthorizedException('Failed to fetch GitHub user profile');
    const data = (await res.json()) as { login: string };
    return data.login;
  }

  private authHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  async getStatus(sub: string): Promise<{ connected: boolean; login?: string }> {
    const user = await this.db.getUserMeta(sub);
    if (!user?.githubAccessToken) return { connected: false };
    return { connected: true, login: user.githubLogin };
  }

  // ── Repos ──────────────────────────────────────────────────────────────────

  async listRepos(sub: string): Promise<GithubRepo[]> {
    const token = await this.requireToken(sub);
    const res = await fetch(`${GITHUB_API}/user/repos?per_page=50&sort=updated`, { headers: this.authHeaders(token) });
    if (!res.ok) throw new UnauthorizedException('Failed to list GitHub repos');
    const data = (await res.json()) as Array<{
      owner: { login: string };
      name: string;
      full_name: string;
      default_branch: string;
      private: boolean;
      html_url: string;
      description: string | null;
    }>;
    return data.map((r) => ({
      owner: r.owner.login,
      repo: r.name,
      fullName: r.full_name,
      defaultBranch: r.default_branch,
      private: r.private,
      url: r.html_url,
      description: r.description,
    }));
  }

  // ── Repo seed (root-commit history for D1 project seeding) ────────────────

  async getRepoSeed(sub: string, owner: string, repo: string, branch: string): Promise<RepoSeed> {
    const token = await this.requireToken(sub);
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

  private async requireToken(sub: string): Promise<string> {
    const user = await this.db.getUserMeta(sub);
    if (!user?.githubAccessToken) {
      throw new UnauthorizedException('GitHub account not connected');
    }
    return user.githubAccessToken;
  }

  // ── Full history import (repo-import.service.ts) ───────────────────────────

  async listBranches(sub: string, owner: string, repo: string): Promise<GithubBranch[]> {
    const token = await this.requireToken(sub);
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
    const token = await this.requireToken(sub);
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
    const token = await this.requireToken(sub);
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
      const token = await this.requireToken(sub);
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
