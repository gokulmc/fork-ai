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

  private appHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.appJwt()}`,
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
