import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { GithubService } from './github.service';
import { GithubAppService } from './github-app.service';

const mockGithubApp = {
  mintInstallationToken: jest.fn(),
};

const SUB = 'user-sub-123';

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
      providers: [GithubService, { provide: GithubAppService, useValue: mockGithubApp }],
    }).compile();
    service = module.get<GithubService>(GithubService);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('getRepoSeed', () => {
    beforeEach(() => {
      mockGithubApp.mintInstallationToken.mockResolvedValue('ghs_x');
    });

    it('throws when the GitHub App is not installed on the owner (mint returns null)', async () => {
      mockGithubApp.mintInstallationToken.mockResolvedValue(null);
      await expect(service.getRepoSeed(SUB, 'acme', 'widgets', 'main')).rejects.toBeInstanceOf(UnauthorizedException);
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

  describe('getCommitDiff', () => {
    beforeEach(() => {
      mockGithubApp.mintInstallationToken.mockResolvedValue('ghs_x');
    });

    it('maps files[] to a DiffSummary, translating status and recomputing totals', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({
          sha: 'abc123',
          files: [
            { filename: 'src/a.ts', status: 'added', additions: 10, deletions: 0 },
            { filename: 'src/b.ts', status: 'modified', additions: 2, deletions: 1 },
            { filename: 'old.ts', status: 'removed', additions: 0, deletions: 5 },
            { filename: 'c.ts', status: 'renamed', additions: 0, deletions: 0 },
          ],
        }),
      );

      const diff = await service.getCommitDiff(SUB, 'acme', 'widgets', 'abc123');
      expect(diff).toEqual({
        filesChanged: 4,
        additions: 12,
        deletions: 6,
        files: [
          { path: 'src/a.ts', status: 'added', additions: 10, deletions: 0 },
          { path: 'src/b.ts', status: 'modified', additions: 2, deletions: 1 },
          { path: 'old.ts', status: 'deleted', additions: 0, deletions: 5 },
          { path: 'c.ts', status: 'renamed', additions: 0, deletions: 0 },
        ],
      });
    });

    it('returns null (never throws) on a non-ok response', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ message: 'not found' }, { status: 404 }));
      await expect(service.getCommitDiff(SUB, 'acme', 'widgets', 'missing-sha')).resolves.toBeNull();
    });

    it('returns null (never throws) when no installation token is available', async () => {
      mockGithubApp.mintInstallationToken.mockResolvedValue(null);
      await expect(service.getCommitDiff(SUB, 'acme', 'widgets', 'abc123')).resolves.toBeNull();
    });
  });
});
