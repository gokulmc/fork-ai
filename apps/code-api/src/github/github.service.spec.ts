import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GithubService } from './github.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';

const mockDb = {
  getUserMeta: jest.fn(),
  putUserMeta: jest.fn(),
  updateGithubToken: jest.fn(),
};

const CFG_VALUES: Record<string, string> = {
  'github.clientId': 'client-123',
  'github.clientSecret': 'secret-456',
  'github.redirectUri': 'http://localhost:4000/github/callback',
  frontendUrl: 'http://localhost:4001',
};

const mockCfg = { get: jest.fn((key: string): string | undefined => CFG_VALUES[key]) };

const SUB = 'user-sub-123';
const EMAIL = 'dev@example.com';

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return {
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { get: (k: string) => init?.headers?.[k.toLowerCase()] ?? null },
  } as unknown as Response;
}

describe('GithubService', () => {
  let service: GithubService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    fetchSpy = jest.spyOn(global, 'fetch');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubService,
        { provide: ConfigService, useValue: mockCfg },
        { provide: DynamoRepository, useValue: mockDb },
      ],
    }).compile();
    service = module.get<GithubService>(GithubService);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('buildAuthUrl', () => {
    it('throws 503 when clientId is unconfigured', () => {
      mockCfg.get.mockImplementationOnce(() => undefined);
      expect(() => service.buildAuthUrl(SUB, EMAIL)).toThrow(ServiceUnavailableException);
    });

    it('builds a github.com authorize URL with repo scope', () => {
      const url = service.buildAuthUrl(SUB, EMAIL);
      expect(url).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
      expect(url).toContain('scope=repo');
      expect(url).toContain('client_id=client-123');
    });
  });

  describe('handleCallback — state expiry', () => {
    it('rejects an unknown state', async () => {
      await expect(service.handleCallback('code', 'bogus-state')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a state older than 5 minutes', async () => {
      const url = service.buildAuthUrl(SUB, EMAIL);
      const state = new URL(url).searchParams.get('state')!;
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60_000);
      await expect(service.handleCallback('code', state)).rejects.toBeInstanceOf(UnauthorizedException);
      jest.spyOn(Date, 'now').mockRestore();
    });
  });

  describe('handleCallback — token exchange', () => {
    function issueState(): string {
      const url = service.buildAuthUrl(SUB, EMAIL);
      return new URL(url).searchParams.get('state')!;
    }

    it('exchanges the code, fetches the login, and persists the token', async () => {
      const state = issueState();
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_abc123' })) // token exchange
        .mockResolvedValueOnce(jsonResponse({ login: 'octocat' })); // GET /user
      mockDb.getUserMeta.mockResolvedValue({ sub: SUB, email: EMAIL });

      const sub = await service.handleCallback('good-code', state);

      expect(sub).toBe(SUB);
      expect(mockDb.updateGithubToken).toHaveBeenCalledWith(SUB, 'gho_abc123', 'octocat');
      expect(mockDb.putUserMeta).not.toHaveBeenCalled(); // existing user — no upsert needed
    });

    it('upserts UserMeta when the user record does not exist yet', async () => {
      const state = issueState();
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ access_token: 'gho_abc123' }))
        .mockResolvedValueOnce(jsonResponse({ login: 'octocat' }));
      mockDb.getUserMeta.mockResolvedValue(null);

      await service.handleCallback('good-code', state);

      expect(mockDb.putUserMeta).toHaveBeenCalledWith(expect.objectContaining({ sub: SUB, email: EMAIL }));
    });

    it('treats a 200-with-error body as a failed exchange (GitHub does not use HTTP error codes for bad codes)', async () => {
      const state = issueState();
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }),
      );

      await expect(service.handleCallback('bad-code', state)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockDb.updateGithubToken).not.toHaveBeenCalled();
    });

    it('rejects when the HTTP exchange call itself fails', async () => {
      const state = issueState();
      fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'server_error' }, { status: 500 }));

      await expect(service.handleCallback('code', state)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('getStatus', () => {
    it('reports disconnected when no token is stored', async () => {
      mockDb.getUserMeta.mockResolvedValue({ sub: SUB });
      await expect(service.getStatus(SUB)).resolves.toEqual({ connected: false });
    });

    it('reports connected with the stored login', async () => {
      mockDb.getUserMeta.mockResolvedValue({ sub: SUB, githubAccessToken: 'gho_x', githubLogin: 'octocat' });
      await expect(service.getStatus(SUB)).resolves.toEqual({ connected: true, login: 'octocat' });
    });
  });

  describe('listRepos', () => {
    it('throws when the user has not connected GitHub', async () => {
      mockDb.getUserMeta.mockResolvedValue({ sub: SUB });
      await expect(service.listRepos(SUB)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('maps the GitHub repo list shape to GithubRepo', async () => {
      mockDb.getUserMeta.mockResolvedValue({ sub: SUB, githubAccessToken: 'gho_x' });
      fetchSpy.mockResolvedValueOnce(
        jsonResponse([
          {
            owner: { login: 'acme' },
            name: 'widgets',
            full_name: 'acme/widgets',
            default_branch: 'main',
            private: false,
            html_url: 'https://github.com/acme/widgets',
            description: 'Widgets, but as a service',
          },
        ]),
      );

      const repos = await service.listRepos(SUB);
      expect(repos).toEqual([
        {
          owner: 'acme',
          repo: 'widgets',
          fullName: 'acme/widgets',
          defaultBranch: 'main',
          private: false,
          url: 'https://github.com/acme/widgets',
          description: 'Widgets, but as a service',
        },
      ]);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain('per_page=50');
      expect(url).toContain('sort=updated');
      expect((init.headers as Record<string, string>)['X-GitHub-Api-Version']).toBe('2022-11-28');
    });
  });

  describe('getRepoSeed', () => {
    beforeEach(() => {
      mockDb.getUserMeta.mockResolvedValue({ sub: SUB, githubAccessToken: 'gho_x' });
    });

    it('returns nulls for an empty repo (HTTP 409)', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ message: 'Git Repository is empty.' }, { status: 409 }));
      const seed = await service.getRepoSeed(SUB, 'acme', 'empty-repo', 'main');
      expect(seed).toEqual({ defaultBranch: 'main', head: null, first: null });
    });

    it('single commit (no Link header) — first equals head', async () => {
      const commit = { sha: 'abc123', commit: { message: 'Initial commit', author: { date: '2026-01-01T00:00:00Z' } } };
      fetchSpy.mockResolvedValueOnce(jsonResponse([commit])); // no link header
      const seed = await service.getRepoSeed(SUB, 'acme', 'widgets', 'main');
      expect(seed.head).toEqual({ sha: 'abc123', message: 'Initial commit', date: '2026-01-01T00:00:00Z' });
      expect(seed.first).toEqual(seed.head);
      expect(fetchSpy).toHaveBeenCalledTimes(1); // no extra pagination fetch
    });

    it('multi-page history — resolves a distinct first commit via the Link header', async () => {
      const headCommit = { sha: 'head-sha', commit: { message: 'Latest work', author: { date: '2026-02-01T00:00:00Z' } } };
      const firstCommit = { sha: 'first-sha', commit: { message: 'Initial commit', author: { date: '2026-01-01T00:00:00Z' } } };
      const lastPageUrl = 'https://api.github.com/repos/acme/widgets/commits?sha=main&per_page=1&page=42';

      fetchSpy
        .mockResolvedValueOnce(
          jsonResponse([headCommit], {
            headers: {
              link: `<https://api.github.com/repos/acme/widgets/commits?sha=main&per_page=1&page=2>; rel="next", <${lastPageUrl}>; rel="last"`,
            },
          }),
        )
        .mockResolvedValueOnce(jsonResponse([firstCommit]));

      const seed = await service.getRepoSeed(SUB, 'acme', 'widgets', 'main');
      expect(seed.head).toEqual({ sha: 'head-sha', message: 'Latest work', date: '2026-02-01T00:00:00Z' });
      expect(seed.first).toEqual({ sha: 'first-sha', message: 'Initial commit', date: '2026-01-01T00:00:00Z' });
      expect(seed.first).not.toEqual(seed.head);
      expect(fetchSpy).toHaveBeenNthCalledWith(2, lastPageUrl, expect.anything());
    });

    it('an unreadable commits endpoint throws', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ message: 'not found' }, { status: 404 }));
      await expect(service.getRepoSeed(SUB, 'acme', 'widgets', 'main')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
