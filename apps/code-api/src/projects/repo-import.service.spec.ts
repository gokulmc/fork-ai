import { Test, TestingModule } from '@nestjs/testing';
import { RepoImportService } from './repo-import.service';
import { GithubService } from '@/github/github.service';
import type { RepoRef } from '@/dynamo/dynamo.interfaces';

const mockGithub = {
  listCommits: jest.fn(),
  listBranches: jest.fn(),
  compareCommits: jest.fn(),
  getCommitDiff: jest.fn(),
};

const SUB = 'user-sub-123';
const SESSION_ID = 'sess-1';

const REPO_REF: RepoRef = {
  provider: 'github',
  owner: 'acme',
  repo: 'widgets',
  defaultBranch: 'main',
  url: 'https://github.com/acme/widgets',
};

function commit(sha: string, message: string, date: string) {
  return { sha, message, date, parents: [] as string[] };
}

// Builds `count` commits with distinct, ascending dates starting at `startIso`
// (one day apart) and shas `${prefix}-0` (oldest) .. `${prefix}-{count-1}`
// (newest). Returned newest-first, matching GithubService.listCommits' contract.
function makeCommitsNewestFirst(prefix: string, count: number, startIso = '2026-01-01T00:00:00.000Z') {
  const start = Date.parse(startIso);
  const oldestFirst = Array.from({ length: count }, (_, i) =>
    commit(`${prefix}-${i}`, `${prefix} commit ${i}`, new Date(start + i * 86_400_000).toISOString()),
  );
  return [...oldestFirst].reverse();
}

