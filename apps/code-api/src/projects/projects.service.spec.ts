import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { SessionsService } from '@/sessions/sessions.service';
import { GithubService } from '@/github/github.service';
import { RepoImportService } from './repo-import.service';

const mockDb = {
  putProject: jest.fn(),
  getProject: jest.fn(),
  listProjects: jest.fn(),
  updateSessionMeta: jest.fn(),
};

const mockSessions = {
  createProjectSession: jest.fn(),
  createImportedProjectSession: jest.fn(),
};

const mockGithub = {
  getRepoSeed: jest.fn(),
};

// Defaults to null (no import) so every existing test below — which only
// exercises the synthesized-seed fallback path — is unaffected; the
// "full-history import" describe block below overrides this per-test.
const mockRepoImport = {
  buildImportedNodes: jest.fn(),
};

const SUB = 'user-sub-123';

const mockDto = {
  name: 'Widget Service',
  repoRef: {
    provider: 'github-mock' as const,
    owner: 'acme',
    repo: 'widgets',
    defaultBranch: 'main',
    url: 'https://mock.git/acme/widgets',
  },
  plugins: ['mem-palace'],
};

const githubDto = {
  ...mockDto,
  repoRef: { ...mockDto.repoRef, provider: 'github' as const },
};

describe('ProjectsService', () => {
  let service: ProjectsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRepoImport.buildImportedNodes.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: DynamoRepository, useValue: mockDb },
        { provide: SessionsService, useValue: mockSessions },
        { provide: GithubService, useValue: mockGithub },
        { provide: RepoImportService, useValue: mockRepoImport },
      ],
    }).compile();
    service = module.get<ProjectsService>(ProjectsService);
  });

  describe('create — mock provider', () => {
    it('synthesizes an unimported seed and never calls GitHub', async () => {
      mockSessions.createProjectSession.mockResolvedValue('sess-1');
      mockDb.putProject.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);

      const result = await service.create(SUB, mockDto);

      expect(mockGithub.getRepoSeed).not.toHaveBeenCalled();
      expect(mockSessions.createProjectSession).toHaveBeenCalledWith(SUB, mockDto.name, {
        defaultBranch: 'main',
        first: null,
        head: null,
        imported: false,
      }, undefined);
      expect(mockDb.putProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: mockDto.name, sessionId: 'sess-1', plugins: mockDto.plugins, repoRef: mockDto.repoRef }),
      );
      expect(result.sessionId).toBe('sess-1');
      expect(result.projectId).toBeDefined();
      expect(result.branchCount).toBe(1); // synthesized seed — only the default branch
    });

    it('links the new session back to the project via projectId', async () => {
      mockSessions.createProjectSession.mockResolvedValue('sess-1');
      mockDb.putProject.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);

      const result = await service.create(SUB, mockDto);

      expect(mockDb.updateSessionMeta).toHaveBeenCalledWith(SUB, 'sess-1', { projectId: result.projectId });
    });
  });

  describe('create — github provider', () => {
    it('fetches a real seed and marks it imported', async () => {
      mockGithub.getRepoSeed.mockResolvedValue({
        defaultBranch: 'main',
        first: { sha: 'first-sha', message: 'Initial commit', date: '2026-01-01T00:00:00Z' },
        head: { sha: 'head-sha', message: 'Latest work', date: '2026-02-01T00:00:00Z' },
      });
      mockSessions.createProjectSession.mockResolvedValue('sess-1');
      mockDb.putProject.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);

      await service.create(SUB, githubDto);

      expect(mockGithub.getRepoSeed).toHaveBeenCalledWith(SUB, 'acme', 'widgets', 'main');
      expect(mockSessions.createProjectSession).toHaveBeenCalledWith(SUB, githubDto.name, {
        defaultBranch: 'main',
        first: { sha: 'first-sha', message: 'Initial commit', date: '2026-01-01T00:00:00Z' },
        head: { sha: 'head-sha', message: 'Latest work', date: '2026-02-01T00:00:00Z' },
        imported: true,
      }, undefined);
    });

    it('degrades to a synthesized seed (never fails project creation) when the GitHub fetch throws', async () => {
      mockGithub.getRepoSeed.mockRejectedValue(new Error('rate limited'));
      mockSessions.createProjectSession.mockResolvedValue('sess-1');
      mockDb.putProject.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);

      const result = await service.create(SUB, githubDto);

      expect(mockSessions.createProjectSession).toHaveBeenCalledWith(SUB, githubDto.name, {
        defaultBranch: 'main',
        first: null,
        head: null,
        imported: false,
      }, undefined);
      expect(result.sessionId).toBe('sess-1');
    });

    it('an empty repo (nulls from getRepoSeed) still marks the seed imported — createProjectSession decides the synthesized fallback', async () => {
      mockGithub.getRepoSeed.mockResolvedValue({ defaultBranch: 'main', first: null, head: null });
      mockSessions.createProjectSession.mockResolvedValue('sess-1');
      mockDb.putProject.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);

      await service.create(SUB, githubDto);

      expect(mockSessions.createProjectSession).toHaveBeenCalledWith(SUB, githubDto.name, {
        defaultBranch: 'main',
        first: null,
        head: null,
        imported: true,
      }, undefined);
    });
  });

  describe('create — github provider, full-history import', () => {
    const importedNodes = [
      { PK: 'SESSION#sess-imported', SK: 'NODE#n1', nodeId: 'n1', parentId: null, kind: 'CODE', title: 'Initial commit' },
      { PK: 'SESSION#sess-imported', SK: 'NODE#n2', nodeId: 'n2', parentId: 'n1', kind: 'CODE', title: 'Add feature' },
    ] as unknown as Parameters<typeof mockSessions.createImportedProjectSession>[3];

    it('uses the imported nodes and skips getRepoSeed entirely when the import succeeds', async () => {
      mockRepoImport.buildImportedNodes.mockResolvedValue(importedNodes);
      mockSessions.createImportedProjectSession.mockResolvedValue('sess-imported');
      mockDb.putProject.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);

      const result = await service.create(SUB, githubDto);

      expect(mockRepoImport.buildImportedNodes).toHaveBeenCalledWith(SUB, githubDto.repoRef, expect.any(String));
      expect(mockGithub.getRepoSeed).not.toHaveBeenCalled();
      expect(mockSessions.createProjectSession).not.toHaveBeenCalled();
      expect(mockSessions.createImportedProjectSession).toHaveBeenCalledWith(SUB, githubDto.name, expect.any(String), importedNodes);
      expect(result.sessionId).toBe('sess-imported');
      expect(result.branchCount).toBe(1); // both imported nodes carry no branchName in this fixture
    });

    it('counts distinct branchName values across the imported nodes for branchCount', async () => {
      const multiBranchNodes = [
        { ...importedNodes[0], branchName: 'main' },
        { ...importedNodes[1], branchName: 'main' },
        { PK: 'SESSION#sess-imported', SK: 'NODE#n3', nodeId: 'n3', parentId: 'n1', kind: 'BRANCH', title: 'Fork from n1', branchName: 'feature' },
      ] as unknown as Parameters<typeof mockSessions.createImportedProjectSession>[3];
      mockRepoImport.buildImportedNodes.mockResolvedValue(multiBranchNodes);
      mockSessions.createImportedProjectSession.mockResolvedValue('sess-imported');
      mockDb.putProject.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);

      const result = await service.create(SUB, githubDto);

      expect(result.branchCount).toBe(2); // 'main' + 'feature'
    });

    it('falls back to the synthesized 2-node seed when the import returns null', async () => {
      mockRepoImport.buildImportedNodes.mockResolvedValue(null);
      mockGithub.getRepoSeed.mockResolvedValue({
        defaultBranch: 'main',
        first: { sha: 'first-sha', message: 'Initial commit', date: '2026-01-01T00:00:00Z' },
        head: { sha: 'head-sha', message: 'Latest work', date: '2026-02-01T00:00:00Z' },
      });
      mockSessions.createProjectSession.mockResolvedValue('sess-1');
      mockDb.putProject.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);

      const result = await service.create(SUB, githubDto);

      expect(mockGithub.getRepoSeed).toHaveBeenCalledWith(SUB, 'acme', 'widgets', 'main');
      expect(mockSessions.createImportedProjectSession).not.toHaveBeenCalled();
      expect(result.sessionId).toBe('sess-1');
    });
  });

  describe('create — github provider with rootQuery (ADR-0007 create-repo flow)', () => {
    it('skips full-history import entirely and forwards rootQuery through to createProjectSession, same as provider "new"', async () => {
      mockGithub.getRepoSeed.mockResolvedValue({ defaultBranch: 'main', first: null, head: null });
      mockSessions.createProjectSession.mockResolvedValue('sess-1');
      mockDb.putProject.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);

      const dto = { ...githubDto, rootQuery: 'A blog engine with markdown posts.' };
      await service.create(SUB, dto);

      expect(mockRepoImport.buildImportedNodes).not.toHaveBeenCalled();
      expect(mockSessions.createImportedProjectSession).not.toHaveBeenCalled();
      expect(mockSessions.createProjectSession).toHaveBeenCalledWith(SUB, dto.name, {
        defaultBranch: 'main',
        first: null,
        head: null,
        imported: true,
      }, dto.rootQuery);
    });
  });

  describe('create — new (from-scratch) provider', () => {
    const newDto = {
      name: 'Widget Service',
      repoRef: { provider: 'new' as const, owner: 'you', repo: 'widget-service', defaultBranch: 'main', url: 'mock://new/widget-service' },
      plugins: [] as string[],
      rootQuery: 'A billing dashboard with Stripe subscriptions.',
    };

    it('never calls GitHub and forwards rootQuery through to createProjectSession', async () => {
      mockSessions.createProjectSession.mockResolvedValue('sess-1');
      mockDb.putProject.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);

      await service.create(SUB, newDto);

      expect(mockGithub.getRepoSeed).not.toHaveBeenCalled();
      expect(mockSessions.createProjectSession).toHaveBeenCalledWith(SUB, newDto.name, {
        defaultBranch: 'main',
        first: null,
        head: null,
        imported: false,
      }, newDto.rootQuery);
    });

    it('forwards rootQuery unconditionally now — buildSession no longer gates the fallback pass-through on provider === "new"', async () => {
      mockSessions.createProjectSession.mockResolvedValue('sess-1');
      mockDb.putProject.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);

      await service.create(SUB, { ...mockDto, rootQuery: 'A mock-provider rootQuery' });

      const [, , , rootQueryArg] = mockSessions.createProjectSession.mock.calls[0];
      expect(rootQueryArg).toBe('A mock-provider rootQuery');
    });
  });

  describe('list', () => {
    it('returns projects from the repository', async () => {
      mockDb.listProjects.mockResolvedValue([{ projectId: 'p1' }]);
      const result = await service.list(SUB);
      expect(result).toHaveLength(1);
    });
  });

  describe('getOne', () => {
    it('returns the project when found', async () => {
      mockDb.getProject.mockResolvedValue({ projectId: 'p1' });
      const result = await service.getOne(SUB, 'p1');
      expect(result.projectId).toBe('p1');
    });

    it('throws NotFoundException when missing', async () => {
      mockDb.getProject.mockResolvedValue(null);
      await expect(service.getOne(SUB, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
