import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { SessionsService } from '@/sessions/sessions.service';
import { GithubService } from '@/github/github.service';

const mockDb = {
  putProject: jest.fn(),
  getProject: jest.fn(),
  listProjects: jest.fn(),
  updateSessionMeta: jest.fn(),
};

const mockSessions = {
  createProjectSession: jest.fn(),
};

const mockGithub = {
  getRepoSeed: jest.fn(),
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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: DynamoRepository, useValue: mockDb },
        { provide: SessionsService, useValue: mockSessions },
        { provide: GithubService, useValue: mockGithub },
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
      });
      expect(mockDb.putProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: mockDto.name, sessionId: 'sess-1', plugins: mockDto.plugins, repoRef: mockDto.repoRef }),
      );
      expect(result.sessionId).toBe('sess-1');
      expect(result.projectId).toBeDefined();
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
      });
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
      });
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
      });
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
