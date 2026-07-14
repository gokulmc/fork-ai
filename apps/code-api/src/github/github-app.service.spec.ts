import { generateKeyPairSync } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GithubAppService } from './github-app.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';

const mockDb = {
  putGithubInstallation: jest.fn(),
  listGithubInstallations: jest.fn(),
};

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const PRIVATE_KEY_B64 = Buffer.from(PRIVATE_KEY_PEM).toString('base64');

const CFG_VALUES: Record<string, string> = {
  'githubApp.appId': 'app-123',
  'githubApp.privateKeyB64': PRIVATE_KEY_B64,
  'githubApp.slug': 'forkai-code',
};

const mockCfg = { get: jest.fn((key: string): string | undefined => CFG_VALUES[key]) };

const SUB = 'user-sub-123';

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return {
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function decodeJwt(jwt: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [headerB64, payloadB64] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')),
  };
}

describe('GithubAppService', () => {
  let service: GithubAppService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCfg.get.mockImplementation((key: string) => CFG_VALUES[key]);
    fetchSpy = jest.spyOn(global, 'fetch');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubAppService,
        { provide: ConfigService, useValue: mockCfg },
        { provide: DynamoRepository, useValue: mockDb },
      ],
    }).compile();
    service = module.get<GithubAppService>(GithubAppService);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('isConfigured', () => {
    it('is true when appId, key, and slug are all set', () => {
      expect(service.isConfigured()).toBe(true);
    });

    it('is false when any of the three is missing', () => {
      mockCfg.get.mockImplementation((key: string) => (key === 'githubApp.slug' ? undefined : CFG_VALUES[key]));
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('installUrl', () => {
    it('builds the GitHub App installations/new URL from the configured slug', () => {
      expect(service.installUrl()).toBe('https://github.com/apps/forkai-code/installations/new');
    });

    it('throws when the slug is unconfigured', () => {
      mockCfg.get.mockImplementation((key: string) => (key === 'githubApp.slug' ? undefined : CFG_VALUES[key]));
      expect(() => service.installUrl()).toThrow(ServiceUnavailableException);
    });
  });

  describe('appJwt', () => {
    it('signs an RS256 JWT with iss=appId, iat backdated, exp ahead', () => {
      const before = Math.floor(Date.now() / 1000);
      const jwt = service.appJwt();
      const { header, payload } = decodeJwt(jwt);

      expect(header.alg).toBe('RS256');
      expect(payload.iss).toBe('app-123');
      expect(payload.iat as number).toBeLessThanOrEqual(before);
      expect((payload.exp as number) - (payload.iat as number)).toBeGreaterThan(9 * 60 - 5);
      expect(jwt.split('.')).toHaveLength(3);
    });
  });

  describe('verifyAndStoreInstallation', () => {
    it('persists the installation on a successful lookup', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ account: { login: 'acme' } }));

      await service.verifyAndStoreInstallation(SUB, '999');

      expect(mockDb.putGithubInstallation).toHaveBeenCalledWith(
        expect.objectContaining({ PK: `USER#${SUB}`, SK: 'GHINST#999', installationId: '999', accountLogin: 'acme' }),
      );
    });

    it('throws when the App cannot see the installation', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ message: 'not found' }, { status: 404 }));
      await expect(service.verifyAndStoreInstallation(SUB, '999')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockDb.putGithubInstallation).not.toHaveBeenCalled();
    });
  });

  describe('mintInstallationToken', () => {
    it('returns null when the App is not configured (never throws)', async () => {
      mockCfg.get.mockImplementation((key: string) => (key === 'githubApp.appId' ? undefined : CFG_VALUES[key]));
      await expect(service.mintInstallationToken(SUB, 'acme', 'widgets')).resolves.toBeNull();
      expect(mockDb.listGithubInstallations).not.toHaveBeenCalled();
    });

    it('returns null when no installation covers the owner', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([{ installationId: '1', accountLogin: 'someone-else' }]);
      await expect(service.mintInstallationToken(SUB, 'acme', 'widgets')).resolves.toBeNull();
    });

    it('mints a token scoped to the single repo, case-insensitively matching the owner', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([{ installationId: '42', accountLogin: 'Acme' }]);
      fetchSpy.mockResolvedValueOnce(jsonResponse({ token: 'ghs_abc', expires_at: new Date(Date.now() + 3600_000).toISOString() }));

      const token = await service.mintInstallationToken(SUB, 'acme', 'widgets');

      expect(token).toBe('ghs_abc');
      const [url, init] = fetchSpy.mock.calls[0] as [string, { method: string; body: string }];
      expect(url).toBe('https://api.github.com/app/installations/42/access_tokens');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ repositories: ['widgets'] });
    });

    it('caches the token and does not re-mint on a second call', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([{ installationId: '42', accountLogin: 'acme' }]);
      fetchSpy.mockResolvedValueOnce(jsonResponse({ token: 'ghs_abc', expires_at: new Date(Date.now() + 3600_000).toISOString() }));

      await service.mintInstallationToken(SUB, 'acme', 'widgets');
      const second = await service.mintInstallationToken(SUB, 'acme', 'widgets');

      expect(second).toBe('ghs_abc');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('re-mints once the cached token is within the refresh margin of expiry', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([{ installationId: '42', accountLogin: 'acme' }]);
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ token: 'ghs_old', expires_at: new Date(Date.now() + 60_000).toISOString() })) // 1 min out — inside the 5-min margin
        .mockResolvedValueOnce(jsonResponse({ token: 'ghs_new', expires_at: new Date(Date.now() + 3600_000).toISOString() }));

      const first = await service.mintInstallationToken(SUB, 'acme', 'widgets');
      const second = await service.mintInstallationToken(SUB, 'acme', 'widgets');

      expect(first).toBe('ghs_old');
      expect(second).toBe('ghs_new');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('returns null (not a throw) when the token-mint call itself fails', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([{ installationId: '42', accountLogin: 'acme' }]);
      fetchSpy.mockResolvedValueOnce(jsonResponse({ message: 'server error' }, { status: 500 }));

      await expect(service.mintInstallationToken(SUB, 'acme', 'widgets')).resolves.toBeNull();
    });
  });

  describe('createPullRequest', () => {
    const OPTS = { head: 'feature/x', base: 'main', title: 'PR: feature/x → main', body: 'Opened automatically by forkai code.' };

    function mockTokenThen(...responses: Response[]) {
      mockDb.listGithubInstallations.mockResolvedValue([{ installationId: '42', accountLogin: 'acme' }]);
      fetchSpy.mockResolvedValueOnce(jsonResponse({ token: 'ghs_abc', expires_at: new Date(Date.now() + 3600_000).toISOString() }));
      for (const r of responses) fetchSpy.mockResolvedValueOnce(r);
    }

    it('returns null (never throws) when no installation covers the owner', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([]);
      await expect(service.createPullRequest(SUB, 'acme', 'widgets', OPTS)).resolves.toBeNull();
      // mintInstallationToken itself never calls fetch with no covering installation.
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('creates a real PR and returns {number, url} on success, posting head/base/title/body', async () => {
      mockTokenThen(jsonResponse({ number: 7, html_url: 'https://github.com/acme/widgets/pull/7' }, { status: 201 }));

      const result = await service.createPullRequest(SUB, 'acme', 'widgets', OPTS);

      expect(result).toEqual({ number: 7, url: 'https://github.com/acme/widgets/pull/7' });
      const [url, init] = fetchSpy.mock.calls[1] as [string, { method: string; body: string }];
      expect(url).toBe('https://api.github.com/repos/acme/widgets/pulls');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual(OPTS);
    });

    it("returns { error: 'exists' } when GitHub reports a PR already exists", async () => {
      mockTokenThen(jsonResponse(
        { message: 'Validation Failed', errors: [{ resource: 'PullRequest', code: 'custom', message: 'A pull request already exists for acme:feature/x.' }] },
        { status: 422 },
      ));

      await expect(service.createPullRequest(SUB, 'acme', 'widgets', OPTS)).resolves.toEqual({ error: 'exists' });
    });

    it("returns { error: 'no_diff' } when GitHub reports no commits between the branches", async () => {
      mockTokenThen(jsonResponse({ message: 'No commits between main and feature/x' }, { status: 422 }));

      await expect(service.createPullRequest(SUB, 'acme', 'widgets', OPTS)).resolves.toEqual({ error: 'no_diff' });
    });

    it("returns { error: 'forbidden' } on a 403 (installation token lacks Pull-requests:Write)", async () => {
      mockTokenThen(jsonResponse({ message: 'Resource not accessible by integration' }, { status: 403 }));

      await expect(service.createPullRequest(SUB, 'acme', 'widgets', OPTS)).resolves.toEqual({ error: 'forbidden' });
    });

    it("returns { error: 'failed' } on an unrecognized failure, without throwing", async () => {
      mockTokenThen(jsonResponse({ message: 'Internal Server Error' }, { status: 500 }));

      await expect(service.createPullRequest(SUB, 'acme', 'widgets', OPTS)).resolves.toEqual({ error: 'failed' });
    });
  });

  describe('createBranchRef', () => {
    it('returns "skipped" (never throws) when no installation covers the owner', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([]);
      await expect(service.createBranchRef(SUB, 'acme', 'widgets', 'fork/x', 'deadbeef')).resolves.toBe('skipped');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('creates the ref and returns "created" on success, posting ref/sha', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([{ installationId: '42', accountLogin: 'acme' }]);
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ token: 'ghs_abc', expires_at: new Date(Date.now() + 3600_000).toISOString() }))
        .mockResolvedValueOnce(jsonResponse({ ref: 'refs/heads/fork/x' }, { status: 201 }));

      const result = await service.createBranchRef(SUB, 'acme', 'widgets', 'fork/x', 'deadbeef');

      expect(result).toBe('created');
      const [url, init] = fetchSpy.mock.calls[1] as [string, { method: string; body: string }];
      expect(url).toBe('https://api.github.com/repos/acme/widgets/git/refs');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ ref: 'refs/heads/fork/x', sha: 'deadbeef' });
    });

    it('returns "exists" when GitHub reports the ref already exists', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([{ installationId: '42', accountLogin: 'acme' }]);
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ token: 'ghs_abc', expires_at: new Date(Date.now() + 3600_000).toISOString() }))
        .mockResolvedValueOnce(jsonResponse({ message: 'Reference already exists' }, { status: 422 }));

      await expect(service.createBranchRef(SUB, 'acme', 'widgets', 'fork/x', 'deadbeef')).resolves.toBe('exists');
    });

    it('returns "skipped" when the base sha is not on the remote yet', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([{ installationId: '42', accountLogin: 'acme' }]);
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ token: 'ghs_abc', expires_at: new Date(Date.now() + 3600_000).toISOString() }))
        .mockResolvedValueOnce(jsonResponse({ message: 'Object does not exist' }, { status: 422 }));

      await expect(service.createBranchRef(SUB, 'acme', 'widgets', 'fork/x', 'deadbeef')).resolves.toBe('skipped');
    });

    it('returns "skipped" (not a throw) on any other failure', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([{ installationId: '42', accountLogin: 'acme' }]);
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ token: 'ghs_abc', expires_at: new Date(Date.now() + 3600_000).toISOString() }))
        .mockResolvedValueOnce(jsonResponse({ message: 'Internal Server Error' }, { status: 500 }));

      await expect(service.createBranchRef(SUB, 'acme', 'widgets', 'fork/x', 'deadbeef')).resolves.toBe('skipped');
    });
  });

  describe('mergePullRequest', () => {
    it('returns false (never throws) when no installation covers the owner', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([]);
      await expect(service.mergePullRequest(SUB, 'acme', 'widgets', 7)).resolves.toBe(false);
    });

    it('PUTs the merge endpoint and returns true on success', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([{ installationId: '42', accountLogin: 'acme' }]);
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ token: 'ghs_abc', expires_at: new Date(Date.now() + 3600_000).toISOString() }))
        .mockResolvedValueOnce(jsonResponse({ merged: true }));

      const result = await service.mergePullRequest(SUB, 'acme', 'widgets', 7);

      expect(result).toBe(true);
      const [url, init] = fetchSpy.mock.calls[1] as [string, { method: string }];
      expect(url).toBe('https://api.github.com/repos/acme/widgets/pulls/7/merge');
      expect(init.method).toBe('PUT');
    });

    it('returns false (not a throw) when the merge call fails', async () => {
      mockDb.listGithubInstallations.mockResolvedValue([{ installationId: '42', accountLogin: 'acme' }]);
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ token: 'ghs_abc', expires_at: new Date(Date.now() + 3600_000).toISOString() }))
        .mockResolvedValueOnce(jsonResponse({ message: 'not mergeable' }, { status: 405 }));

      await expect(service.mergePullRequest(SUB, 'acme', 'widgets', 7)).resolves.toBe(false);
    });
  });
});