describe('RepoImportService', () => {
  let service: RepoImportService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGithub.listBranches.mockResolvedValue([]); // most tests don't care about branches
    mockGithub.getCommitDiff.mockResolvedValue(null); // most tests don't care about §2c diff enrichment
    const module: TestingModule = await Test.createTestingModule({
      providers: [RepoImportService, { provide: GithubService, useValue: mockGithub }],
    }).compile();
    service = module.get<RepoImportService>(RepoImportService);
  });

  describe('trunk-only import', () => {
    it('builds an oldest→newest CODE chain with correct parentIds', async () => {
      mockGithub.listCommits.mockResolvedValue(makeCommitsNewestFirst('c', 3));

      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);

      expect(nodes).not.toBeNull();
      expect(nodes).toHaveLength(3);
      const [n0, n1, n2] = nodes!;
      expect(n0.commitSha).toBe('c-0');
      expect(n0.parentId).toBeNull();
      expect(n0.kind).toBe('CODE');
      expect(n0.imported).toBe(true);
      expect(n0.branchName).toBe('main');

      expect(n1.commitSha).toBe('c-1');
      expect(n1.parentId).toBe(n0.nodeId);

      expect(n2.commitSha).toBe('c-2');
      expect(n2.parentId).toBe(n1.nodeId);

      nodes!.forEach((n) => {
        expect(n.PK).toBe(`SESSION#${SESSION_ID}`);
        expect(n.SK).toBe(`NODE#${n.nodeId}`);
      });
    });

    it('nudges createdAt forward by 1ms when two commits share the same date', async () => {
      mockGithub.listCommits.mockResolvedValue([
        commit('c-1', 'second', '2026-01-01T00:00:00.000Z'),
        commit('c-0', 'first', '2026-01-01T00:00:00.000Z'),
      ]);

      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);

      const [n0, n1] = nodes!;
      expect(n0.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(Date.parse(n1.createdAt)).toBe(Date.parse(n0.createdAt) + 1);
    });

    it('prefixes the root title and keeps only the newest TRUNK_CAP (500) commits when history is longer', async () => {
      // TRUNK_CAP is 500 — listCommits itself enforces the cap server-side, so
      // the mock returns exactly 500 (simulating "there was more, but this is
      // what the cap gave us").
      mockGithub.listCommits.mockResolvedValue(makeCommitsNewestFirst('c', 500));

      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);

      expect(nodes).toHaveLength(500);
      const root = nodes![0];
      expect(root.commitSha).toBe('c-0'); // oldest of the retained 500 (not the repo's true first commit)
      expect(root.title).toMatch(/^⋯ earlier history on GitHub · /);
      expect(nodes![499].commitSha).toBe('c-499'); // newest — the branch's real HEAD
    });

    it('does not prefix the title when history fits under the cap', async () => {
      mockGithub.listCommits.mockResolvedValue(makeCommitsNewestFirst('c', 3));
      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);
      expect(nodes![0].title).not.toMatch(/earlier history/);
    });
  });

  describe('branches', () => {
    it('attaches a BRANCH node at the merge-base commit and chains the branch commits under it', async () => {
      mockGithub.listCommits.mockResolvedValue(makeCommitsNewestFirst('c', 3)); // c-0 (root) .. c-2 (head)
      mockGithub.listBranches.mockResolvedValue([{ name: 'feature', headSha: 'branch-head' }]);
      mockGithub.compareCommits.mockResolvedValue({
        mergeBaseSha: 'c-1',
        commits: [commit('f-0', 'branch work 1', '2026-02-01T00:00:00.000Z'), commit('f-1', 'branch work 2', '2026-02-02T00:00:00.000Z')],
      });

      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);

      expect(nodes).toHaveLength(6); // 3 trunk + 1 BRANCH + 2 branch commits
      const mergeBaseNode = nodes!.find((n) => n.commitSha === 'c-1' && n.kind === 'CODE')!;
      const branchNode = nodes!.find((n) => n.kind === 'BRANCH')!;
      expect(branchNode.parentId).toBe(mergeBaseNode.nodeId);
      expect(branchNode.commitSha).toBe('c-1');
      expect(branchNode.branchName).toBe('feature');
      expect(branchNode.title).toBe('Fork from c-1');

      const f0 = nodes!.find((n) => n.commitSha === 'f-0')!;
      const f1 = nodes!.find((n) => n.commitSha === 'f-1')!;
      expect(f0.parentId).toBe(branchNode.nodeId);
      expect(f0.branchName).toBe('feature');
      expect(f1.parentId).toBe(f0.nodeId);
    });

    it('skips a branch whose merge-base commit was cut off by the trunk cap', async () => {
      mockGithub.listCommits.mockResolvedValue(makeCommitsNewestFirst('c', 3));
      mockGithub.listBranches.mockResolvedValue([{ name: 'feature', headSha: 'branch-head' }]);
      mockGithub.compareCommits.mockResolvedValue({
        mergeBaseSha: 'not-in-trunk',
        commits: [commit('f-0', 'branch work', '2026-02-01T00:00:00.000Z')],
      });

      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);

      expect(nodes).toHaveLength(3); // trunk only — the branch never attached
      expect(nodes!.some((n) => n.kind === 'BRANCH')).toBe(false);
    });

    it('skips a branch whose compareCommits call throws, without failing the whole import', async () => {
      mockGithub.listCommits.mockResolvedValue(makeCommitsNewestFirst('c', 3));
      mockGithub.listBranches.mockResolvedValue([{ name: 'feature', headSha: 'branch-head' }]);
      mockGithub.compareCommits.mockRejectedValue(new Error('rate limited'));

      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);

      expect(nodes).toHaveLength(3);
    });

    it('respects TOTAL_CAP (1000) across trunk + branches, stopping mid-branch if needed', async () => {
      mockGithub.listCommits.mockResolvedValue(makeCommitsNewestFirst('c', 500)); // TRUNK_CAP
      // 20 branches (BRANCH_COUNT_CAP) each forking off the same trunk commit
      // and carrying 50 commits (BRANCH_CAP) — 500 + 20*(1+50) = 1520 uncapped.
      mockGithub.listBranches.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({ name: `feature-${i}`, headSha: `head-${i}` })),
      );
      mockGithub.compareCommits.mockImplementation((_sub: string, _o: string, _r: string, _base: string, head: string) => {
        const idx = head; // 'feature-N'
        return Promise.resolve({
          mergeBaseSha: 'c-250',
          commits: makeCommitsNewestFirst(`${idx}`, 50).reverse(), // oldest→newest, as compareCommits returns
        });
      });

      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);

      expect(nodes!.length).toBe(1000);
    });
  });

  describe('§2c — imported-commit diff enrichment', () => {
    const DUMMY_DIFF = { filesChanged: 1, additions: 3, deletions: 1, files: [{ path: 'x.ts', status: 'modified', additions: 3, deletions: 1 }] };

    it('fetches and stores a diff for every CODE commit when under the cap', async () => {
      mockGithub.listCommits.mockResolvedValue(makeCommitsNewestFirst('c', 3));
      mockGithub.getCommitDiff.mockResolvedValue(DUMMY_DIFF);

      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);

      expect(mockGithub.getCommitDiff).toHaveBeenCalledTimes(3);
      nodes!.forEach((n) => expect(n.diffSummary).toEqual(DUMMY_DIFF));
    });

    it('caps diff fetches at DIFF_FETCH_CAP (40), preferring the newest commits, leaving older ones diff-less', async () => {
      mockGithub.listCommits.mockResolvedValue(makeCommitsNewestFirst('c', 60));
      mockGithub.getCommitDiff.mockResolvedValue(DUMMY_DIFF);

      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);

      expect(mockGithub.getCommitDiff).toHaveBeenCalledTimes(40);
      const withDiff = nodes!.filter((n) => n.diffSummary);
      const withoutDiff = nodes!.filter((n) => !n.diffSummary);
      expect(withDiff).toHaveLength(40);
      expect(withoutDiff).toHaveLength(20);
      // The 40 newest (highest-index shas) got diffs; the oldest 20 didn't.
      expect(withDiff.map((n) => n.commitSha)).toEqual(expect.arrayContaining(['c-59', 'c-20']));
      expect(withoutDiff.map((n) => n.commitSha)).toEqual(expect.arrayContaining(['c-0', 'c-19']));
    });

    it('a per-commit diff fetch failure (getCommitDiff resolves null) leaves that node diff-less without failing the import', async () => {
      mockGithub.listCommits.mockResolvedValue(makeCommitsNewestFirst('c', 3));
      mockGithub.getCommitDiff.mockResolvedValue(null);

      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);

      expect(nodes).toHaveLength(3);
      nodes!.forEach((n) => expect(n.diffSummary).toBeUndefined());
    });
  });

  describe('failure handling', () => {
    it('returns null (does not throw) when listCommits rejects', async () => {
      mockGithub.listCommits.mockRejectedValue(new Error('rate limited'));
      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);
      expect(nodes).toBeNull();
    });

    it('returns null for an empty repo (listCommits resolves [])', async () => {
      mockGithub.listCommits.mockResolvedValue([]);
      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);
      expect(nodes).toBeNull();
    });

    it('falls back to a trunk-only import when listBranches itself throws', async () => {
      mockGithub.listCommits.mockResolvedValue(makeCommitsNewestFirst('c', 3));
      mockGithub.listBranches.mockRejectedValue(new Error('rate limited'));

      const nodes = await service.buildImportedNodes(SUB, REPO_REF, SESSION_ID);

      expect(nodes).toHaveLength(3);
    });
  });
});
