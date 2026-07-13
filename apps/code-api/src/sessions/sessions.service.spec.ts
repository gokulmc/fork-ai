import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionsService } from './sessions.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { LlmService } from '@/llm/llm.service';
import { UsersService } from '@/users/users.service';

const mockDb = {
  putNode: jest.fn(),
  putSessionMeta: jest.fn(),
  batchPutNodes: jest.fn(),
  getSessionMeta: jest.fn(),
  getProject: jest.fn(),
  listSessionMeta: jest.fn(),
  updateSessionMeta: jest.fn(),
  deleteSessionMeta: jest.fn(),
  queryNodes: jest.fn(),
  queryAnnotations: jest.fn(),
  queryHighlights: jest.fn(),
  batchDeleteNodes: jest.fn(),
  batchDeleteAnnotations: jest.fn(),
  batchDeleteHighlights: jest.fn(),
};

const mockLlm = {
  answerQuery: jest.fn(),
  streamAnswerQuery: jest.fn(),
  extractDocumentOutline: jest.fn(),
  generateFromBrief: jest.fn(),
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
    // Default to no project — most tests don't seed one; the fill-root
    // describe below overrides this per-test to exercise the init.md seed.
    mockDb.getProject.mockResolvedValue(null);
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
      expect(mockLlm.answerQuery).toHaveBeenCalledWith('What is ML?', 4, false, undefined);
      expect(mockDb.putNode).toHaveBeenCalledTimes(1);
      expect(mockDb.putSessionMeta).toHaveBeenCalledTimes(1);
      expect(result.title).toBe('Neural Nets');
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]['kind']).toBe('QUERY');
    });

    it('uses custom sectionCount when provided', async () => {
      mockLlm.answerQuery.mockResolvedValue(llmResult);
      await service.create(SUB, { query: 'Q', sectionCount: 3 });
      expect(mockLlm.answerQuery).toHaveBeenCalledWith('Q', 3, false, undefined);
    });

    it('forwards webSearch flag to LLM and stores sources on root node', async () => {
      const llmWithSources = {
        ...llmResult,
        sources: [{ title: 'Ref', url: 'https://ref.com' }],
      };
      mockLlm.answerQuery.mockResolvedValue(llmWithSources);
      const result = await service.create(SUB, { query: 'Q', webSearch: true });
      expect(mockLlm.answerQuery).toHaveBeenCalledWith('Q', 4, true, undefined);
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

  describe('createRootNodeStreaming', () => {
    // An empty Project map session — carries projectId, zero nodes.
    const emptyProjectMeta = { ...sessionMeta, title: 'My Project', emoji: '', lede: '', rootNodeId: '', nodeCount: 0, projectId: 'proj-1' };

    beforeEach(() => {
      mockUsers.checkCredit.mockResolvedValue(undefined);
      mockUsers.billUsage.mockResolvedValue(undefined);
      mockDb.getSessionMeta.mockResolvedValue(emptyProjectMeta);
      mockDb.queryNodes.mockResolvedValue([]);
      mockDb.putNode.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
      mockLlm.streamAnswerQuery.mockReturnValue(fakeStream());
    });

    it('rejects a session that already has a learn-kind node, before any SSE write or persistence (D2)', async () => {
      mockDb.queryNodes.mockResolvedValue([{ nodeId: 'n1', kind: 'QUERY' }]);
      const send = jest.fn();

      await expect(service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'What is ML?' }, send)).rejects.toBeInstanceOf(BadRequestException);

      expect(send).not.toHaveBeenCalled();
      expect(mockDb.putNode).not.toHaveBeenCalled();
      expect(mockDb.updateSessionMeta).not.toHaveBeenCalled();
    });

    it('rejects a session the caller does not own (getSessionMeta miss)', async () => {
      mockDb.getSessionMeta.mockResolvedValue(null);
      const send = jest.fn();

      await expect(service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'Q' }, send)).rejects.toBeInstanceOf(NotFoundException);
      expect(send).not.toHaveBeenCalled();
    });

    it('reuses the existing sessionId — persist-first via PARTIAL meta patches only, so projectId survives', async () => {
      const events: Array<{ type: string; sessionId?: string; nodeId?: string }> = [];
      await service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'What is ML?' }, (d) => events.push(d as never));

      // init carries the EXISTING session id and a fresh node id.
      expect(events[0].type).toBe('init');
      expect(events[0].sessionId).toBe(SESSION_ID);
      expect(events[0].nodeId).toBeDefined();

      // Never a full putSessionMeta replace — that would drop projectId (the row
      // already existed; ProjectsService patched projectId onto it).
      expect(mockDb.putSessionMeta).not.toHaveBeenCalled();
      // Every meta write is a partial update, and none touches projectId.
      expect(mockDb.updateSessionMeta.mock.calls.length).toBeGreaterThanOrEqual(2); // up-front placeholder + done patch
      for (const [sub, sessionId, updates] of mockDb.updateSessionMeta.mock.calls) {
        expect(sub).toBe(SUB);
        expect(sessionId).toBe(SESSION_ID);
        expect(updates).not.toHaveProperty('projectId');
      }
      // The done patch swaps in the real title/emoji/lede.
      const doneUpdates = mockDb.updateSessionMeta.mock.calls[mockDb.updateSessionMeta.mock.calls.length - 1][2];
      expect(doneUpdates).toEqual({ title: 'Neural Nets', emoji: '🧠', lede: 'How neural networks work.' });

      expect(mockUsers.billUsage).toHaveBeenCalledWith(SUB, 100, 50, 'QUERY', SESSION_ID, events[0].nodeId, expect.any(String));
    });

    it('streams the same event vocabulary as POST /sessions/stream (init → meta → section* → done)', async () => {
      const events: Array<{ type: string }> = [];
      await service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'What is ML?' }, (d) => events.push(d as { type: string }));
      expect(events.map((e) => e.type)).toEqual(['init', 'meta', 'section', 'section', 'done']);
    });
  });

  describe('createRootNodeStreaming — seeded project, first-question route (D2)', () => {
    const codeRootNode = {
      nodeId: 'code-root-1', parentId: null, kind: 'CODE', branchName: 'main', commitSha: 'abc123',
      title: 'Initial commit', query: 'Initial commit', sections: [], createdAt: NOW,
    };
    const seededMeta = { ...sessionMeta, title: 'My Project', emoji: '', lede: '', rootNodeId: 'code-root-1', nodeCount: 1, projectId: 'proj-1' };

    beforeEach(() => {
      mockUsers.checkCredit.mockResolvedValue(undefined);
      mockUsers.billUsage.mockResolvedValue(undefined);
      mockDb.getSessionMeta.mockResolvedValue(seededMeta);
      mockDb.queryNodes.mockResolvedValue([codeRootNode]);
      mockDb.putNode.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
      mockLlm.streamAnswerQuery.mockReturnValue(fakeStream());
    });

    it('parents the streamed QUERY node under the CODE root and never patches the session title', async () => {
      const events: Array<{ type: string; sessionId?: string; nodeId?: string }> = [];
      await service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'What is ML?' }, (d) => events.push(d as never));

      expect(events[0].type).toBe('init');
      expect(mockDb.putNode.mock.calls[0][0].parentId).toBe('code-root-1');
      expect(mockDb.putNode.mock.calls[0][0].kind).toBe('QUERY');

      // Meta is patched (nodeCount/updatedAt) at init only — never title/emoji/lede,
      // since the session title stays the project name, not the query.
      expect(mockDb.updateSessionMeta.mock.calls).toHaveLength(1);
      expect(mockDb.updateSessionMeta.mock.calls[0][2]).toEqual(
        expect.objectContaining({ nodeCount: 2 }),
      );
      expect(mockDb.updateSessionMeta.mock.calls[0][2]).not.toHaveProperty('title');
    });

    it('falls back to the parentId===null node when rootNodeId is empty', async () => {
      mockDb.getSessionMeta.mockResolvedValue({ ...seededMeta, rootNodeId: '' });
      const events: Array<{ type: string; nodeId?: string }> = [];
      await service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'Q' }, (d) => events.push(d as never));
      expect(mockDb.putNode.mock.calls[0][0].parentId).toBe('code-root-1');
    });

    it('rejects with 400 when the session already has a learn-kind node (route already used)', async () => {
      mockDb.queryNodes.mockResolvedValue([
        codeRootNode,
        { nodeId: 'q1', parentId: 'code-root-1', kind: 'QUERY', title: 't', query: 'q', sections: [] },
      ]);
      const send = jest.fn();
      await expect(service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'Q' }, send)).rejects.toBeInstanceOf(BadRequestException);
      expect(send).not.toHaveBeenCalled();
      expect(mockDb.putNode).not.toHaveBeenCalled();
      expect(mockDb.updateSessionMeta).not.toHaveBeenCalled();
    });

    it('still bills usage and streams the standard event vocabulary', async () => {
      const events: Array<{ type: string; nodeId?: string }> = [];
      await service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'What is ML?' }, (d) => events.push(d as never));
      expect(events.map((e) => e.type)).toEqual(['init', 'meta', 'section', 'section', 'done']);
      expect(mockUsers.billUsage).toHaveBeenCalledWith(SUB, 100, 50, 'QUERY', SESSION_ID, events[0].nodeId, expect.any(String));
    });
  });

  describe('createRootNodeStreaming — fill-root, from-scratch BRANCH root (D1/D3)', () => {
    const branchRootNode = {
      nodeId: 'branch-root-1', parentId: null, kind: 'BRANCH', branchName: 'main', commitSha: 'abc123',
      title: 'A billing dashboard…', query: 'A billing dashboard with Stripe.', sections: [], createdAt: NOW,
    };
    const seededMeta = { ...sessionMeta, title: 'My Project', emoji: '', lede: '', rootNodeId: 'branch-root-1', nodeCount: 1, projectId: 'proj-1' };

    beforeEach(() => {
      mockUsers.checkCredit.mockResolvedValue(undefined);
      mockUsers.billUsage.mockResolvedValue(undefined);
      mockDb.getSessionMeta.mockResolvedValue(seededMeta);
      mockDb.queryNodes.mockResolvedValue([branchRootNode]);
      mockDb.putNode.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
      mockLlm.streamAnswerQuery.mockReturnValue(fakeStream());
    });

    it('streams the answer INTO the existing BRANCH root — init carries the SAME nodeId, no new node is put', async () => {
      const events: Array<{ type: string; sessionId?: string; nodeId?: string }> = [];
      await service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'A billing dashboard with Stripe.' }, (d) => events.push(d as never));

      expect(events[0]).toEqual({ type: 'init', sessionId: SESSION_ID, nodeId: 'branch-root-1' });
      expect(events.map((e) => e.type)).toEqual(['init', 'meta', 'section', 'section', 'done']);
      // Every putNode call targets the root's own id — never a fresh nodeId.
      for (const [node] of mockDb.putNode.mock.calls) expect(node.nodeId).toBe('branch-root-1');
      expect(mockDb.putNode.mock.calls[mockDb.putNode.mock.calls.length - 1][0].kind).toBe('BRANCH');
    });

    it('patches BOTH the node and the session title/emoji/lede at done', async () => {
      await service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'A billing dashboard with Stripe.' }, jest.fn());

      const finalNode = mockDb.putNode.mock.calls[mockDb.putNode.mock.calls.length - 1][0];
      expect(finalNode.title).toBe('Neural Nets');
      expect(finalNode.sections).toHaveLength(2);

      const doneMetaUpdate = mockDb.updateSessionMeta.mock.calls[mockDb.updateSessionMeta.mock.calls.length - 1];
      expect(doneMetaUpdate[2]).toEqual({ title: 'Neural Nets', emoji: '🧠', lede: 'How neural networks work.' });
    });

    it('rejects a re-fill once the root already has sections, before any SSE write or persistence', async () => {
      mockDb.queryNodes.mockResolvedValue([{ ...branchRootNode, sections: [{ id: 's1', heading: 'H', body: 'B' }] }]);
      const send = jest.fn();

      await expect(service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'Q' }, send)).rejects.toBeInstanceOf(BadRequestException);
      expect(send).not.toHaveBeenCalled();
      expect(mockDb.putNode).not.toHaveBeenCalled();
    });

    it('bills usage against the existing root nodeId', async () => {
      const events: Array<{ type: string; nodeId?: string }> = [];
      await service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'Q' }, (d) => events.push(d as never));
      expect(mockUsers.billUsage).toHaveBeenCalledWith(SUB, 100, 50, 'QUERY', SESSION_ID, 'branch-root-1', expect.any(String));
    });

    // REGRESSION: Dynamoose strips a null parentId on write, so the real
    // DynamoRepository.queryNodes round-trip omits the key entirely rather than
    // returning parentId: null. The fill-root gate (`existing.find(n => n.parentId
    // === null)`) must still recognize this node as the root — a strict miss here
    // used to fall through to the seeded-question path and throw
    // "Cannot create a QUERY node under a BRANCH parent".
    it('recognizes the root when parentId is entirely absent (simulated Dynamo round-trip), instead of throwing', async () => {
      const { parentId: _parentId, ...rootWithoutParentId } = branchRootNode;
      mockDb.queryNodes.mockResolvedValue([rootWithoutParentId]);
      const events: Array<{ type: string; nodeId?: string }> = [];

      await expect(
        service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'A billing dashboard with Stripe.' }, (d) => events.push(d as never)),
      ).resolves.toBeUndefined();

      expect(events[0]).toEqual({ type: 'init', sessionId: SESSION_ID, nodeId: 'branch-root-1' });
      expect(events.map((e) => e.type)).toEqual(['init', 'meta', 'section', 'section', 'done']);
      for (const [node] of mockDb.putNode.mock.calls) expect(node.nodeId).toBe('branch-root-1');
    });
  });

  describe('createRootNodeStreaming — fill-root, deterministic init.md seed', () => {
    const branchRootNode = {
      nodeId: 'branch-root-1', parentId: null, kind: 'BRANCH', branchName: 'main', commitSha: 'abc123',
      title: 'A billing dashboard…', query: 'A billing dashboard with Stripe.', sections: [], createdAt: NOW,
    };
    const seededMeta = { ...sessionMeta, title: 'My Project', emoji: '', lede: '', rootNodeId: 'branch-root-1', nodeCount: 1, projectId: 'proj-1' };
    const projectWithPlugins = {
      projectId: 'proj-1', name: 'My Project', sessionId: SESSION_ID,
      repoRef: { provider: 'new', owner: 'acme', repo: 'widgets', defaultBranch: 'main', url: 'https://mock.git/acme/widgets' },
      plugins: ['graphify', 'tdd'],
      createdAt: NOW, updatedAt: NOW,
    };

    // Mimics streamAnswerQuery when webSearch citation-processing rewrites section
    // bodies at `done` — used to verify the offset doesn't clobber the seed.
    async function* fakeStreamWithCitations() {
      yield { type: 'meta', title: 'Neural Nets', emoji: '🧠', lede: 'How neural networks work.' };
      yield { type: 'section', heading: 'Intro', body: 'Introduction text.' };
      yield { type: 'section', heading: 'Layers', body: 'Layer text.' };
      yield {
        type: 'done',
        usage: { inputTokens: 100, outputTokens: 50 },
        sections: [
          { heading: 'Intro', body: 'Introduction text with [1] citation.' },
          { heading: 'Layers', body: 'Layer text with [2] citation.' },
        ],
      };
    }

    beforeEach(() => {
      mockUsers.checkCredit.mockResolvedValue(undefined);
      mockUsers.billUsage.mockResolvedValue(undefined);
      mockDb.getSessionMeta.mockResolvedValue(seededMeta);
      mockDb.queryNodes.mockResolvedValue([branchRootNode]);
      mockDb.putNode.mockResolvedValue(undefined);
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
      mockLlm.streamAnswerQuery.mockReturnValue(fakeStream());
    });

    it('prepends an init.md section, built from the project plugins, before the LLM meta/sections', async () => {
      mockDb.getProject.mockResolvedValue(projectWithPlugins);
      const events: Array<{ type: string; heading?: string }> = [];
      await service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'A billing dashboard with Stripe.' }, (d) => events.push(d as never));

      const firstSection = events.find((e) => e.type === 'section');
      expect(firstSection?.heading).toBe('init.md');

      const finalNode = mockDb.putNode.mock.calls[mockDb.putNode.mock.calls.length - 1][0];
      expect(finalNode.sections[0].heading).toBe('init.md');
      expect(finalNode.sections[0].body).toContain('Graphify');
      expect(finalNode.sections[0].body).toContain('TDD');
    });

    it('emits no init.md section when the project has no plugins selected', async () => {
      mockDb.getProject.mockResolvedValue({ ...projectWithPlugins, plugins: [] });
      const events: Array<{ type: string; heading?: string }> = [];
      await service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'Q' }, (d) => events.push(d as never));

      expect(events.some((e) => e.type === 'section' && e.heading === 'init.md')).toBe(false);
      const finalNode = mockDb.putNode.mock.calls[mockDb.putNode.mock.calls.length - 1][0];
      expect(finalNode.sections.some((s: { heading: string }) => s.heading === 'init.md')).toBe(false);
    });

    it('patches citation-processed bodies onto the LLM sections only, never the init.md seed (index offset)', async () => {
      mockDb.getProject.mockResolvedValue(projectWithPlugins);
      mockLlm.streamAnswerQuery.mockReturnValue(fakeStreamWithCitations());
      await service.createRootNodeStreaming(SUB, SESSION_ID, { query: 'Q' }, jest.fn());

      const finalNode = mockDb.putNode.mock.calls[mockDb.putNode.mock.calls.length - 1][0];
      expect(finalNode.sections[0].heading).toBe('init.md');
      expect(finalNode.sections[0].body).not.toContain('citation');
      expect(finalNode.sections[1].body).toBe('Introduction text with [1] citation.');
      expect(finalNode.sections[2].body).toBe('Layer text with [2] citation.');
    });
  });

  describe('createProjectSession', () => {
    const TITLE = 'My Project';

    beforeEach(() => {
      mockDb.putNode.mockResolvedValue(undefined);
      mockDb.putSessionMeta.mockResolvedValue(undefined);
    });

    it('seeds a synthesized single CODE root when there is no real commit (mock provider)', async () => {
      const sessionId = await service.createProjectSession(SUB, TITLE, {
        defaultBranch: 'main', first: null, head: null, imported: false,
      });

      expect(mockDb.putNode).toHaveBeenCalledTimes(1);
      const [node] = mockDb.putNode.mock.calls[0];
      expect(node.kind).toBe('CODE');
      expect(node.parentId).toBeNull();
      expect(node.branchName).toBe('main');
      expect(node.title).toBe('Initial commit');
      expect(node.commitMessage).toBe('Initial commit');
      expect(node.commitSha).toMatch(/^[0-9a-f]{40}$/); // randomBytes(20).toString('hex')
      expect(node.imported).toBeUndefined();
      expect(node.agentStatus).toBeUndefined();

      const [meta] = mockDb.putSessionMeta.mock.calls[0];
      expect(meta.sessionId).toBe(sessionId);
      expect(meta.rootNodeId).toBe(node.nodeId);
      expect(meta.nodeCount).toBe(1);
      expect(meta.title).toBe(TITLE);
    });

    it('seeds a single imported CODE root when head equals first (single-commit repo)', async () => {
      await service.createProjectSession(SUB, TITLE, {
        defaultBranch: 'main',
        first: { sha: 'abc123', message: 'Initial commit from a real repo', date: '2026-01-01T00:00:00Z' },
        head: { sha: 'abc123', message: 'Initial commit from a real repo', date: '2026-01-01T00:00:00Z' },
        imported: true,
      });

      expect(mockDb.putNode).toHaveBeenCalledTimes(1);
      const [node] = mockDb.putNode.mock.calls[0];
      expect(node.commitSha).toBe('abc123');
      expect(node.title).toBe('Initial commit from a real');
      expect(node.imported).toBe(true);

      const [meta] = mockDb.putSessionMeta.mock.calls[0];
      expect(meta.nodeCount).toBe(1);
    });

    it('seeds a root + HEAD pair when the two commits differ (real history)', async () => {
      await service.createProjectSession(SUB, TITLE, {
        defaultBranch: 'main',
        first: { sha: 'first-sha', message: 'Initial commit', date: '2026-01-01T00:00:00Z' },
        head: { sha: 'head-sha', message: 'Add retry logic to the fetch client', date: '2026-02-01T00:00:00Z' },
        imported: true,
      });

      expect(mockDb.putNode).toHaveBeenCalledTimes(2);
      const [rootNode] = mockDb.putNode.mock.calls[0];
      const [headNode] = mockDb.putNode.mock.calls[1];

      expect(rootNode.parentId).toBeNull();
      expect(rootNode.commitSha).toBe('first-sha');
      expect(rootNode.imported).toBe(true);

      expect(headNode.parentId).toBe(rootNode.nodeId);
      expect(headNode.kind).toBe('CODE');
      expect(headNode.branchName).toBe('main');
      expect(headNode.commitSha).toBe('head-sha');
      expect(headNode.title).toBe('Add retry logic to the');
      expect(headNode.imported).toBe(true);

      const [meta] = mockDb.putSessionMeta.mock.calls[0];
      expect(meta.rootNodeId).toBe(rootNode.nodeId);
      expect(meta.nodeCount).toBe(2);
    });

    it('an empty repo (first/head both null but imported:true) still synthesizes a single unimported root', async () => {
      await service.createProjectSession(SUB, TITLE, {
        defaultBranch: 'main', first: null, head: null, imported: true,
      });

      expect(mockDb.putNode).toHaveBeenCalledTimes(1);
      const [node] = mockDb.putNode.mock.calls[0];
      expect(node.imported).toBeUndefined();
      expect(node.commitMessage).toBe('Initial commit');
    });
  });

  describe('createProjectSession — from-scratch (rootQuery set, D1)', () => {
    const TITLE = 'My Project';

    it('seeds a single BRANCH root carrying the rootQuery, with empty sections', async () => {
      const sessionId = await service.createProjectSession(
        SUB, TITLE, { defaultBranch: 'main', first: null, head: null, imported: false }, 'A billing dashboard with Stripe.',
      );

      expect(mockDb.putNode).toHaveBeenCalledTimes(1);
      const [node] = mockDb.putNode.mock.calls[0];
      expect(node.kind).toBe('BRANCH');
      expect(node.parentId).toBeNull();
      expect(node.branchName).toBe('main');
      expect(node.query).toBe('A billing dashboard with Stripe.');
      expect(node.sections).toEqual([]);
      expect(node.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(node.model).toBeDefined();

      const [meta] = mockDb.putSessionMeta.mock.calls[0];
      expect(meta.sessionId).toBe(sessionId);
      expect(meta.rootNodeId).toBe(node.nodeId);
      expect(meta.nodeCount).toBe(1);
      expect(meta.title).toBe(TITLE); // the project name, not the rootQuery
    });

    it('ignores any seed.first/head — a from-scratch project never seeds real commits', async () => {
      await service.createProjectSession(
        SUB, TITLE,
        { defaultBranch: 'main', first: { sha: 'x', message: 'm', date: '2026-01-01T00:00:00Z' }, head: null, imported: true },
        'Some question',
      );
      expect(mockDb.putNode).toHaveBeenCalledTimes(1);
      expect(mockDb.putNode.mock.calls[0][0].kind).toBe('BRANCH');
    });
  });

  describe('createImportedProjectSession', () => {
    const TITLE = 'My Project';
    const SESSION_ID = 'sess-imported';
    const nodes = [
      { PK: `SESSION#${SESSION_ID}`, SK: 'NODE#n1', nodeId: 'n1', parentId: null, kind: 'CODE', title: 'Initial commit' },
      { PK: `SESSION#${SESSION_ID}`, SK: 'NODE#n2', nodeId: 'n2', parentId: 'n1', kind: 'CODE', title: 'Add feature' },
    ] as unknown as Parameters<typeof service.createImportedProjectSession>[3];

    beforeEach(() => {
      mockDb.batchPutNodes.mockResolvedValue(undefined);
      mockDb.putSessionMeta.mockResolvedValue(undefined);
    });

    it('batch-writes the given nodes and points SessionMeta at the parentless root', async () => {
      const result = await service.createImportedProjectSession(SUB, TITLE, SESSION_ID, nodes);

      expect(result).toBe(SESSION_ID);
      expect(mockDb.batchPutNodes).toHaveBeenCalledWith(nodes);
      const [meta] = mockDb.putSessionMeta.mock.calls[0];
      expect(meta.sessionId).toBe(SESSION_ID);
      expect(meta.rootNodeId).toBe('n1');
      expect(meta.nodeCount).toBe(2);
      expect(meta.title).toBe(TITLE);
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
});
