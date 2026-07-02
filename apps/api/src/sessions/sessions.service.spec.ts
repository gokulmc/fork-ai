import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionsService } from './sessions.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { LlmService } from '@/llm/llm.service';
import { UsersService } from '@/users/users.service';

const mockDb = {
  putNode: jest.fn(),
  putSessionMeta: jest.fn(),
  getSessionMeta: jest.fn(),
  listSessionMeta: jest.fn(),
  updateSessionMeta: jest.fn(),
  deleteSessionMeta: jest.fn(),
  queryNodes: jest.fn(),
  queryAnnotations: jest.fn(),
  queryHighlights: jest.fn(),
  batchDeleteNodes: jest.fn(),
  batchDeleteAnnotations: jest.fn(),
  batchDeleteHighlights: jest.fn(),
  deleteShareToken: jest.fn(),
  putShareToken: jest.fn(),
};

const mockLlm = {
  answerQuery: jest.fn(),
  streamAnswerQuery: jest.fn(),
  extractDocumentOutline: jest.fn(),
  generateFromBrief: jest.fn(),
  generateShareHook: jest.fn(),
};

// Mimics LlmService.streamAnswerQuery: meta first, then sections, then done.
async function* fakeStream() {
  yield { type: 'meta', title: 'Neural Nets', emoji: '🧠', lede: 'How neural networks work.' };
  yield { type: 'section', heading: 'Intro', body: 'Introduction text.' };
  yield { type: 'section', heading: 'Layers', body: 'Layer text.' };
  yield { type: 'done', usage: { inputTokens: 100, outputTokens: 50 } };
}

const mockUsers = {
  checkCredit: jest.fn(),
  billUsage: jest.fn(),
  getPersona: jest.fn(),
};

