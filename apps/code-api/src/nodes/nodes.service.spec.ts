import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NodesService } from './nodes.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { LlmService } from '@/llm/llm.service';
import { BRANCH_DEFAULT_MODEL } from '@/llm/models';
import { SessionsService } from '@/sessions/sessions.service';
import { UsersService } from '@/users/users.service';
import { GithubAppService } from '@/github/github-app.service';
import { AgentRunFinal } from '@/agent/agent-runner';
import { AGENT_RUNNER_REGISTRY } from '@/agent/runner-registry';
import { AgentEvent } from '@/agent/agent-run.util';

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

const mockGithubApp = {
  mintInstallationToken: jest.fn(),
};

const agentRunner = {
  run: jest.fn(),
};

// Stands in for the AGENT_RUNNER_REGISTRY seam — resolves to `agentRunner`
// by default so every existing createCodeNodeStreaming test keeps working
// unchanged; tests that care about environment routing override resolve().
const mockRunners = {
  resolve: jest.fn(() => agentRunner),
};

// Drives the AGENT_RUNNER seam the way MockAgentRunner does: an async
// generator yielding {type:'event'} items then a single {type:'result'} —
// or throwing mid-stream when `result` is an Error, to exercise the error path.
function runnerYields(events: Partial<AgentEvent>[], result: Partial<AgentRunFinal> | Error) {
  agentRunner.run.mockImplementation(async function* () {
    for (const e of events) yield { type: 'event', event: { seq: 0, ts: 't', kind: 'text', payload: '', ...e } };
    if (result instanceof Error) throw result;
    yield {
      type: 'result',
      result: {
        commitMessage: 'msg',
        commitSha: null,
        diffSummary: { filesChanged: 1, additions: 1, deletions: 0, files: [] },
        inputTokens: 1,
        outputTokens: 1,
        model: 'm',
        ...result,
      },
    };
  });
}

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
  sections: [] as Array<{ heading: string; body: string }>,
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
        { provide: GithubAppService, useValue: mockGithubApp },
        { provide: AGENT_RUNNER_REGISTRY, useValue: mockRunners },
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

    it('allows DEEPER/ASK under a BRANCH parent', async () => {
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [{ ...parentNode, kind: 'BRANCH' }],
      });
      await expect(service.createNode(SUB, SESSION_ID, dto)).resolves.toBeDefined();
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

    it('plan:false with zero sources is rejected', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [parentNode] });
      await expect(service.createMixNode(SUB, SESSION_ID, { ...mixDto, sourceNodeIds: [] }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('plan:true with zero sources succeeds, using the base node itself as the sole source', async () => {
      const base = { ...parentNode, sections: [{ id: 's1', heading: 'H', body: 'Body text' }] };
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [base] });
      const result = await service.createMixNode(SUB, SESSION_ID, { ...mixDto, sourceNodeIds: [], plan: true });
      expect(result.kind).toBe('PLAN');
      expect(mockLlm.mixNodes).toHaveBeenCalledWith(
        expect.anything(),
        [{ title: base.title, sections: [{ heading: 'H', body: 'Body text' }] }],
        expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
        undefined, // persona (none set for this user) — expect.anything() does not match undefined
        true,
      );
    });

    it('plan:true allows a BRANCH base node that has sections', async () => {
      const branchBase = {
        ...parentNode, kind: 'BRANCH', branchName: 'fork/x', commitSha: 'sha1',
        sections: [{ id: 's1', heading: 'H', body: 'B' }],
      };
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [branchBase, sourceNode] });
      const result = await service.createMixNode(SUB, SESSION_ID, { ...mixDto, plan: true });
      expect(result.kind).toBe('PLAN');
    });

    it('plan:true rejects a BRANCH base node with no sections', async () => {
      const branchBase = {
        ...parentNode, kind: 'BRANCH', branchName: 'fork/x', commitSha: 'sha1',
        sections: [] as Array<{ heading: string; body: string }>,
      };
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [branchBase, sourceNode] });
      await expect(service.createMixNode(SUB, SESSION_ID, { ...mixDto, plan: true }))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('createMixNode — plan forks a branch off the main CODE chain (F1)', () => {
    // root → head → user-CODE, all on 'main' — user-CODE is the true tip even
    // though `head` is the imported HEAD, because the user Continued main once.
    const codeRoot = {
      nodeId: 'code-root', parentId: null, kind: 'CODE', branchName: 'main', commitSha: 'root-sha',
      title: 'Root', query: 'root commit', createdAt: '2026-01-01T00:00:00.000Z',
      sections: [] as Array<{ heading: string; body: string }>,
    };
    const codeHead = {
      nodeId: 'code-head', parentId: 'code-root', kind: 'CODE', branchName: 'main', commitSha: 'head-sha',
      title: 'Head', query: 'head commit', createdAt: '2026-01-01T00:00:01.000Z',
    };
    const codeUser = {
      nodeId: 'code-user', parentId: 'code-head', kind: 'CODE', branchName: 'main', commitSha: 'user-sha',
      title: 'User', query: 'user commit', createdAt: '2026-01-01T00:00:02.000Z',
    };
    const learnBase = {
      nodeId: 'learn-base', parentId: 'code-user', kind: 'ASK', title: 'Learn', query: 'q',
      sections: [] as Array<{ heading: string; body: string }>,
    };
    const planMixDto = { parentNodeId: 'learn-base', sourceNodeIds: [] as string[], query: 'Build the thing', plan: true };

    beforeEach(() => {
      mockLlm.mixNodes.mockResolvedValue({ ...llmResult, title: 'Mix Result' });
      mockDb.putNode.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('forks from the tip of the main CODE chain, not the imported HEAD', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [codeRoot, codeHead, codeUser, learnBase] });
      const result = await service.createMixNode(SUB, SESSION_ID, planMixDto);
      expect(result.branchName).toBe('fork/mix-result');
      expect(result.commitSha).toBe('user-sha');
    });

    it('slugifies the plan title and de-dupes against every branchName already in the session', async () => {
      const existingPlan = {
        nodeId: 'plan-existing', parentId: 'learn-base', kind: 'PLAN', branchName: 'fork/mix-result',
        commitSha: 'x', title: 'Existing plan', query: 'q', sections: [],
      };
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [codeRoot, codeHead, codeUser, learnBase, existingPlan],
      });
      const result = await service.createMixNode(SUB, SESSION_ID, planMixDto);
      expect(result.branchName).toBe('fork/mix-result-2');
    });

    it("falls back to the root CODE node's own commit when there is no further chain", async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [codeRoot, learnBase] });
      const result = await service.createMixNode(SUB, SESSION_ID, planMixDto);
      expect(result.branchName).toBe('fork/mix-result');
      expect(result.commitSha).toBe('root-sha');
    });

    it('plan-from-a-fresh-BRANCH-root forks from the BRANCH node\'s own commit when the lane has no CODE commits yet (Phase D lane-tip fallback)', async () => {
      const freshBranchRoot = {
        nodeId: 'branch-root', parentId: null, kind: 'BRANCH', branchName: 'main', commitSha: 'branch-sha',
        title: 'branch', query: 'q', sections: [{ id: 's1', heading: 'H', body: 'B' }] as Array<{ id: string; heading: string; body: string }>,
      };
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [freshBranchRoot] });
      const result = await service.createMixNode(SUB, SESSION_ID, { ...planMixDto, parentNodeId: 'branch-root', sourceNodeIds: [] });
      expect(result.branchName).toBe('fork/mix-result');
      expect(result.commitSha).toBe('branch-sha');
    });

    it('omits branchName/commitSha when the session has no CODE root (legacy learn-only session)', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [parentNode] });
      const result = await service.createMixNode(SUB, SESSION_ID, { ...planMixDto, parentNodeId: PARENT_NODE_ID });
      expect(result.branchName).toBeUndefined();
      expect(result.commitSha).toBeUndefined();
    });

    it('never sets branchName/commitSha on a plain MIX node (plan:false)', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [codeRoot, codeHead, codeUser, learnBase] });
      // A non-plan mix requires at least one source (unlike plan mode) — planMixDto's
      // empty sourceNodeIds is plan-only, so this override supplies one.
      const result = await service.createMixNode(SUB, SESSION_ID, { ...planMixDto, plan: false, sourceNodeIds: ['code-root'] });
      expect(result.kind).toBe('MIX');
      expect(result.branchName).toBeUndefined();
      expect(result.commitSha).toBeUndefined();
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

  describe('createPrNode', () => {
    const mainRoot = {
      nodeId: 'main-root', parentId: null, kind: 'CODE', branchName: 'main', commitSha: 'root-sha',
      title: 'Root', query: 'root', createdAt: '2026-01-01T00:00:00.000Z', sections: [] as Array<{ heading: string; body: string }>,
    };
    const featureBranch = {
      nodeId: 'branch1', parentId: 'main-root', kind: 'BRANCH', branchName: 'feature/x', commitSha: 'root-sha',
      title: 'branch', query: 'q', createdAt: '2026-01-01T00:00:01.000Z', sections: [] as Array<{ heading: string; body: string }>,
    };
    const featureCommit = {
      nodeId: 'feature-commit', parentId: 'branch1', kind: 'CODE', branchName: 'feature/x', commitSha: 'feat-sha',
      title: 'Feat', query: 'feat', createdAt: '2026-01-01T00:00:02.000Z', sections: [] as Array<{ heading: string; body: string }>,
    };
    const dto = { sourceNodeId: 'feature-commit', targetNodeId: 'main-root' };

    beforeEach(() => {
      mockDb.putNode.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('creates a MERGE node parented on the target tip, with mergeFromNodeId/prStatus set', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [mainRoot, featureBranch, featureCommit] });
      const result = await service.createPrNode(SUB, SESSION_ID, dto);
      expect(result.kind).toBe('MERGE');
      expect(result.parentId).toBe('main-root'); // main has no further commits — root IS the tip
      expect(result.branchName).toBe('main');
      expect(result.mergeFromNodeId).toBe('feature-commit');
      expect(result.prStatus).toBe('open');
    });

    it('rejects when source and target resolve to the same branch', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [mainRoot, featureBranch, featureCommit] });
      await expect(
        service.createPrNode(SUB, SESSION_ID, { sourceNodeId: 'feature-commit', targetNodeId: 'branch1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a source node with no commit (e.g. a BRANCH node)', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [mainRoot, featureBranch, featureCommit] });
      await expect(
        service.createPrNode(SUB, SESSION_ID, { sourceNodeId: 'branch1', targetNodeId: 'main-root' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects opening a second PR onto a target tip that already has one open', async () => {
      const existingOpenPr = {
        nodeId: 'merge-existing', parentId: 'main-root', kind: 'MERGE', branchName: 'main', prStatus: 'open',
        mergeFromNodeId: 'feature-commit', title: 'PR', query: 'PR', createdAt: '2026-01-01T00:00:03.000Z', sections: [],
      };
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [mainRoot, featureBranch, featureCommit, existingOpenPr] });
      await expect(service.createPrNode(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the source node does not exist', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [mainRoot] });
      await expect(service.createPrNode(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the target node does not exist', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [featureBranch, featureCommit] });
      await expect(service.createPrNode(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('mergePrNode', () => {
    const mainRoot = {
      nodeId: 'main-root', parentId: null, kind: 'CODE', branchName: 'main', commitSha: 'root-sha',
      title: 'Root', query: 'root', createdAt: '2026-01-01T00:00:00.000Z', sections: [] as Array<{ heading: string; body: string }>,
    };
    const featureBranch = {
      nodeId: 'branch1', parentId: 'main-root', kind: 'BRANCH', branchName: 'feature/x', commitSha: 'root-sha',
      title: 'branch', query: 'q', createdAt: '2026-01-01T00:00:01.000Z', sections: [] as Array<{ heading: string; body: string }>,
    };
    const featureCommit = {
      nodeId: 'feature-commit', parentId: 'branch1', kind: 'CODE', branchName: 'feature/x', commitSha: 'feat-sha',
      title: 'Feat', query: 'feat', createdAt: '2026-01-01T00:00:02.000Z', sections: [] as Array<{ heading: string; body: string }>,
    };
    const openMerge = {
      nodeId: 'merge1', parentId: 'main-root', kind: 'MERGE', branchName: 'main', prStatus: 'open',
      mergeFromNodeId: 'feature-commit', title: 'PR', query: 'PR', createdAt: '2026-01-01T00:00:03.000Z',
      sections: [] as Array<{ heading: string; body: string }>,
    };

    beforeEach(() => {
      mockDb.putNode.mockResolvedValue(undefined);
      mockDb.updateNode.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('spawns a merge-commit CODE node and flips the MERGE node to merged', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [mainRoot, featureBranch, featureCommit, openMerge] });
      const result = await service.mergePrNode(SUB, SESSION_ID, 'merge1');

      expect(result.commitNode.kind).toBe('CODE');
      expect(result.commitNode.parentId).toBe('merge1');
      expect(result.commitNode.branchName).toBe('main');
      expect(result.commitNode.commitMessage).toContain('feature/x');
      expect(result.commitNode.commitMessage).toContain('main');
      expect(result.mergeNode.prStatus).toBe('merged');
      expect(mockDb.updateNode).toHaveBeenCalledWith(SESSION_ID, 'merge1', { prStatus: 'merged' });
      expect(mockSessions.incrementNodeCount).toHaveBeenCalledWith(SUB, SESSION_ID, 1);
    });

    it('rejects merging a PR that is already merged', async () => {
      const merged = { ...openMerge, prStatus: 'merged' };
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [mainRoot, featureBranch, featureCommit, merged] });
      await expect(service.mergePrNode(SUB, SESSION_ID, 'merge1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects merging a node that is not a MERGE node', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [mainRoot, featureBranch, featureCommit, openMerge] });
      await expect(service.mergePrNode(SUB, SESSION_ID, 'main-root')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the node does not exist', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [mainRoot] });
      await expect(service.mergePrNode(SUB, SESSION_ID, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('walkLaneTip traverses through a merged MERGE to the new commit tip', () => {
    // main-root --(merge1, merged)--> merge-commit; a plan based off a learn
    // node hanging past the merge commit should fork from merge-commit's sha,
    // not main-root's — proving findLaneChainTip (used by createMixNode's plan
    // branch resolution) walks through a merged MERGE node.
    const mainRoot = {
      nodeId: 'main-root', parentId: null, kind: 'CODE', branchName: 'main', commitSha: 'root-sha',
      title: 'Root', query: 'root', createdAt: '2026-01-01T00:00:00.000Z', sections: [] as Array<{ heading: string; body: string }>,
    };
    const mergedMerge = {
      nodeId: 'merge1', parentId: 'main-root', kind: 'MERGE', branchName: 'main', prStatus: 'merged',
      mergeFromNodeId: 'src1', title: 'PR', query: 'PR', createdAt: '2026-01-01T00:00:01.000Z',
      sections: [] as Array<{ heading: string; body: string }>,
    };
    const mergeCommit = {
      nodeId: 'merge-commit', parentId: 'merge1', kind: 'CODE', branchName: 'main', commitSha: 'merge-sha',
      title: 'Merge', query: 'Merge', createdAt: '2026-01-01T00:00:02.000Z', sections: [] as Array<{ heading: string; body: string }>,
    };
    const learnBase = {
      nodeId: 'learn-base', parentId: 'merge-commit', kind: 'ASK', title: 'Learn', query: 'q',
      sections: [] as Array<{ heading: string; body: string }>,
    };
    const planMixDto = { parentNodeId: 'learn-base', sourceNodeIds: [] as string[], query: 'Build the thing', plan: true };

    beforeEach(() => {
      mockLlm.mixNodes.mockResolvedValue({ ...llmResult, title: 'Mix Result' });
      mockDb.putNode.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('forks from the merge-commit tip, not the pre-merge root', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [mainRoot, mergedMerge, mergeCommit, learnBase] });
      const result = await service.createMixNode(SUB, SESSION_ID, planMixDto);
      expect(result.branchName).toBe('fork/mix-result');
      expect(result.commitSha).toBe('merge-sha');
    });

    it('a still-open PR (no merge commit yet) never becomes the tip — falls back to the pre-merge commit', async () => {
      const openMerge = { ...mergedMerge, prStatus: 'open' };
      const learnBaseOnRoot = { ...learnBase, parentId: 'main-root' };
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [mainRoot, openMerge, learnBaseOnRoot] });
      const result = await service.createMixNode(SUB, SESSION_ID, planMixDto);
      expect(result.commitSha).toBe('root-sha');
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
    const agentEvents = [
      { kind: 'text' as const, payload: 'Reading files' },
      { kind: 'terminal' as const, payload: 'tests passed' },
      { kind: 'file_edit' as const, payload: 'src/fetch.ts' },
    ];
    const agentFinal = {
      commitMessage: 'Add retry logic to fetch client',
      diffSummary: {
        filesChanged: 1, additions: 10, deletions: 2,
        files: [{ path: 'src/fetch.ts', status: 'modified', additions: 10, deletions: 2 }],
      },
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
      runnerYields(agentEvents, agentFinal);
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

    it('trims trailing punctuation the 5-word title cut leaves behind', async () => {
      runnerYields(agentEvents, { ...agentFinal, commitMessage: 'feat: Scaffold CLI with Commander, config loader, and S3 client' });
      const send = () => {};

      await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, send);

      expect(mockDb.updateNode).toHaveBeenCalledWith(
        SESSION_ID,
        expect.any(String),
        expect.objectContaining({ title: 'feat: Scaffold CLI with Commander' }),
      );
    });

    it('emits a heartbeat agent-event between init and the first real one when the runner is slow, and never persists heartbeats', async () => {
      jest.useFakeTimers();
      try {
        let releaseFirstYield: () => void = () => {};
        const firstYieldGate = new Promise<void>((resolve) => { releaseFirstYield = resolve; });
        // Simulates MockAgentRunner: nothing yielded until the full (mocked)
        // LLM transcript resolves.
        agentRunner.run.mockImplementation(async function* () {
          await firstYieldGate;
          yield { type: 'event', event: { seq: 0, ts: 't', kind: 'text', payload: 'Reading files' } };
          yield {
            type: 'result',
            result: {
              commitMessage: 'msg', commitSha: null,
              diffSummary: { filesChanged: 0, additions: 0, deletions: 0, files: [] },
              inputTokens: 1, outputTokens: 1, model: 'm',
            },
          };
        });

        const received: Array<{ type: string; event?: AgentEvent }> = [];
        const send = (d: object) => received.push(d as { type: string; event?: AgentEvent });

        const runPromise = service.createCodeNodeStreaming(SUB, SESSION_ID, dto, send);

        // Flush the promise chain (checkCredit → getSession → putNode/putAgentRun
        // → init → heartbeat timer created) — all real awaits, no timers, ahead
        // of this point — before advancing fake time.
        for (let i = 0; i < 20; i++) await Promise.resolve();

        jest.advanceTimersByTime(3100); // one heartbeat tick before the runner has yielded anything
        releaseFirstYield();
        await runPromise;

        const initIdx = received.findIndex((e) => e.type === 'init');
        const heartbeatIdx = received.findIndex((e) => e.type === 'agent-event' && (e.event?.seq ?? 0) < 0);
        const realIdx = received.findIndex((e) => e.type === 'agent-event' && (e.event?.seq ?? 0) >= 0);

        expect(heartbeatIdx).toBeGreaterThan(-1);
        expect(heartbeatIdx).toBeGreaterThan(initIdx);
        expect(heartbeatIdx).toBeLessThan(realIdx);

        const doneCall = mockDb.updateAgentRun.mock.calls.find((c) => (c[2] as { status?: string }).status === 'done');
        const persisted = JSON.parse((doneCall![2] as { events: string }).events) as AgentEvent[];
        expect(persisted.every((e) => e.seq >= 0)).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('resolves branchName from the nearest BRANCH ancestor, falling back through repoRef.defaultBranch to main', async () => {
      await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());
      const ctxArg = agentRunner.run.mock.calls[0][0];
      expect(ctxArg.branchName).toBe('main'); // no BRANCH ancestor, no project
      expect(ctxArg.planDoc).toContain('Do the thing');
    });

    it("resolves the PLAN node's own branchName (F1 fork point) when there is no BRANCH ancestor", async () => {
      const planWithBranch = { ...planNode, branchName: 'fork/add-retry-logic', commitSha: 'plan-base-sha' };
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [planWithBranch] });
      await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());
      const ctxArg = agentRunner.run.mock.calls[0][0];
      expect(ctxArg.branchName).toBe('fork/add-retry-logic');
    });

    it('still prefers a BRANCH ancestor branchName over a PLAN branchName (BRANCH beats PLAN in the seam)', async () => {
      const branchNode = {
        nodeId: 'branch-1', parentId: 'plan-1', kind: 'BRANCH', branchName: 'feature/manual',
        commitSha: 'branch-sha', title: 'branch', query: 'q',
      };
      const planWithBranch = { ...planNode, branchName: 'fork/should-not-win', commitSha: 'plan-base-sha' };
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [planWithBranch, branchNode] });
      await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, parentNodeId: 'branch-1' }, jest.fn());
      const ctxArg = agentRunner.run.mock.calls[0][0];
      expect(ctxArg.branchName).toBe('feature/manual');
    });

    it('bills usage with the runner result token counts and CODE kind', async () => {
      await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());
      expect(mockUsers.billUsage).toHaveBeenCalledWith(SUB, 500, 300, 'CODE', SESSION_ID, expect.any(String), BRANCH_DEFAULT_MODEL);
    });

    it('assigns commitSha only at done — the initial node/init event carries none', async () => {
      const received: Array<{ type: string; node?: { commitSha?: string } }> = [];
      await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, (d) => received.push(d as typeof received[number]));
      const init = received.find((e) => e.type === 'init')!;
      const done = received.find((e) => e.type === 'done')!;
      expect(init.node!.commitSha).toBeUndefined();
      expect(done.node!.commitSha).toBeDefined();
      expect(mockDb.updateNode).toHaveBeenCalledWith(SESSION_ID, expect.any(String), expect.objectContaining({ commitSha: expect.any(String) }));
    });

    it('marks the node and AgentRun as error and emits an error event when the agent runner fails mid-stream, without throwing', async () => {
      runnerYields(agentEvents, new Error('boom'));
      const received: Array<{ type: string }> = [];

      await expect(
        service.createCodeNodeStreaming(SUB, SESSION_ID, dto, (d) => received.push(d as { type: string })),
      ).resolves.toBeUndefined();

      expect(mockDb.updateNode).toHaveBeenCalledWith(SESSION_ID, expect.any(String), expect.objectContaining({ agentStatus: 'error' }));
      expect(mockDb.updateAgentRun).toHaveBeenCalledWith(SESSION_ID, expect.any(String), expect.objectContaining({ status: 'error' }));
      expect(received.some((e) => e.type === 'error')).toBe(true);
      expect(mockUsers.billUsage).not.toHaveBeenCalled();
    });

    it('marks the node and AgentRun as error when the runner ends without yielding a result', async () => {
      agentRunner.run.mockImplementation(async function* () {
        yield { type: 'event', event: { seq: 0, ts: 't', kind: 'text', payload: 'hi' } };
      });
      const received: Array<{ type: string }> = [];

      await expect(
        service.createCodeNodeStreaming(SUB, SESSION_ID, dto, (d) => received.push(d as { type: string })),
      ).resolves.toBeUndefined();

      expect(mockDb.updateNode).toHaveBeenCalledWith(SESSION_ID, expect.any(String), expect.objectContaining({ agentStatus: 'error' }));
      expect(received.some((e) => e.type === 'error')).toBe(true);
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

    it('passes dto.environment through to runners.resolve()', async () => {
      await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, environment: 'cloud' }, jest.fn());
      expect(mockRunners.resolve).toHaveBeenCalledWith('cloud');
    });

    it('propagates a BadRequestException from runners.resolve() before any persistence', async () => {
      mockRunners.resolve.mockImplementationOnce(() => { throw new BadRequestException("Execution environment 'cloud' is not available on this server"); });

      await expect(
        service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, environment: 'cloud' }, jest.fn()),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockDb.putNode).not.toHaveBeenCalled();
      expect(mockDb.putAgentRun).not.toHaveBeenCalled();
    });

    it('threads attachments into the agent run context', async () => {
      const attachments = [{ name: 'notes.md', content: '# context' }];
      await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, attachments }, jest.fn());
      const ctxArg = agentRunner.run.mock.calls[0][0];
      expect(ctxArg.attachments).toEqual(attachments);
    });

    it('leaves attachments undefined when none are sent', async () => {
      await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());
      const ctxArg = agentRunner.run.mock.calls[0][0];
      expect(ctxArg.attachments).toBeUndefined();
    });

    describe('repo resolution (project repoRef → ctx.repo)', () => {
      const githubProject = (overrides: Partial<{ private: boolean }> = {}) => ({
        projectId: 'proj-1',
        repoRef: { provider: 'github', owner: 'acme', repo: 'widgets', defaultBranch: 'main', url: 'https://github.com/acme/widgets', ...overrides },
        plugins: [],
      });

      beforeEach(() => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [planNode], projectId: 'proj-1' });
      });

      it("provider 'new' passes ctx.repo.init through — no clone, no LOCAL_AGENT_REPO_* fallback", async () => {
        mockDb.getProject.mockResolvedValue({
          projectId: 'proj-1',
          repoRef: { provider: 'new', owner: 'you', repo: 'widgets', defaultBranch: 'main', url: 'mock://new/widgets' },
          plugins: [],
        });

        await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());

        const ctxArg = agentRunner.run.mock.calls[0][0];
        expect(ctxArg.repo).toEqual({ init: { defaultBranch: 'main' } });
      });

      it("provider 'github-mock' + explicit cloud environment 400s before any persistence", async () => {
        mockDb.getProject.mockResolvedValue({
          projectId: 'proj-1',
          repoRef: { provider: 'github-mock', owner: 'acme', repo: 'widgets', defaultBranch: 'main', url: 'mock://acme/widgets' },
          plugins: [],
        });

        await expect(
          service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, environment: 'cloud' }, jest.fn()),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(mockDb.putNode).not.toHaveBeenCalled();
      });

      it("provider 'github-mock' without an explicit cloud request runs fine (mock never reads ctx.repo)", async () => {
        mockDb.getProject.mockResolvedValue({
          projectId: 'proj-1',
          repoRef: { provider: 'github-mock', owner: 'acme', repo: 'widgets', defaultBranch: 'main', url: 'mock://acme/widgets' },
          plugins: [],
        });

        await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());

        const ctxArg = agentRunner.run.mock.calls[0][0];
        expect(ctxArg.repo).toBeUndefined();
      });

      it('private github repo with no covering installation 400s before any persistence', async () => {
        mockDb.getProject.mockResolvedValue(githubProject({ private: true }));
        mockGithubApp.mintInstallationToken.mockResolvedValue(null);

        await expect(service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn())).rejects.toBeInstanceOf(BadRequestException);
        expect(mockDb.putNode).not.toHaveBeenCalled();
        expect(mockGithubApp.mintInstallationToken).toHaveBeenCalledWith(SUB, 'acme', 'widgets');
      });

      it('private github repo with a covering installation clones via an x-access-token URL', async () => {
        mockDb.getProject.mockResolvedValue(githubProject({ private: true }));
        mockGithubApp.mintInstallationToken.mockResolvedValue('ghs_installtoken');

        await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());

        const ctxArg = agentRunner.run.mock.calls[0][0];
        expect(ctxArg.repo).toEqual({ cloneUrl: 'https://x-access-token:ghs_installtoken@github.com/acme/widgets.git' });
      });

      it('public github repo clones the plain repo URL — no installation lookup', async () => {
        mockDb.getProject.mockResolvedValue(githubProject());

        await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());

        const ctxArg = agentRunner.run.mock.calls[0][0];
        expect(ctxArg.repo).toEqual({ cloneUrl: 'https://github.com/acme/widgets.git' });
        expect(mockGithubApp.mintInstallationToken).not.toHaveBeenCalled();
      });
    });

    describe('auto-branch on a parallel instruction', () => {
      const codeParent = {
        nodeId: 'code-1', parentId: 'plan-1', kind: 'CODE', title: 'Base commit', query: 'Base commit',
        sections: [], commitSha: 'basecommitsha1234567890', branchName: 'main',
      };
      const codeDto = { parentNodeId: 'code-1', instruction: 'Add a caching layer' };

      function childOf(status: 'running' | 'done' | 'error') {
        return {
          nodeId: 'code-2', parentId: 'code-1', kind: 'CODE', title: 'child', query: 'child',
          sections: [], agentStatus: status, createdAt: '2026-01-01T00:00:00.000Z',
        };
      }

      it('forks a BRANCH node and emits branch-init BEFORE init when the existing CODE child is done', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [planNode, codeParent, childOf('done')] });
        const received: Array<{ type: string; node?: { nodeId: string; kind: string; parentId: string; commitSha: string } }> = [];

        await service.createCodeNodeStreaming(SUB, SESSION_ID, codeDto, (d) => received.push(d as typeof received[number]));

        expect(received[0].type).toBe('branch-init');
        expect(received[0].node!.kind).toBe('BRANCH');
        expect(received[0].node!.parentId).toBe('code-1');
        expect(received[0].node!.commitSha).toBe(codeParent.commitSha);
        expect(received[1].type).toBe('init');
        expect(received[1].node!.parentId).toBe(received[0].node!.nodeId);
        // Branch persisted (+1 node count) then the CODE node itself (+1 more).
        expect(mockDb.putNode).toHaveBeenCalledWith(expect.objectContaining({ kind: 'BRANCH', parentId: 'code-1' }));
        expect(mockSessions.incrementNodeCount).toHaveBeenCalledTimes(2);
      });

      it.each([['running'], ['error']] as const)(
        'does NOT branch when the existing CODE child is %s — retry semantics, direct child',
        async (status) => {
          mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [planNode, codeParent, childOf(status)] });
          const received: Array<{ type: string; node?: { parentId: string } }> = [];

          await service.createCodeNodeStreaming(SUB, SESSION_ID, codeDto, (d) => received.push(d as typeof received[number]));

          expect(received.some((e) => e.type === 'branch-init')).toBe(false);
          expect(received[0].type).toBe('init');
          expect(received[0].node!.parentId).toBe('code-1');
          expect(mockSessions.incrementNodeCount).toHaveBeenCalledTimes(1);
        },
      );

      it('does not branch when the CODE parent has no existing CODE children', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [planNode, codeParent] });
        const received: Array<{ type: string }> = [];

        await service.createCodeNodeStreaming(SUB, SESSION_ID, codeDto, (d) => received.push(d as { type: string }));

        expect(received.some((e) => e.type === 'branch-init')).toBe(false);
        expect(received[0].type).toBe('init');
      });
    });
  });
});
