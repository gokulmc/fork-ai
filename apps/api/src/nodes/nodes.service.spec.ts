import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NodesService } from './nodes.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { LlmService } from '@/llm/llm.service';
import { SessionsService } from '@/sessions/sessions.service';

const mockDb = {
  put: jest.fn(),
  get: jest.fn(),
  query: jest.fn(),
  update: jest.fn(),
  batchDelete: jest.fn(),
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
};

const parentNode = {
  PK: `SESSION#${SESSION_ID}`,
  SK: `NODE#${PARENT_NODE_ID}`,
  nodeId: PARENT_NODE_ID,
  query: 'Root query',
  kind: 'QUERY',
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
      mockSessions.getSession.mockResolvedValue({ sessionId: SESSION_ID });
      mockDb.get.mockResolvedValue(parentNode);
      mockLlm.expandSection.mockResolvedValue(llmResult);
      mockDb.put.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('calls expandSection with parent query + section context', async () => {
      await service.createNode(SUB, SESSION_ID, dto);
      expect(mockLlm.expandSection).toHaveBeenCalledWith('Root query', 'Chain Rule', 'The chain rule is...');
    });

    it('persists node and updates session metadata', async () => {
      await service.createNode(SUB, SESSION_ID, dto);
      expect(mockDb.put).toHaveBeenCalledTimes(1);
      expect(mockSessions.touchUpdatedAt).toHaveBeenCalledWith(SUB, SESSION_ID);
      expect(mockSessions.incrementNodeCount).toHaveBeenCalledWith(SUB, SESSION_ID, 1);
    });

    it('returns node with correct fields', async () => {
      const node = await service.createNode(SUB, SESSION_ID, dto);
      expect(node['kind']).toBe('DEEPER');
      expect(node['parentId']).toBe(PARENT_NODE_ID);
      expect(node['title']).toBe('Deep Dive');
      expect(Array.isArray(node['sections'])).toBe(true);
      expect((node['sections'] as Array<{ id: string }>)[0].id).toBeDefined();
    });

    it('throws BadRequestException when sectionBody is missing', async () => {
      await expect(
        service.createNode(SUB, SESSION_ID, { ...dto, sectionBody: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when parent node does not exist', async () => {
      mockDb.get.mockResolvedValue(null);
      await expect(service.createNode(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(NotFoundException);
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
      mockSessions.getSession.mockResolvedValue({ sessionId: SESSION_ID });
      mockDb.get.mockResolvedValue(parentNode);
      mockLlm.followUpFromHighlight.mockResolvedValue(llmResult);
      mockDb.put.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('calls followUpFromHighlight with parent query + highlight + question', async () => {
      await service.createNode(SUB, SESSION_ID, dto);
      expect(mockLlm.followUpFromHighlight).toHaveBeenCalledWith(
        'Root query',
        'gradient descent',
        'Why does this work?',
      );
    });

    it('sets fromText to the highlight text', async () => {
      const node = await service.createNode(SUB, SESSION_ID, dto);
      expect(node['fromText']).toBe('gradient descent');
    });

    it('throws BadRequestException when highlightText is missing', async () => {
      await expect(
        service.createNode(SUB, SESSION_ID, { ...dto, highlightText: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('renameNode', () => {
    it('updates the title field', async () => {
      mockSessions.getSession.mockResolvedValue({});
      mockDb.get.mockResolvedValue({ nodeId: 'n1', title: 'Old title' });
      mockDb.update.mockResolvedValue(undefined);
      await service.renameNode(SUB, SESSION_ID, 'n1', { title: 'New title' });
      expect(mockDb.update).toHaveBeenCalledWith(
        `SESSION#${SESSION_ID}`,
        'NODE#n1',
        { title: 'New title' },
      );
    });

    it('throws NotFoundException when node does not exist', async () => {
      mockSessions.getSession.mockResolvedValue({});
      mockDb.get.mockResolvedValue(null);
      await expect(service.renameNode(SUB, SESSION_ID, 'n1', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteBranch', () => {
    it('throws NotFoundException when node not in session', async () => {
      mockSessions.getSession.mockResolvedValue({});
      mockDb.query.mockResolvedValue([]);
      await expect(service.deleteBranch(SUB, SESSION_ID, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes a single node with no children', async () => {
      mockSessions.getSession.mockResolvedValue({});
      mockDb.query
        .mockResolvedValueOnce([{ nodeId: 'n1', parentId: null, SK: 'NODE#n1' }]) // first query for all nodes
        .mockResolvedValueOnce([]); // second query for ANN# / HL# items
      mockDb.batchDelete.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);

      await service.deleteBranch(SUB, SESSION_ID, 'n1');
      const keys = mockDb.batchDelete.mock.calls[0][0];
      expect(keys).toHaveLength(1);
      expect(keys[0].sk).toBe('NODE#n1');
      expect(mockSessions.incrementNodeCount).toHaveBeenCalledWith(SUB, SESSION_ID, -1);
    });

    it('collects entire subtree via BFS and deletes all', async () => {
      mockSessions.getSession.mockResolvedValue({});

      // Tree: n1 → n2, n3; n2 → n4
      const nodes = [
        { nodeId: 'n1', parentId: null, SK: 'NODE#n1' },
        { nodeId: 'n2', parentId: 'n1', SK: 'NODE#n2' },
        { nodeId: 'n3', parentId: 'n1', SK: 'NODE#n3' },
        { nodeId: 'n4', parentId: 'n2', SK: 'NODE#n4' },
      ];
      mockDb.query
        .mockResolvedValueOnce(nodes)
        .mockResolvedValueOnce([]); // no ANN/HL items
      mockDb.batchDelete.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);

      await service.deleteBranch(SUB, SESSION_ID, 'n1');
      const keys = mockDb.batchDelete.mock.calls[0][0];
      expect(keys).toHaveLength(4);
      expect(mockSessions.incrementNodeCount).toHaveBeenCalledWith(SUB, SESSION_ID, -4);
    });

    it('also collects ANN# and HL# items for deleted nodes', async () => {
      mockSessions.getSession.mockResolvedValue({});
      mockDb.query
        .mockResolvedValueOnce([{ nodeId: 'n1', parentId: null, SK: 'NODE#n1' }])
        .mockResolvedValueOnce([
          { PK: `SESSION#${SESSION_ID}`, SK: 'ANN#a1', nodeId: 'n1' },
          { PK: `SESSION#${SESSION_ID}`, SK: 'HL#h1', nodeId: 'n1' },
          { PK: `SESSION#${SESSION_ID}`, SK: 'ANN#a2', nodeId: 'other-node' }, // should NOT be deleted
        ]);
      mockDb.batchDelete.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);

      await service.deleteBranch(SUB, SESSION_ID, 'n1');
      const keys = mockDb.batchDelete.mock.calls[0][0];
      // 1 node + 2 associated items (ANN#a1 and HL#h1); 'other-node' annotation excluded
      expect(keys).toHaveLength(3);
    });
  });
});
