import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NodesService } from './nodes.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { LlmService } from '@/llm/llm.service';
import { BRANCH_DEFAULT_MODEL } from '@/llm/models';
import { SessionsService } from '@/sessions/sessions.service';
import { UsersService } from '@/users/users.service';

const mockDb = {
  putNode: jest.fn(),
  getNode: jest.fn(),
  queryNodes: jest.fn(),
  updateNode: jest.fn(),
  batchDeleteNodes: jest.fn(),
  queryAnnotations: jest.fn(),
  batchDeleteAnnotations: jest.fn(),
  queryHighlights: jest.fn(),
  batchDeleteHighlights: jest.fn(),
  updateSessionMeta: jest.fn(),
};

const mockLlm = {
  expandSection: jest.fn(),
  followUpFromHighlight: jest.fn(),
};

const mockSessions = {
  getSession: jest.fn(),
  touchUpdatedAt: jest.fn(),
  incrementNodeCount: jest.fn(),
};

const mockUsers = {
  checkCredit: jest.fn(),
  billUsage: jest.fn(),
};

const SUB = 'user-sub-123';
const SESSION_ID = '01HZSESS';
const PARENT_NODE_ID = '01HZPARENT';

const llmResult = {
  title: 'Deep Dive',
  emoji: '🔬',
  lede: 'Going deeper.',
  sections: [
    { heading: 'Part 1', body: 'Part 1 body.' },
    { heading: 'Part 2', body: 'Part 2 body.' },
  ],
  usage: { inputTokens: 100, outputTokens: 200 },
};

const parentNode = {
  nodeId: PARENT_NODE_ID,
  parentId: null,
  query: 'Root query',
  title: 'Root Title',
  kind: 'QUERY',
};

// getSession now returns a FullSession shape — nodes array is what createNode uses
const fullSession = {
  sessionId: SESSION_ID,
  nodes: [parentNode],
  annotations: [],
  highlights: [],
};

