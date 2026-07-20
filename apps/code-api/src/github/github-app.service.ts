import { createSign } from 'crypto';
import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { GithubInstallationItem } from '@/dynamo/dynamo.interfaces';
import type { GithubRepo } from './github.service';

const GITHUB_API = 'https://api.github.com';
// GitHub rejects an App JWT whose iat is ahead of its own clock — backdating
// absorbs clock skew between this process and GitHub's servers.
const JWT_IAT_SKEW_SEC = 60;
// GitHub caps App JWT lifetime at 10 minutes; 9 leaves margin.
const JWT_TTL_SEC = 9 * 60;
// Installation tokens are valid 1h server-side; refresh a bit early so an
// in-flight sandbox clone never hits an expired token mid-run.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

// createPullRequest's result — a real PR on success, or a typed reason when
// GitHub rejected the request for a known cause. NodesService degrades to its
// existing internal-only MERGE-node behavior on either the failure variant or
// a thrown error; the distinction here only sharpens what gets logged.
export interface CreatePullRequestSuccess {
  number: number;
  url: string;
}
export interface CreatePullRequestFailure {
  // 'exists': GitHub already has an open PR for this head/base pair.
  // 'no_diff': the two branches have no commits between them to PR.
  // 'forbidden': the installation token lacks Pull-requests:Write (the App
  //   permission this whole feature ships behind — see root CLAUDE.md's
  //   WS-E/ADR-0002 note) — the expected outcome until that grant lands.
  // 'failed': any other non-2xx response GitHub returned.
  error: 'exists' | 'no_diff' | 'forbidden' | 'failed';
}

