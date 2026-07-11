import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NodesService } from './nodes.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { LlmService } from '@/llm/llm.service';
import { BRANCH_DEFAULT_MODEL } from '@/llm/models';
import { SessionsService } from '@/sessions/sessions.service';
import { UsersService } from '@/users/users.service';
import { MockAgentService } from '@/agent/mock-agent.service';

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
  getAgentRun: jest.fn(),
  putAgentRun: jest.fn(),
  updateAgentRun: jest.fn(),
  getProject: jest.fn(),
};

const mockLlm = {
  expandSection: jest.fn(),
  followUpFromHighlight: jest.fn(),
  mixNodes: jest.fn(),
};

const mockSessions = {
  getSession: jest.fn(),
  touchUpdatedAt: jest.fn(),
  incrementNodeCount: jest.fn(),
};

const mockUsers = {
  checkCredit: jest.fn(),
  billUsage: jest.fn(),
  getPersona: jest.fn(),
};

const mockAgent = {
  generate: jest.fn(),
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
    // Default so any test whose parent happens to be a CODE node (grammar
    // matrices reuse the same dto/parent across kinds) doesn't need to know
    // about the code→learn AgentRun lookup unless it's specifically testing it.
    mockDb.getAgentRun.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodesService,
        { provide: DynamoRepository, useValue: mockDb },
        { provide: LlmService, useValue: mockLlm },
        { provide: SessionsService, useValue: mockSessions },
        { provide: UsersService, useValue: mockUsers },
        { provide: MockAgentService, useValue: mockAgent },
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
        true,  // authed (non-guest createNode)
        false, // boost
        [],    // avoidEmojis (parent has no emoji, no siblings)
        undefined, // persona (none set for this user)
        undefined, // extraContext (parent is not a CODE node)
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
        expect.anything(),
        expect.anything(),
        expect.anything(),
        undefined, // persona (none set for this user)
        undefined, // extraContext (parent is not a CODE node)
      );
    });

    it('passes ancestor + sibling emojis to avoid as the third-to-last arg', async () => {
      mockSessions.getSession.mockResolvedValueOnce({
        ...fullSession,
        nodes: [
          { ...parentNode, emoji: '🌳' },
          { nodeId: '01HZSIB', parentId: PARENT_NODE_ID, query: 'q', title: 't', kind: 'DEEPER', emoji: '🍃' },
        ],
      });
      await service.createNode(SUB, SESSION_ID, dto);
      const avoidEmojisArg = mockLlm.expandSection.mock.calls[0].at(-3); // last two args are now persona, extraContext
      expect(avoidEmojisArg).toEqual(expect.arrayContaining(['🌳', '🍃']));
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
        true,  // authed (non-guest createNode)
        false, // boost
        [],    // avoidEmojis (parent has no emoji, no siblings)
        undefined, // persona (none set for this user)
        undefined, // extraContext (parent is not a CODE node)
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

  describe('updateNode', () => {
    it('updates the title field', async () => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      mockDb.getNode.mockResolvedValue({ nodeId: 'n1', title: 'Old' });
      mockDb.updateNode.mockResolvedValue(undefined);
      await service.updateNode(SUB, SESSION_ID, 'n1', { title: 'New title' });
      expect(mockDb.updateNode).toHaveBeenCalledWith(SESSION_ID, 'n1', { title: 'New title' });
    });

    it('stars a node', async () => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      mockDb.getNode.mockResolvedValue({ nodeId: 'n1', title: 'Old' });
      mockDb.updateNode.mockResolvedValue(undefined);
      await service.updateNode(SUB, SESSION_ID, 'n1', { starred: true });
      expect(mockDb.updateNode).toHaveBeenCalledWith(SESSION_ID, 'n1', { starred: true });
    });

    it('throws NotFoundException when node does not exist', async () => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      mockDb.getNode.mockResolvedValue(null);
      await expect(service.updateNode(SUB, SESSION_ID, 'n1', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
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

  describe('grammar enforcement — createNode', () => {
    const dto = {
      kind: 'DEEPER' as const,
      parentNodeId: PARENT_NODE_ID,
      fromSection: 'sec-1',
      query: 'Chain Rule',
      sectionBody: 'The chain rule is...',
    };

    beforeEach(() => {
      mockLlm.expandSection.mockResolvedValue(llmResult);
      mockDb.putNode.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('allows DEEPER under a learn-kind parent', async () => {
      mockSessions.getSession.mockResolvedValue(fullSession); // parentNode.kind === 'QUERY'
      await expect(service.createNode(SUB, SESSION_ID, dto)).resolves.toBeDefined();
    });

    it('allows DEEPER/ASK under a CODE parent', async () => {
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [{ ...parentNode, kind: 'CODE' }],
      });
      await expect(service.createNode(SUB, SESSION_ID, dto)).resolves.toBeDefined();
    });

    it('rejects DEEPER/ASK under a BRANCH parent', async () => {
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [{ ...parentNode, kind: 'BRANCH' }],
      });
      await expect(service.createNode(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('grammar enforcement — createMixNode', () => {
    const SOURCE_NODE_ID = '01HZSOURCE';
    const sourceNode = { ...parentNode, nodeId: SOURCE_NODE_ID, sections: [] as Array<{ heading: string; body: string }> };
    const mixLlmResult = { ...llmResult, title: 'Mix Result' };
    const mixDto = {
      parentNodeId: PARENT_NODE_ID,
      sourceNodeIds: [SOURCE_NODE_ID],
      query: 'Combine these',
    };

    beforeEach(() => {
      mockLlm.mixNodes.mockResolvedValue(mixLlmResult);
      mockDb.putNode.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('allows MIX under a learn-kind parent with any-kind sources', async () => {
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [parentNode, { ...sourceNode, kind: 'CODE' }],
      });
      const result = await service.createMixNode(SUB, SESSION_ID, mixDto);
      expect(result.kind).toBe('MIX');
    });

    it('rejects MIX under a CODE parent', async () => {
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [{ ...parentNode, kind: 'CODE' }, sourceNode],
      });
      await expect(service.createMixNode(SUB, SESSION_ID, mixDto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('plan:true produces a PLAN node when base + sources are all learn kinds', async () => {
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [parentNode, { ...sourceNode, kind: 'ASK' }],
      });
      const result = await service.createMixNode(SUB, SESSION_ID, { ...mixDto, plan: true });
      expect(result.kind).toBe('PLAN');
      expect(mockLlm.mixNodes).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), expect.anything(),
        expect.anything(), expect.anything(), expect.anything(), undefined, // persona (none set for this user)
        true, // plan flag is the last arg
      );
      expect(mockUsers.billUsage).toHaveBeenCalledWith(
        SUB, expect.anything(), expect.anything(), 'PLAN', SESSION_ID, expect.anything(), expect.anything(),
      );
    });

    it('plan:true rejects a non-learn base node', async () => {
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [{ ...parentNode, kind: 'CODE' }, sourceNode],
      });
      await expect(service.createMixNode(SUB, SESSION_ID, { ...mixDto, plan: true })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('plan:true rejects a non-learn source node', async () => {
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [parentNode, { ...sourceNode, kind: 'CODE' }],
      });
      await expect(service.createMixNode(SUB, SESSION_ID, { ...mixDto, plan: true })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('plan:false (default) never restricts source kinds', async () => {
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [parentNode, { ...sourceNode, kind: 'CODE' }],
      });
      await expect(service.createMixNode(SUB, SESSION_ID, mixDto)).resolves.toBeDefined();
    });
  });

  describe('createBranchNode', () => {
    const codeParent = { ...parentNode, kind: 'CODE', commitSha: 'abcdef1234567890' };
    const dto = { parentNodeId: PARENT_NODE_ID, branchName: 'feature/retry-logic' };

    beforeEach(() => {
      mockDb.putNode.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('creates a BRANCH node forking from the parent CODE node commit', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [codeParent] });
      const result = await service.createBranchNode(SUB, SESSION_ID, dto);
      expect(result.kind).toBe('BRANCH');
      expect(result.branchName).toBe('feature/retry-logic');
      expect(result.commitSha).toBe('abcdef1234567890');
      expect(result.parentId).toBe(PARENT_NODE_ID);
      expect(result.query).toBe('Fork from abcdef1');
    });

    it('rejects a non-CODE parent', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [{ ...parentNode, kind: 'QUERY' }] });
      await expect(service.createBranchNode(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a CODE parent with no commit yet', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [{ ...parentNode, kind: 'CODE' }] });
      await expect(service.createBranchNode(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a duplicate branch name within the session', async () => {
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [
          codeParent,
          { nodeId: '01HZEXIST', parentId: PARENT_NODE_ID, kind: 'BRANCH', branchName: 'feature/retry-logic', title: 'x', query: 'x' },
        ],
      });
      await expect(service.createBranchNode(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when parent node does not exist', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [] });
      await expect(service.createBranchNode(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getAgentRun', () => {
    it('returns the AgentRun when found', async () => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      const run = { nodeId: 'n1', status: 'done', events: '[]' };
      mockDb.getAgentRun.mockResolvedValue(run);
      await expect(service.getAgentRun(SUB, SESSION_ID, 'n1')).resolves.toBe(run);
    });

    it('throws NotFoundException when no AgentRun exists for the node', async () => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      mockDb.getAgentRun.mockResolvedValue(null);
      await expect(service.getAgentRun(SUB, SESSION_ID, 'n1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createNode — code→learn context enrichment', () => {
    const codeParent = {
      ...parentNode,
      kind: 'CODE',
      commitMessage: 'Add retry logic',
      diffSummary: {
        filesChanged: 1, additions: 5, deletions: 1,
        files: [{ path: 'src/retry.ts', status: 'modified', additions: 5, deletions: 1 }],
      },
    };
    const dto = {
      kind: 'DEEPER' as const,
      parentNodeId: PARENT_NODE_ID,
      fromSection: 'sec-1',
      query: 'Explain the retry logic',
      sectionBody: 'body',
    };

    beforeEach(() => {
      mockLlm.expandSection.mockResolvedValue(llmResult);
      mockDb.putNode.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('threads commit + file + recent-event context into expandSection when the parent is CODE', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [codeParent] });
      mockDb.getAgentRun.mockResolvedValue({
        nodeId: PARENT_NODE_ID,
        status: 'done',
        events: JSON.stringify([
          { seq: 0, ts: 't', kind: 'text', payload: 'reading files' },
          { seq: 1, ts: 't', kind: 'terminal', payload: 'tests passed' },
        ]),
      });

      await service.createNode(SUB, SESSION_ID, dto);

      expect(mockDb.getAgentRun).toHaveBeenCalledWith(SESSION_ID, PARENT_NODE_ID);
      const extraContext = mockLlm.expandSection.mock.calls[0].at(-1);
      expect(extraContext).toContain('Add retry logic');
      expect(extraContext).toContain('src/retry.ts');
      expect(extraContext).toContain('reading files');
      expect(extraContext).toContain('tests passed');
    });

    it('degrades to commit/file context only when no AgentRun exists (skips silently)', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [codeParent] });
      mockDb.getAgentRun.mockResolvedValue(null);

      await service.createNode(SUB, SESSION_ID, dto);

      const extraContext = mockLlm.expandSection.mock.calls[0].at(-1);
      expect(extraContext).toContain('Add retry logic');
      expect(extraContext).toContain('no agent run events available');
    });

    it('degrades gracefully when fetching the AgentRun errors', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [codeParent] });
      mockDb.getAgentRun.mockRejectedValue(new Error('ddb blip'));

      await expect(service.createNode(SUB, SESSION_ID, dto)).resolves.toBeDefined();
      const extraContext = mockLlm.expandSection.mock.calls[0].at(-1);
      expect(extraContext).toContain('no agent run events available');
    });

    it('leaves extraContext undefined when the parent is not a CODE node', async () => {
      mockSessions.getSession.mockResolvedValue(fullSession); // parentNode.kind === 'QUERY'
      await service.createNode(SUB, SESSION_ID, dto);
      expect(mockLlm.expandSection.mock.calls[0].at(-1)).toBeUndefined();
      expect(mockDb.getAgentRun).not.toHaveBeenCalled();
    });
  });

  describe('createCodeNodeStreaming', () => {
    const planNode = {
      nodeId: 'plan-1', parentId: null, kind: 'PLAN', title: 'Plan', query: 'Plan',
      sections: [{ id: 's1', heading: 'Goal', body: 'Do the thing' }],
    };
    const dto = { parentNodeId: 'plan-1', instruction: 'Implement retry logic' };
    const agentResult = {
      commitMessage: 'Add retry logic to fetch client',
      diffSummary: {
        filesChanged: 1, additions: 10, deletions: 2,
        files: [{ path: 'src/fetch.ts', status: 'modified', additions: 10, deletions: 2 }],
      },
      events: [
        { seq: 0, ts: '2026-01-01T00:00:00.000Z', kind: 'text' as const, payload: 'Reading files' },
        { seq: 1, ts: '2026-01-01T00:00:00.000Z', kind: 'terminal' as const, payload: 'tests passed' },
        { seq: 2, ts: '2026-01-01T00:00:00.000Z', kind: 'file_edit' as const, payload: 'src/fetch.ts' },
      ],
      inputTokens: 500,
      outputTokens: 300,
      model: BRANCH_DEFAULT_MODEL,
    };

    beforeEach(() => {
      mockUsers.checkCredit.mockResolvedValue(undefined);
      mockUsers.billUsage.mockResolvedValue(undefined);
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [planNode] });
      mockDb.putNode.mockResolvedValue(undefined);
      mockDb.putAgentRun.mockResolvedValue(undefined);
      mockDb.updateNode.mockResolvedValue(undefined);
      mockDb.updateAgentRun.mockResolvedValue(undefined);
      mockDb.getProject.mockResolvedValue(null);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
      mockAgent.generate.mockResolvedValue(agentResult);
    });

    it('persists the loading node + AgentRun BEFORE any SSE event, then streams init → agent-event* → commit → done in order', async () => {
      const order: string[] = [];
      mockDb.putNode.mockImplementation(() => { order.push('putNode'); return Promise.resolve(); });
      mockDb.putAgentRun.mockImplementation(() => { order.push('putAgentRun'); return Promise.resolve(); });
      const received: Array<{ type: string }> = [];
      const send = (d: object) => { order.push(`send:${(d as { type: string }).type}`); received.push(d as { type: string }); };

      await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, send);

      // Persist-first: both writes land before the first SSE event of any kind,
      // and specifically before the first agent-event.
      expect(order[0]).toBe('putNode');
      expect(order[1]).toBe('putAgentRun');
      expect(order[2]).toBe('send:init');
      expect(order.indexOf('send:init')).toBeLessThan(order.indexOf('send:agent-event'));

      const types = received.map((e) => e.type);
      expect(types[0]).toBe('init');
      expect(types.slice(1, 4)).toEqual(['agent-event', 'agent-event', 'agent-event']);
      expect(types[4]).toBe('commit');
      expect(types[5]).toBe('done');
    });

    it('resolves branchName from the nearest BRANCH ancestor, falling back through repoRef.defaultBranch to main', async () => {
      await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());
      const ctxArg = mockAgent.generate.mock.calls[0][0];
      expect(ctxArg.branchName).toBe('main'); // no BRANCH ancestor, no project
      expect(ctxArg.planDoc).toContain('Do the thing');
    });

    it('bills usage with the mock agent result token counts and CODE kind', async () => {
      await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());
      expect(mockUsers.billUsage).toHaveBeenCalledWith(SUB, 500, 300, 'CODE', SESSION_ID, expect.any(String), BRANCH_DEFAULT_MODEL);
    });

    it('marks the node and AgentRun as error and emits an error event when the mock agent fails, without throwing', async () => {
      mockAgent.generate.mockRejectedValue(new Error('boom'));
      const received: Array<{ type: string }> = [];

      await expect(
        service.createCodeNodeStreaming(SUB, SESSION_ID, dto, (d) => received.push(d as { type: string })),
      ).resolves.toBeUndefined();

      expect(mockDb.updateNode).toHaveBeenCalledWith(SESSION_ID, expect.any(String), expect.objectContaining({ agentStatus: 'error' }));
      expect(mockDb.updateAgentRun).toHaveBeenCalledWith(SESSION_ID, expect.any(String), expect.objectContaining({ status: 'error' }));
      expect(received.some((e) => e.type === 'error')).toBe(true);
      expect(mockUsers.billUsage).not.toHaveBeenCalled();
    });

    it('rejects a parent kind that cannot host a CODE child', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [{ ...parentNode, kind: 'QUERY' }] });
      await expect(
        service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, parentNodeId: PARENT_NODE_ID }, jest.fn()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the parent node does not exist', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [] });
      await expect(service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn())).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