describe('NodesService', () => {
  let service: NodesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodesService,
        { provide: DynamoRepository, useValue: mockDb },
        { provide: LlmService, useValue: mockLlm },
        { provide: SessionsService, useValue: mockSessions },
        { provide: UsersService, useValue: mockUsers },
      ],
    }).compile();
    service = module.get<NodesService>(NodesService);
  });

  describe('createNode — DEEPER kind', () => {
    const dto = {
      kind: 'DEEPER' as const,
      parentNodeId: PARENT_NODE_ID,
      fromSection: 'sec-1',
      query: 'Chain Rule',
      sectionBody: 'The chain rule is...',
    };

    beforeEach(() => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      mockLlm.expandSection.mockResolvedValue(llmResult);
      mockDb.putNode.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('calls expandSection with ancestor trail + section context', async () => {
      await service.createNode(SUB, SESSION_ID, dto);
      expect(mockLlm.expandSection).toHaveBeenCalledWith(
        [{ title: 'Root Title', query: 'Root query' }],
        'Chain Rule',
        'The chain rule is...',
        4,
        false,
        BRANCH_DEFAULT_MODEL,
        false,
      );
    });

    it('forwards verbose=true to expandSection', async () => {
      await service.createNode(SUB, SESSION_ID, { ...dto, verbose: true });
      expect(mockLlm.expandSection).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        true,
      );
    });

    it('persists node and updates session metadata', async () => {
      await service.createNode(SUB, SESSION_ID, dto);
      expect(mockDb.putNode).toHaveBeenCalledTimes(1);
      expect(mockSessions.touchUpdatedAt).toHaveBeenCalledWith(SUB, SESSION_ID);
      expect(mockSessions.incrementNodeCount).toHaveBeenCalledWith(SUB, SESSION_ID, 1);
    });

    it('returns node with correct fields', async () => {
      const result = await service.createNode(SUB, SESSION_ID, dto);
      expect(result.kind).toBe('DEEPER');
      expect(result.parentId).toBe(PARENT_NODE_ID);
      expect(result.title).toBe('Deep Dive');
      expect(Array.isArray(result.sections)).toBe(true);
      expect((result.sections as Array<{ id: string }>)[0].id).toBeDefined();
    });

    it('throws BadRequestException when sectionBody is missing', async () => {
      await expect(
        service.createNode(SUB, SESSION_ID, { ...dto, sectionBody: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when parent node does not exist', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [] });
      await expect(service.createNode(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('stores sources on node when LLM returns them', async () => {
      mockLlm.expandSection.mockResolvedValue({
        ...llmResult,
        sources: [{ title: 'Ref', url: 'https://ref.com' }],
      });
      const result = await service.createNode(SUB, SESSION_ID, dto);
      expect(result.sources).toHaveLength(1);
      expect(result.sources![0].url).toBe('https://ref.com');
    });
  });

  describe('createNode — ASK kind', () => {
    const dto = {
      kind: 'ASK' as const,
      parentNodeId: PARENT_NODE_ID,
      fromSection: 'sec-1',
      query: 'Why does this work?',
      highlightText: 'gradient descent',
    };

    beforeEach(() => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      mockLlm.followUpFromHighlight.mockResolvedValue(llmResult);
      mockDb.putNode.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('calls followUpFromHighlight with ancestor trail + highlight + question', async () => {
      await service.createNode(SUB, SESSION_ID, dto);
      expect(mockLlm.followUpFromHighlight).toHaveBeenCalledWith(
        [{ title: 'Root Title', query: 'Root query' }],
        'gradient descent',
        'Why does this work?',
        4,
        false,
        BRANCH_DEFAULT_MODEL,
        false,
      );
    });

    it('sets fromText to the highlight text', async () => {
      const result = await service.createNode(SUB, SESSION_ID, dto);
      expect(result.fromText).toBe('gradient descent');
    });

    it('throws BadRequestException when highlightText is missing', async () => {
      await expect(
        service.createNode(SUB, SESSION_ID, { ...dto, highlightText: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('renameNode', () => {
    it('updates the title field', async () => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      mockDb.getNode.mockResolvedValue({ nodeId: 'n1', title: 'Old' });
      mockDb.updateNode.mockResolvedValue(undefined);
      await service.renameNode(SUB, SESSION_ID, 'n1', { title: 'New title' });
      expect(mockDb.updateNode).toHaveBeenCalledWith(SESSION_ID, 'n1', { title: 'New title' });
    });

    it('throws NotFoundException when node does not exist', async () => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      mockDb.getNode.mockResolvedValue(null);
      await expect(service.renameNode(SUB, SESSION_ID, 'n1', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteBranch', () => {
    beforeEach(() => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      mockDb.queryAnnotations.mockResolvedValue([]);
      mockDb.queryHighlights.mockResolvedValue([]);
      mockDb.batchDeleteNodes.mockResolvedValue(undefined);
      mockDb.batchDeleteAnnotations.mockResolvedValue(undefined);
      mockDb.batchDeleteHighlights.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('throws NotFoundException when node not in session', async () => {
      mockDb.queryNodes.mockResolvedValue([]);
      await expect(service.deleteBranch(SUB, SESSION_ID, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes a single node with no children', async () => {
      mockDb.queryNodes.mockResolvedValue([{ nodeId: 'n1', parentId: null }]);
      await service.deleteBranch(SUB, SESSION_ID, 'n1');
      expect(mockDb.batchDeleteNodes).toHaveBeenCalledWith(SESSION_ID, ['n1']);
      expect(mockSessions.incrementNodeCount).toHaveBeenCalledWith(SUB, SESSION_ID, -1);
    });

    it('collects entire subtree via BFS and deletes all', async () => {
      mockDb.queryNodes.mockResolvedValue([
        { nodeId: 'n1', parentId: null },
        { nodeId: 'n2', parentId: 'n1' },
        { nodeId: 'n3', parentId: 'n1' },
        { nodeId: 'n4', parentId: 'n2' },
      ]);
      await service.deleteBranch(SUB, SESSION_ID, 'n1');
      const [, deletedIds] = mockDb.batchDeleteNodes.mock.calls[0];
      expect(deletedIds).toHaveLength(4);
      expect(mockSessions.incrementNodeCount).toHaveBeenCalledWith(SUB, SESSION_ID, -4);
    });

    it('also deletes associated annotations and highlights', async () => {
      mockDb.queryNodes.mockResolvedValue([{ nodeId: 'n1', parentId: null }]);
      mockDb.queryAnnotations.mockResolvedValue([
        { annId: 'a1', nodeId: 'n1' },
        { annId: 'a2', nodeId: 'other' },
      ]);
      mockDb.queryHighlights.mockResolvedValue([
        { hlId: 'h1', nodeId: 'n1' },
      ]);
      await service.deleteBranch(SUB, SESSION_ID, 'n1');
      expect(mockDb.batchDeleteAnnotations).toHaveBeenCalledWith(SESSION_ID, ['a1']);
      expect(mockDb.batchDeleteHighlights).toHaveBeenCalledWith(SESSION_ID, ['h1']);
    });
  });
});
