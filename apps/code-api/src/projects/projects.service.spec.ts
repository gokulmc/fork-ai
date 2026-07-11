import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { SessionsService } from '@/sessions/sessions.service';

const mockDb = {
  putProject: jest.fn(),
  getProject: jest.fn(),
  listProjects: jest.fn(),
  updateSessionMeta: jest.fn(),
};

const mockSessions = {
  createEmpty: jest.fn(),
};

const SUB = 'user-sub-123';

const dto = {
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

describe('ProjectsService', () => {
  let service: ProjectsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: DynamoRepository, useValue: mockDb },
        { provide: SessionsService, useValue: mockSessions },
      ],
    }).compile();
    service = module.get<ProjectsService>(ProjectsService);
  });

  describe('create', () => {
    it('creates an empty session first, then the project pointing at it', async () => {
      mockSessions.createEmpty.mockResolvedValue('sess-1');
      mockDb.putProject.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);

      const result = await service.create(SUB, dto);

      expect(mockSessions.createEmpty).toHaveBeenCalledWith(SUB, dto.name);
      expect(mockDb.putProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: dto.name, sessionId: 'sess-1', plugins: dto.plugins, repoRef: dto.repoRef }),
      );
      expect(result.sessionId).toBe('sess-1');
      expect(result.projectId).toBeDefined();
    });

    it('links the new session back to the project via projectId', async () => {
      mockSessions.createEmpty.mockResolvedValue('sess-1');
      mockDb.putProject.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);

      const result = await service.create(SUB, dto);

      expect(mockDb.updateSessionMeta).toHaveBeenCalledWith(SUB, 'sess-1', { projectId: result.projectId });
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
