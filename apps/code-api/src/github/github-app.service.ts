import { createSign } from 'crypto';
import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoRepository } from '@/dynamo/dynamo.repository';

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
// amendment). Distinct from GithubService's classic OAuth App: that one holds
// a long-lived per-user token for read-only browsing/import; this one mints
// short-lived, per-repo installation tokens so a cloud sandbox can clone a
// PRIVATE repo without ever holding a durable user credential.
//
// No jsonwebtoken/jose dependency — neither is declared in code-api's
// package.json, so the App JWT is hand-signed with node:crypto (same "no new
// SDK for one endpoint" precedent as the GLM provider's raw fetch usage).
@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name);
  // installationId:repo -> token — in-memory only, survives just this
  // process's lifetime (same spirit as GithubService's OAuth pendingStates).
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
    const res = await fetch(`${GITHUB_API}/app/installations/${installationId}`, { headers: this.appHeaders() });
    if (!res.ok) {
      throw new UnauthorizedException(`GitHub installation ${installationId} not found or not accessible by this App`);
    }
    const data = (await res.json()) as { account: { login: string } };
    await this.db.putGithubInstallation({
      PK: `USER#${sub}`,
      SK: `GHINST#${installationId}`,
      installationId,
      accountLogin: data.account.login,
      createdAt: new Date().toISOString(),
    });
  }

  // Finds the caller's installation covering `owner` (GitHub logins are
  // case-insensitive) and mints a token scoped to just `repo`. Returns null —
  // never throws — when the App isn't configured or no installation covers
  // the owner; callers turn that into a user-facing "install the App" prompt.
  async mintInstallationToken(sub: string, owner: string, repo: string): Promise<string | null> {
    if (!this.isConfigured()) return null;
    const installations = await this.db.listGithubInstallations(sub);
    const installation = installations.find((i) => i.accountLogin.toLowerCase() === owner.toLowerCase());
    if (!installation) return null;

    const cacheKey = `${installation.installationId}:${repo}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return cached.token;

    const res = await fetch(`${GITHUB_API}/app/installations/${installation.installationId}/access_tokens`, {
      method: 'POST',
      headers: { ...this.appHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ repositories: [repo] }),
    });
    if (!res.ok) {
      this.logger.warn(`installation token mint failed for ${owner}/${repo}: ${res.status} ${await res.text().catch(() => '')}`);
      return null;
    }
    const data = (await res.json()) as { token: string; expires_at: string };
    this.tokenCache.set(cacheKey, { token: data.token, expiresAt: new Date(data.expires_at).getTime() });
    return data.token;
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
