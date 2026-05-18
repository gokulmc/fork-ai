import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { LlmService } from '@/llm/llm.service';

const mockDb = {
  put: jest.fn(),
  get: jest.fn(),
  query: jest.fn(),
  queryGsi: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  batchDelete: jest.fn(),
};

const mockLlm = {
  answerQuery: jest.fn(),
};

const SUB = 'user-sub-123';
const SESSION_ID = '01HZEXAMPLE';
const NOW = '2026-05-17T10:00:00.000Z';

const llmResult = {
  title: 'Neural Nets',
  emoji: '🧠',
  lede: 'How neural networks work.',
  sections: [
    { heading: 'Intro', body: 'Introduction text.' },
    { heading: 'Layers', body: 'Layer text.' },
  ],
};

const sessionMeta = {
  PK: `USER#${SUB}`,
  SK: `SESSION#${SESSION_ID}`,
  sessionId: SESSION_ID,
  title: 'Neural Nets',
  emoji: '🧠',
  lede: 'How neural networks work.',
  rootNodeId: 'root-node-id',
  nodeCount: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

describe('SessionsService', () => {
  let service: SessionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: DynamoRepository, useValue: mockDb },
        { provide: LlmService, useValue: mockLlm },
      ],
    }).compile();
    service = module.get<SessionsService>(SessionsService);
  });

  describe('create', () => {
    it('calls LLM and persists root node + session meta', async () => {
      mockLlm.answerQuery.mockResolvedValue(llmResult);
      mockDb.put.mockResolvedValue(undefined);

      const result = await service.create(SUB, { query: 'What is ML?' });

      expect(mockLlm.answerQuery).toHaveBeenCalledWith('What is ML?', 5);
      expect(mockDb.put).toHaveBeenCalledTimes(2);
      expect(result.title).toBe('Neural Nets');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]['kind']).toBe('QUERY');
    });

    it('uses custom sectionCount when provided', async () => {
      mockLlm.answerQuery.mockResolvedValue(llmResult);
      mockDb.put.mockResolvedValue(undefined);
      await service.create(SUB, { query: 'Q', sectionCount: 3 });
      expect(mockLlm.answerQuery).toHaveBeenCalledWith('Q', 3);
    });

    it('assigns section IDs via ulid', async () => {
      mockLlm.answerQuery.mockResolvedValue(llmResult);
      mockDb.put.mockResolvedValue(undefined);
      const result = await service.create(SUB, { query: 'test' });
      expect((result.nodes[0]['sections'] as Array<{ id: string }>)[0].id).toBeDefined();
    });
  });

  describe('list', () => {
    it('queries GSI and returns session summaries', async () => {
      mockDb.queryGsi.mockResolvedValue([
        { ...sessionMeta, SK: `SESSION#${SESSION_ID}` },
      ]);
      const result = await service.list(SUB);
      expect(mockDb.queryGsi).toHaveBeenCalledWith('gsi1', `USER#${SUB}`, { scanIndexForward: false });
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe(SESSION_ID);
    });

    it('filters out non-SESSION# items from GSI results', async () => {
      mockDb.queryGsi.mockResolvedValue([
        { SK: 'METADATA', sessionId: 'x' },
        { ...sessionMeta, SK: `SESSION#${SESSION_ID}` },
      ]);
      const result = await service.list(SUB);
      expect(result).toHaveLength(1);
    });
  });

  describe('getSession', () => {
    it('throws NotFoundException when session not found', async () => {
      mockDb.get.mockResolvedValue(null);
      await expect(service.getSession(SUB, SESSION_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns full session with nodes and annotations split', async () => {
      mockDb.get.mockResolvedValue(sessionMeta);
      mockDb.query.mockResolvedValue([
        { PK: `SESSION#${SESSION_ID}`, SK: 'NODE#n1', nodeId: 'n1' },
        { PK: `SESSION#${SESSION_ID}`, SK: 'ANN#a1', annId: 'a1' },
        { PK: `SESSION#${SESSION_ID}`, SK: 'HL#h1', hlId: 'h1' },
      ]);
      const result = await service.getSession(SUB, SESSION_ID);
      expect(result.nodes).toHaveLength(1);
      expect(result.annotations).toHaveLength(1);
      expect(result.highlights).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('throws when session not found', async () => {
      mockDb.get.mockResolvedValue(null);
      await expect(service.update(SUB, SESSION_ID, { title: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates title and GSI sort key', async () => {
      mockDb.get.mockResolvedValue(sessionMeta);
      mockDb.update.mockResolvedValue(undefined);
      await service.update(SUB, SESSION_ID, { title: 'Renamed' });
      const updates = mockDb.update.mock.calls[0][2];
      expect(updates.title).toBe('Renamed');
      expect(updates.gsi1sk).toMatch(/^UPDATED#/);
    });
  });

  describe('delete', () => {
    it('throws when session not found', async () => {
      mockDb.get.mockResolvedValue(null);
      await expect(service.delete(SUB, SESSION_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('batch-deletes all session items plus the meta item', async () => {
      mockDb.get.mockResolvedValue(sessionMeta);
      mockDb.query.mockResolvedValue([
        { PK: `SESSION#${SESSION_ID}`, SK: 'NODE#n1' },
        { PK: `SESSION#${SESSION_ID}`, SK: 'ANN#a1' },
      ]);
      mockDb.batchDelete.mockResolvedValue(undefined);
      await service.delete(SUB, SESSION_ID);
      const keys = mockDb.batchDelete.mock.calls[0][0];
      // 2 session items + 1 meta item
      expect(keys).toHaveLength(3);
    });
  });

  describe('touchUpdatedAt', () => {
    it('updates gsi1sk timestamp', async () => {
      mockDb.update.mockResolvedValue(undefined);
      await service.touchUpdatedAt(SUB, SESSION_ID);
      const updates = mockDb.update.mock.calls[0][2];
      expect(updates.updatedAt).toBeDefined();
      expect(updates.gsi1sk).toMatch(/^UPDATED#/);
    });
  });

  describe('incrementNodeCount', () => {
    it('increments by positive delta', async () => {
      mockDb.get.mockResolvedValue({ ...sessionMeta, nodeCount: 3 });
      mockDb.update.mockResolvedValue(undefined);
      await service.incrementNodeCount(SUB, SESSION_ID, 1);
      expect(mockDb.update.mock.calls[0][2].nodeCount).toBe(4);
    });

    it('decrements but floors at 0', async () => {
      mockDb.get.mockResolvedValue({ ...sessionMeta, nodeCount: 1 });
      mockDb.update.mockResolvedValue(undefined);
      await service.incrementNodeCount(SUB, SESSION_ID, -5);
      expect(mockDb.update.mock.calls[0][2].nodeCount).toBe(0);
    });

    it('does nothing when session meta is gone', async () => {
      mockDb.get.mockResolvedValue(null);
      await service.incrementNodeCount(SUB, SESSION_ID, 1);
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });
});