const mockCfg = { get: jest.fn() };

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
  usage: { inputTokens: 100, outputTokens: 50 },
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
  gsi1pk: `USER#${SUB}`,
  gsi1sk: `UPDATED#${NOW}`,
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
        { provide: UsersService, useValue: mockUsers },
        { provide: ConfigService, useValue: mockCfg },
      ],
    }).compile();
    service = module.get<SessionsService>(SessionsService);
  });

  describe('create', () => {
    beforeEach(() => {
      mockDb.putNode.mockResolvedValue(undefined);
      mockDb.putSessionMeta.mockResolvedValue(undefined);
    });

    it('calls LLM and persists root node + session meta', async () => {
      mockLlm.answerQuery.mockResolvedValue(llmResult);
      const result = await service.create(SUB, { query: 'What is ML?' });
      expect(mockLlm.answerQuery).toHaveBeenCalledWith('What is ML?', 4, false);
      expect(mockDb.putNode).toHaveBeenCalledTimes(1);
      expect(mockDb.putSessionMeta).toHaveBeenCalledTimes(1);
      expect(result.title).toBe('Neural Nets');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]['kind']).toBe('QUERY');
    });

    it('uses custom sectionCount when provided', async () => {
      mockLlm.answerQuery.mockResolvedValue(llmResult);
      await service.create(SUB, { query: 'Q', sectionCount: 3 });
      expect(mockLlm.answerQuery).toHaveBeenCalledWith('Q', 3, false);
    });

    it('forwards webSearch flag to LLM and stores sources on root node', async () => {
      const llmWithSources = {
        ...llmResult,
        sources: [{ title: 'Ref', url: 'https://ref.com' }],
      };
      mockLlm.answerQuery.mockResolvedValue(llmWithSources);
      const result = await service.create(SUB, { query: 'Q', webSearch: true });
      expect(mockLlm.answerQuery).toHaveBeenCalledWith('Q', 4, true);
      expect(result.nodes[0]['sources']).toHaveLength(1);
    });

    it('assigns section IDs via ulid', async () => {
      mockLlm.answerQuery.mockResolvedValue(llmResult);
      const result = await service.create(SUB, { query: 'test' });
      expect((result.nodes[0]['sections'] as Array<{ id: string }>)[0].id).toBeDefined();
    });
  });

  describe('createStreaming', () => {
    beforeEach(() => {
      mockUsers.checkCredit.mockResolvedValue(undefined);
      mockUsers.billUsage.mockResolvedValue(undefined);
      mockDb.putNode.mockResolvedValue(undefined);
      mockDb.putSessionMeta.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
      mockLlm.streamAnswerQuery.mockReturnValue(fakeStream());
    });

    it('writes the placeholder SessionMeta up-front, before any stream event', async () => {
      const order: string[] = [];
      mockDb.putSessionMeta.mockImplementation(() => { order.push('putMeta'); return Promise.resolve(); });
      const send = (data: object) => { order.push(`send:${(data as { type: string }).type}`); };

      await service.createStreaming(SUB, { query: 'What is ML?' }, send);

      // The up-front putSessionMeta must land before the `init` event is sent.
      expect(order[0]).toBe('putMeta');
      expect(order[1]).toBe('send:init');
      const [meta] = mockDb.putSessionMeta.mock.calls[0];
      expect(meta.title).toBe('What is ML?'); // placeholder = query slice
      expect(meta.emoji).toBe('');
    });

    it('patches title/emoji/lede via updateSessionMeta at done (not a full putSessionMeta)', async () => {
      await service.createStreaming(SUB, { query: 'What is ML?' }, jest.fn());

      // Exactly one putSessionMeta (the up-front placeholder); the real values come
      // through a partial update, not a second replace.
      expect(mockDb.putSessionMeta).toHaveBeenCalledTimes(1);
      expect(mockDb.updateSessionMeta).toHaveBeenCalledTimes(1);
      const [sub, , updates] = mockDb.updateSessionMeta.mock.calls[0];
      expect(sub).toBe(SUB);
      expect(updates).toEqual({ title: 'Neural Nets', emoji: '🧠', lede: 'How neural networks work.' });
    });

    it('still persists correct title/emoji at done when the client disconnects mid-stream', async () => {
      // Simulate a closed socket: every send throws after `init`.
      const send = jest.fn((data: object) => {
        if ((data as { type: string }).type !== 'init') throw new Error('write after end');
      });

      await expect(service.createStreaming(SUB, { query: 'What is ML?' }, send)).resolves.toBeUndefined();

      // Loop ran to completion despite the throwing send.
      const [, , updates] = mockDb.updateSessionMeta.mock.calls[0];
      expect(updates).toEqual({ title: 'Neural Nets', emoji: '🧠', lede: 'How neural networks work.' });
      expect(mockUsers.billUsage).toHaveBeenCalledTimes(1);
    });
  });

  describe('createDocumentStreaming', () => {
    // Outline: root + 2 children (A, B) + 1 grandchild (A1 under A).
    const outline = {
      title: 'Quantum',
      emoji: '⚛️',
      lede: 'A document overview.',
      rootDescription: 'Whole-document brief.',
      nodes: [
        { tempId: 't1', parentTempId: null, title: 'Child A', emoji: '🅰️', description: 'A brief' },
        { tempId: 't2', parentTempId: null, title: 'Child B', emoji: '🅱️', description: 'B brief' },
        { tempId: 't3', parentTempId: 't1', title: 'Grandchild A1', emoji: '🇦', description: 'A1 brief' },
      ],
      usage: { inputTokens: 500, outputTokens: 200 },
    };

    beforeEach(() => {
      mockUsers.checkCredit.mockResolvedValue(undefined);
      mockUsers.billUsage.mockResolvedValue(undefined);
      mockUsers.getPersona.mockResolvedValue(undefined);
      mockDb.putNode.mockResolvedValue(undefined);
      mockDb.putSessionMeta.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
      mockLlm.extractDocumentOutline.mockResolvedValue(outline);
      mockLlm.generateFromBrief.mockImplementation((_ancestors: unknown, title: string) =>
        Promise.resolve({ title, emoji: '✳️', lede: `${title} lede`, sections: [{ heading: '', body: `${title} body` }], usage: { inputTokens: 10, outputTokens: 20 } }));
    });

    function run(send: (d: object) => void) {
      return service.createDocumentStreaming(SUB, { documentText: 'long document text', fileName: 'quantum.pdf' }, send);
    }

    it('persists session up-front and emits init BEFORE reading the document (persist-first)', async () => {
      const order: string[] = [];
      mockDb.putSessionMeta.mockImplementation(() => { order.push('putMeta'); return Promise.resolve(); });
      mockLlm.extractDocumentOutline.mockImplementation(() => { order.push('extract'); return Promise.resolve(outline); });
      const send = (d: object) => order.push(`send:${(d as { type: string }).type}`);

      await run(send);

      expect(order[0]).toBe('putMeta');
      expect(order[1]).toBe('send:init');
      expect(order.indexOf('send:init')).toBeLessThan(order.indexOf('extract'));
    });

    it('emits one node-done per node in root→leaf (BFS) order with correct parent wiring + kinds', async () => {
      const events: Array<{ type: string; node?: { title: string; nodeId: string; parentId: string | null; kind: string } }> = [];
      await run(d => events.push(d as never));

      const done = events.filter(e => e.type === 'node-done');
      expect(done.map(e => e.node!.title)).toEqual(['Quantum', 'Child A', 'Child B', 'Grandchild A1']);

      const byTitle = Object.fromEntries(done.map(e => [e.node!.title, e.node!]));
      expect(byTitle['Quantum'].parentId).toBeNull();
      expect(byTitle['Quantum'].kind).toBe('QUERY');
      expect(byTitle['Child A'].parentId).toBe(byTitle['Quantum'].nodeId);
      expect(byTitle['Child A'].kind).toBe('DEEPER');
      expect(byTitle['Child B'].parentId).toBe(byTitle['Quantum'].nodeId);
      expect(byTitle['Grandchild A1'].parentId).toBe(byTitle['Child A'].nodeId);
    });

    it('bills the extraction pass (root, QUERY) plus one call per generated node', async () => {
      await run(jest.fn());

      // 1 extraction + 4 nodes = 5 usage events.
      expect(mockUsers.billUsage).toHaveBeenCalledTimes(5);
      const [, inTok, outTok, kind] = mockUsers.billUsage.mock.calls[0];
      expect(inTok).toBe(500); // extraction usage
      expect(outTok).toBe(200);
      expect(kind).toBe('QUERY');
    });

    it('finishes with a done event carrying the real title and node count', async () => {
      const events: Array<{ type: string; nodeCount?: number; title?: string }> = [];
      await run(d => events.push(d as never));

      const skeleton = events.find(e => e.type === 'skeleton') as { nodes: unknown[] } | undefined;
      expect(skeleton!.nodes).toHaveLength(4);
      const done = events.find(e => e.type === 'done');
      expect(done!.nodeCount).toBe(4);
      expect(done!.title).toBe('Quantum');
    });

    it('re-parents a node with an unknown parentTempId under the root (defensive)', async () => {
      mockLlm.extractDocumentOutline.mockResolvedValue({
        ...outline,
        nodes: [{ tempId: 't1', parentTempId: 'does-not-exist', title: 'Orphan', emoji: '🛟', description: 'd' }],
      });
      const events: Array<{ type: string; node?: { nodeId: string; title: string; parentId: string | null } }> = [];
      await run(d => events.push(d as never));

      const done = events.filter(e => e.type === 'node-done');
      const root = done.find(e => e.node!.title === 'Quantum')!.node!;
      const orphan = done.find(e => e.node!.title === 'Orphan')!.node!;
      expect(orphan.parentId).toBe(root.nodeId);
    });
  });

  describe('list', () => {
    it('queries and returns session summaries with highlight counts', async () => {
      mockDb.listSessionMeta.mockResolvedValue([sessionMeta]);
      mockDb.queryHighlights.mockResolvedValue([{ hlId: 'h1' }, { hlId: 'h2' }]);
      const result = await service.list(SUB);
      expect(mockDb.listSessionMeta).toHaveBeenCalledWith(SUB);
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe(SESSION_ID);
      expect(result[0].highlightCount).toBe(2);
    });

    it('returns empty array when no sessions', async () => {
      mockDb.listSessionMeta.mockResolvedValue([]);
      const result = await service.list(SUB);
      expect(result).toHaveLength(0);
    });
  });

  describe('getSession', () => {
    it('throws NotFoundException when session not found', async () => {
      mockDb.getSessionMeta.mockResolvedValue(null);
      await expect(service.getSession(SUB, SESSION_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns full session with nodes, annotations, and highlights split', async () => {
      mockDb.getSessionMeta.mockResolvedValue(sessionMeta);
      mockDb.queryNodes.mockResolvedValue([{ nodeId: 'n1' }]);
      mockDb.queryAnnotations.mockResolvedValue([{ annId: 'a1' }]);
      mockDb.queryHighlights.mockResolvedValue([{ hlId: 'h1' }]);
      const result = await service.getSession(SUB, SESSION_ID);
      expect(result.nodes).toHaveLength(1);
      expect(result.annotations).toHaveLength(1);
      expect(result.highlights).toHaveLength(1);
      expect(result.highlightCount).toBe(1);
    });

    it('passes shareHook through toSummary', async () => {
      mockDb.getSessionMeta.mockResolvedValue({ ...sessionMeta, shareHook: 'A wild fact.' });
      mockDb.queryNodes.mockResolvedValue([]);
      mockDb.queryAnnotations.mockResolvedValue([]);
      mockDb.queryHighlights.mockResolvedValue([]);
      const result = await service.getSession(SUB, SESSION_ID);
      expect(result.shareHook).toBe('A wild fact.');
    });

    it('defaults shareHook to null when absent', async () => {
      mockDb.getSessionMeta.mockResolvedValue(sessionMeta);
      mockDb.queryNodes.mockResolvedValue([]);
      mockDb.queryAnnotations.mockResolvedValue([]);
      mockDb.queryHighlights.mockResolvedValue([]);
      const result = await service.getSession(SUB, SESSION_ID);
      expect(result.shareHook).toBeNull();
    });

    it('warns only when the loaded session crosses the multi-page size threshold', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      mockDb.getSessionMeta.mockResolvedValue(sessionMeta);
      mockDb.queryAnnotations.mockResolvedValue([]);
      mockDb.queryHighlights.mockResolvedValue([]);

      // Small session — no warning.
      mockDb.queryNodes.mockResolvedValue([{ nodeId: 'n1', sections: [{ body: 'tiny' }] }]);
      await service.getSession(SUB, SESSION_ID);
      expect(warn).not.toHaveBeenCalled();

      // ~1.2MB of node bodies — over the 800KB threshold → one warning.
      const big = { nodeId: 'big', sections: [{ body: 'x'.repeat(1_200_000) }] };
      mockDb.queryNodes.mockResolvedValue([big]);
      await service.getSession(SUB, SESSION_ID);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('Large session load');

      warn.mockRestore();
    });
  });

  describe('update', () => {
    it('throws when session not found', async () => {
      mockDb.getSessionMeta.mockResolvedValue(null);
      await expect(service.update(SUB, SESSION_ID, { title: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates title and GSI sort key', async () => {
      mockDb.getSessionMeta.mockResolvedValue(sessionMeta);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
      await service.update(SUB, SESSION_ID, { title: 'Renamed' });
      const [, , updates] = mockDb.updateSessionMeta.mock.calls[0];
      expect(updates.title).toBe('Renamed');
      expect(updates.gsi1sk).toMatch(/^UPDATED#/);
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      mockDb.queryNodes.mockResolvedValue([{ nodeId: 'n1' }]);
      mockDb.queryAnnotations.mockResolvedValue([{ annId: 'a1' }]);
      mockDb.queryHighlights.mockResolvedValue([]);
      mockDb.batchDeleteNodes.mockResolvedValue(undefined);
      mockDb.batchDeleteAnnotations.mockResolvedValue(undefined);
      mockDb.batchDeleteHighlights.mockResolvedValue(undefined);
      mockDb.deleteSessionMeta.mockResolvedValue(undefined);
    });

    it('throws when session not found', async () => {
      mockDb.getSessionMeta.mockResolvedValue(null);
      await expect(service.delete(SUB, SESSION_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes all nodes, annotations, highlights, and session meta', async () => {
      mockDb.getSessionMeta.mockResolvedValue(sessionMeta);
      await service.delete(SUB, SESSION_ID);
      expect(mockDb.batchDeleteNodes).toHaveBeenCalledWith(SESSION_ID, ['n1']);
      expect(mockDb.batchDeleteAnnotations).toHaveBeenCalledWith(SESSION_ID, ['a1']);
      expect(mockDb.deleteSessionMeta).toHaveBeenCalledWith(SUB, SESSION_ID);
    });
  });

  describe('touchUpdatedAt', () => {
    it('updates updatedAt and gsi1sk', async () => {
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
      await service.touchUpdatedAt(SUB, SESSION_ID);
      const [, , updates] = mockDb.updateSessionMeta.mock.calls[0];
      expect(updates.updatedAt).toBeDefined();
      expect(updates.gsi1sk).toMatch(/^UPDATED#/);
    });
  });

  describe('incrementNodeCount', () => {
    it('increments by positive delta', async () => {
      mockDb.getSessionMeta.mockResolvedValue({ ...sessionMeta, nodeCount: 3 });
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
      await service.incrementNodeCount(SUB, SESSION_ID, 1);
      const [, , updates] = mockDb.updateSessionMeta.mock.calls[0];
      expect(updates.nodeCount).toBe(4);
    });

    it('decrements but floors at 0', async () => {
      mockDb.getSessionMeta.mockResolvedValue({ ...sessionMeta, nodeCount: 1 });
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
      await service.incrementNodeCount(SUB, SESSION_ID, -5);
      const [, , updates] = mockDb.updateSessionMeta.mock.calls[0];
      expect(updates.nodeCount).toBe(0);
    });

    it('does nothing when session meta is gone', async () => {
      mockDb.getSessionMeta.mockResolvedValue(null);
      await service.incrementNodeCount(SUB, SESSION_ID, 1);
      expect(mockDb.updateSessionMeta).not.toHaveBeenCalled();
    });
  });

  describe('generateShareToken', () => {
    const rootNode = { nodeId: 'n1', parentId: null, title: 'Root', query: 'What is ML?', sections: [{ body: 'Some **body** text' }] };

    beforeEach(() => {
      mockDb.getSessionMeta.mockResolvedValue(sessionMeta);
      mockDb.queryNodes.mockResolvedValue([rootNode]);
      mockDb.putShareToken.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
    });

    it('persists a fresh shareHook alongside the share token', async () => {
      mockLlm.generateShareHook.mockResolvedValue('A shocking fact.');
      await service.generateShareToken(SUB, SESSION_ID);
      const [, , updates] = mockDb.updateSessionMeta.mock.calls[0];
      expect(updates.shareToken).toEqual(expect.any(String));
      expect(updates.shareHook).toBe('A shocking fact.');
    });

    it('still shares successfully when generateShareHook resolves null', async () => {
      mockLlm.generateShareHook.mockResolvedValue(null);
      const result = await service.generateShareToken(SUB, SESSION_ID);
      expect(result.token).toEqual(expect.any(String));
      const [, , updates] = mockDb.updateSessionMeta.mock.calls[0];
      expect(updates.shareHook).toBeUndefined();
    });

    it('still shares successfully when queryNodes rejects', async () => {
      mockDb.queryNodes.mockRejectedValue(new Error('ddb blip'));
      const result = await service.generateShareToken(SUB, SESSION_ID);
      expect(result.token).toEqual(expect.any(String));
      expect(mockDb.putShareToken).toHaveBeenCalled();
    });

    it('keeps the previous shareHook when regeneration fails', async () => {
      mockDb.getSessionMeta.mockResolvedValue({ ...sessionMeta, shareHook: 'Previous hook.' });
      mockDb.queryNodes.mockRejectedValue(new Error('ddb blip'));
      await service.generateShareToken(SUB, SESSION_ID);
      const [, , updates] = mockDb.updateSessionMeta.mock.calls[0];
      expect(updates.shareHook).toBe('Previous hook.');
    });
  });
});