// GitHub App slice (Contents:Read v1 — see docs/forkai-code/adr/0002's
// amendment). Mints short-lived, per-repo (or all-repos) installation tokens
// so a cloud sandbox can clone a PRIVATE repo, and so repo reads/listing can
// happen, without ever holding a durable user credential — the classic OAuth
// App this ADR originally coexisted with has since been removed entirely
// (see the ADR's 2026-07-20 amendment).
//
// No jsonwebtoken/jose dependency — neither is declared in code-api's
// package.json, so the App JWT is hand-signed with node:crypto (same "no new
// SDK for one endpoint" precedent as the GLM provider's raw fetch usage).
@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name);
  // installationId:repo (or installationId:* for an all-repos token) -> token
  // — in-memory only, survives just this process's lifetime.
  private readonly tokenCache = new Map<string, CachedToken>();

  constructor(
    private readonly cfg: ConfigService,
    private readonly db: DynamoRepository,
  ) {}

  isConfigured(): boolean {
    return !!(this.appId() && this.privateKeyPem() && this.slug());
  }

  installUrl(): string {
    const slug = this.slug();
    if (!slug) throw new ServiceUnavailableException('GitHub App not configured');
    return `https://github.com/apps/${slug}/installations/new`;
  }

  appJwt(): string {
    const appId = this.appId();
    const key = this.privateKeyPem();
    if (!appId || !key) throw new InternalServerErrorException('GitHub App not configured');
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({ iat: now - JWT_IAT_SKEW_SEC, exp: now + JWT_TTL_SEC, iss: appId }));
    const signingInput = `${header}.${payload}`;
    const signature = createSign('RSA-SHA256').update(signingInput).sign(key);
    return `${signingInput}.${b64url(signature)}`;
  }

  async verifyAndStoreInstallation(sub: string, installationId: string): Promise<void> {
    const details = await this.fetchInstallationDetails(installationId);
    if (!details) {
      throw new UnauthorizedException(`GitHub installation ${installationId} not found or not accessible by this App`);
    }
    await this.db.putGithubInstallation({
      PK: `USER#${sub}`,
      SK: `GHINST#${installationId}`,
      installationId,
      accountLogin: details.accountLogin,
      accountType: details.accountType,
      repositorySelection: details.repositorySelection,
      createdAt: new Date().toISOString(),
    });
  }

  // Shared with listInstallations' self-heal path below — GET /app/installations/:id
  // returns the account's login/type plus the install's all-vs-selected repo
  // scope. Returns null (never throws) on any non-2xx so both callers can
  // decide their own fallback.
  private async fetchInstallationDetails(
    installationId: string,
  ): Promise<{ accountLogin: string; accountType: 'User' | 'Organization'; repositorySelection: 'all' | 'selected' } | null> {
    const res = await fetch(`${GITHUB_API}/app/installations/${installationId}`, { headers: this.appHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      account: { login: string; type: 'User' | 'Organization' };
      repository_selection: 'all' | 'selected';
    };
    return { accountLogin: data.account.login, accountType: data.account.type, repositorySelection: data.repository_selection };
  }

  // Finds the caller's installation covering `owner` (GitHub logins are
  // case-insensitive) and mints a token scoped to just `repo`. Omitting `repo`
  // mints a token covering every repo on the installation (no `repositories`
  // body field) — used by listInstallationRepos, where the whole point is
  // discovering repos before any single one is known. Returns null — never
  // throws — when the App isn't configured or no installation covers the
  // owner; callers turn that into a user-facing "install the App" prompt.
  async mintInstallationToken(sub: string, owner: string, repo?: string): Promise<string | null> {
    if (!this.isConfigured()) return null;
    const installations = await this.db.listGithubInstallations(sub);
    const installation = installations.find((i) => i.accountLogin.toLowerCase() === owner.toLowerCase());
    if (!installation) return null;
    return this.mintForInstallation(installation.installationId, owner, repo);
  }

  private async mintForInstallation(installationId: string, owner: string, repo?: string): Promise<string | null> {
    const cacheKey = `${installationId}:${repo ?? '*'}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return cached.token;

    const res = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: { ...this.appHeaders(), 'Content-Type': 'application/json' },
      body: repo ? JSON.stringify({ repositories: [repo] }) : undefined,
    });
    if (!res.ok) {
      this.logger.warn(`installation token mint failed for ${owner}/${repo ?? '*'}: ${res.status} ${await res.text().catch(() => '')}`);
      return null;
    }
    const data = (await res.json()) as { token: string; expires_at: string };
    this.tokenCache.set(cacheKey, { token: data.token, expiresAt: new Date(data.expires_at).getTime() });
    return data.token;
  }

  // Status for the frontend's GitHub-connection UI. `configured` reflects
  // whether the App itself is set up on this server (env vars); `installed`
  // is per-user — whether they've completed the App install flow at least
  // once. Never touches the DB when unconfigured, mirroring
  // mintInstallationToken's never-throws-just-degrades convention.
  async listInstallations(sub: string): Promise<{
    configured: boolean;
    installed: boolean;
    installations: Array<{ installationId: string; accountLogin: string; accountType: 'User' | 'Organization'; repositorySelection: 'all' | 'selected' }>;
  }> {
    if (!this.isConfigured()) return { configured: false, installed: false, installations: [] };
    const rows = await this.db.listGithubInstallations(sub);
    const installations = await Promise.all(rows.map((row) => this.resolveInstallationSummary(row)));
    return { configured: true, installed: installations.length > 0, installations };
  }

  // Legacy rows (installed before accountType/repositorySelection were
  // captured) are self-healed with one live lookup here rather than a
  // backfill migration — a user holds at most 1-2 installations, so a
  // per-row fetch on this already-infrequent status call is cheap enough.
  private async resolveInstallationSummary(
    row: GithubInstallationItem,
  ): Promise<{ installationId: string; accountLogin: string; accountType: 'User' | 'Organization'; repositorySelection: 'all' | 'selected' }> {
    if (row.repositorySelection) {
      return { installationId: row.installationId, accountLogin: row.accountLogin, accountType: row.accountType ?? 'User', repositorySelection: row.repositorySelection };
    }
    const details = await this.fetchInstallationDetails(row.installationId);
    if (!details) {
      // 'selected' is the safe assumption when the live lookup itself fails —
      // it only ever adds an "allow All repositories" nudge, never silently
      // over-grants, so degrading here beats dropping the installation.
      return { installationId: row.installationId, accountLogin: row.accountLogin, accountType: 'User', repositorySelection: 'selected' };
    }
    await this.db.putGithubInstallation({ ...row, accountLogin: details.accountLogin, accountType: details.accountType, repositorySelection: details.repositorySelection });
    return { installationId: row.installationId, accountLogin: details.accountLogin, accountType: details.accountType, repositorySelection: details.repositorySelection };
  }

  // Repo picker for project import/creation — the installation-token
  // replacement for the old OAuth-backed GithubService.listRepos. Unlike that
  // endpoint, GitHub's own `GET /installation/repositories` has no
  // `sort=updated` param, so results come back in install order — fine for a
  // picker over a small, explicitly-installed set. A failing installation
  // (mint or fetch) is skipped with a warn log rather than failing the whole call.
  async listInstallationRepos(sub: string): Promise<GithubRepo[]> {
    // Guard before touching stored installations: rows can outlive the App's
    // env config, and mintForInstallation's appJwt() throws (500) when
    // unconfigured instead of degrading like mintInstallationToken does.
    if (!this.isConfigured()) return [];
    const installations = await this.db.listGithubInstallations(sub);
    const repos: GithubRepo[] = [];
    for (const installation of installations) {
      const token = await this.mintForInstallation(installation.installationId, installation.accountLogin);
      if (!token) {
        this.logger.warn(`listInstallationRepos: could not mint a token for installation ${installation.installationId} (${installation.accountLogin})`);
        continue;
      }
      const res = await fetch(`${GITHUB_API}/installation/repositories?per_page=100`, { headers: this.installationHeaders(token) });
      if (!res.ok) {
        this.logger.warn(`listInstallationRepos: failed to list repos for installation ${installation.installationId} (${installation.accountLogin}): ${res.status}`);
        continue;
      }
      const data = (await res.json()) as {
        repositories: Array<{
          owner: { login: string };
          name: string;
          full_name: string;
          default_branch: string;
          private: boolean;
          html_url: string;
          description: string | null;
        }>;
      };
      for (const r of data.repositories) {
        repos.push({
          owner: r.owner.login,
          repo: r.name,
          fullName: r.full_name,
          defaultBranch: r.default_branch,
          private: r.private,
          url: r.html_url,
          description: r.description,
        });
      }
    }
    return repos;
  }

  // Opens a real GitHub PR (ADR-0002/0005 extension — behind the App's
  // Pull-requests:Write permission, an infra grant that ships separately; see
  // the CreatePullRequestFailure 'forbidden' case). Never throws for an
  // expected outcome — mirrors mintInstallationToken's own null-on-"not
  // available" convention — so the caller (NodesService) can always degrade
  // to its internal-only MERGE-node record without a try/catch around a
  // routine "not installed yet" case. Returns null only when there's no
  // installation token to attempt with at all.
  async createPullRequest(
    sub: string,
    owner: string,
    repo: string,
    opts: { head: string; base: string; title: string; body?: string },
  ): Promise<CreatePullRequestSuccess | CreatePullRequestFailure | null> {
    const token = await this.mintInstallationToken(sub, owner, repo);
    if (!token) return null;

    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: { ...this.installationHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ head: opts.head, base: opts.base, title: opts.title, body: opts.body }),
    });
    if (res.ok) {
      const data = (await res.json()) as { number: number; html_url: string };
      return { number: data.number, url: data.html_url };
    }

    const body = (await res.json().catch(() => ({}))) as { message?: string; errors?: Array<{ message?: string }> };
    if (res.status === 422 && /no commits between/i.test(body.message ?? '')) {
      return { error: 'no_diff' };
    }
    if (res.status === 422 && body.errors?.some((e) => /already exists/i.test(e.message ?? ''))) {
      return { error: 'exists' };
    }
    if (res.status === 403) {
      return { error: 'forbidden' };
    }
    this.logger.warn(`createPullRequest failed for ${owner}/${repo} (${opts.head} → ${opts.base}): ${res.status} ${JSON.stringify(body)}`);
    return { error: 'failed' };
  }

  // Merges an already-open real GitHub PR (only ever called once createPullRequest
  // above has confirmed one exists — see NodesService.mergePrNode). Never
  // throws — false covers both "no installation token" and any non-2xx
  // response; the caller logs and keeps its internal-only merge-commit record
  // either way.
  async mergePullRequest(sub: string, owner: string, repo: string, number: number): Promise<boolean> {
    const token = await this.mintInstallationToken(sub, owner, repo);
    if (!token) return false;

    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}/merge`, {
      method: 'PUT',
      headers: { ...this.installationHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      this.logger.warn(`mergePullRequest failed for ${owner}/${repo}#${number}: ${res.status} ${await res.text().catch(() => '')}`);
      return false;
    }
    return true;
  }

  // Eagerly creates the real GitHub ref for a forked branch (#216) — so a
  // fork/branch node exists as a real remote branch as soon as it's created,
  // rather than only appearing on GitHub the first time a CODE run pushes to
  // it. Mirrors createPullRequest's never-throw, typed-outcome convention:
  // 'created'/'exists' both mean the ref is there; 'skipped' covers every
  // reason it isn't (unconfigured App, no installation, parent sha not on the
  // remote yet, or any other failure) — the caller degrades to an
  // internal-only branch node exactly as before this landed.
  async createBranchRef(
    sub: string,
    owner: string,
    repo: string,
    branch: string,
    sha: string,
  ): Promise<'created' | 'exists' | 'skipped'> {
    const token = await this.mintInstallationToken(sub, owner, repo);
    if (!token) return 'skipped';

    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers: { ...this.installationHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });
    if (res.ok) return 'created';

    const body = (await res.json().catch(() => ({}))) as { message?: string };
    if (res.status === 422 && /reference already exists/i.test(body.message ?? '')) {
      return 'exists';
    }
    if (res.status === 422 && /object does not exist/i.test(body.message ?? '')) {
      this.logger.warn(`createBranchRef: base sha ${sha.slice(0, 7)} not found on remote for ${owner}/${repo}@${branch} — skipping`);
      return 'skipped';
    }
    this.logger.warn(`createBranchRef failed for ${owner}/${repo}@${branch}: ${res.status} ${JSON.stringify(body)}`);
    return 'skipped';
  }

  private appHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.appJwt()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  // Same shape as appHeaders, but authenticated as an installation (repo-scoped
  // access token) rather than the App itself — required for repo-level
  // endpoints like /repos/{owner}/{repo}/pulls, which reject an App JWT.
  private installationHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private appId(): string {
    return this.cfg.get<string>('githubApp.appId') ?? '';
  }

  private slug(): string {
    return this.cfg.get<string>('githubApp.slug') ?? '';
  }

  private privateKeyPem(): string {
    const b64 = this.cfg.get<string>('githubApp.privateKeyB64') ?? '';
    return b64 ? Buffer.from(b64, 'base64').toString('utf8') : '';
  }
}

function b64url(input: string | Buffer): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString('base64url');
}
