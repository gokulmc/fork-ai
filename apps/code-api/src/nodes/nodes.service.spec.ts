import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodesService } from './nodes.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { LlmService } from '@/llm/llm.service';
import { BRANCH_DEFAULT_MODEL, CLOUD_CODE_MODEL_ID, PLAN_MODEL_ID, resolveBranchModel } from '@/llm/models';
import { SessionsService } from '@/sessions/sessions.service';
import { UsersService } from '@/users/users.service';
import { GithubAppService } from '@/github/github-app.service';
import { ApnsService } from '@/devices/apns.service';
import { HighlightsService } from '@/highlights/highlights.service';
import { AgentRunFinal, AgentRunContext } from '@/agent/agent-runner';
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
  incrementProjectBranchCount: jest.fn(),
};

const mockLlm = {
  expandSection: jest.fn(),
  followUpFromHighlight: jest.fn(),
  answerInline: jest.fn(),
  mixNodes: jest.fn(),
  generateCodeMeta: jest.fn(),
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
  placeHold: jest.fn(),
  reconcileHold: jest.fn(),
};

const mockGithubApp = {
  mintInstallationToken: jest.fn(),
  createPullRequest: jest.fn(),
  mergePullRequest: jest.fn(),
  createBranchRef: jest.fn(),
};

const mockApns = {
  sendToUser: jest.fn().mockResolvedValue(undefined),
};

const mockHighlights = {
  create: jest.fn(),
};

const agentRunner = {
  run: jest.fn(),
};

// Stands in for the AGENT_RUNNER_REGISTRY seam — resolves to `agentRunner`
// by default so every existing createCodeNodeStreaming test keeps working
// unchanged; tests that care about environment routing override resolve().
// isCloud defaults to false (mirrors RunnerRegistry's default env being
// non-cloud in every existing test's implicit setup) — cloud-billing tests
// override it explicitly.
const mockRunners = {
  resolve: jest.fn(() => agentRunner),
  isCloud: jest.fn(() => false),
};

const mockConfig = {
  get: jest.fn((key: string) => (key === 'billing.creditMultiplier' ? 1.5 : undefined)),
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
        { provide: ApnsService, useValue: mockApns },
        { provide: HighlightsService, useValue: mockHighlights },
        { provide: ConfigService, useValue: mockConfig },
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

  describe('createNode — inline mode', () => {
    const inlineDto = {
      kind: 'ASK' as const,
      parentNodeId: PARENT_NODE_ID,
      fromSection: 'sec-1',
      query: 'Why does this work?',
      highlightText: 'gradient descent',
      inline: true,
    };

    const inlineLlmResult = {
      answer: 'Because the loss surface is convex here.',
      usage: { inputTokens: 40, outputTokens: 20 },
    };

    beforeEach(() => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      mockLlm.answerInline.mockResolvedValue(inlineLlmResult);
      mockDb.putNode.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
    });

    it('appends exactly one section to the parent and does not call incrementNodeCount', async () => {
      const result = await service.createNode(SUB, SESSION_ID, inlineDto);

      expect(mockLlm.answerInline).toHaveBeenCalledWith(
        [{ title: 'Root Title', query: 'Root query' }],
        'gradient descent',
        'Why does this work?',
        BRANCH_DEFAULT_MODEL,
        false,
        70,
        undefined, // extraContext (parent is not a CODE node)
      );

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]).toMatchObject({ heading: '', body: inlineLlmResult.answer, askedQuery: inlineDto.query });

      expect(mockDb.putNode).toHaveBeenCalledTimes(1);
      const putArg = mockDb.putNode.mock.calls[0][0];
      expect(putArg.nodeId).toBe(PARENT_NODE_ID);

      expect(mockSessions.incrementNodeCount).not.toHaveBeenCalled();
    });

    it('bills usage against the parent nodeId, not a new node', async () => {
      await service.createNode(SUB, SESSION_ID, inlineDto);
      expect(mockUsers.billUsage).toHaveBeenCalledWith(
        SUB, 40, 20, 'ASK', SESSION_ID, PARENT_NODE_ID, BRANCH_DEFAULT_MODEL,
      );
    });

    it('uses sectionBody as the anchor text for DEEPER', async () => {
      await service.createNode(SUB, SESSION_ID, {
        ...inlineDto, kind: 'DEEPER', highlightText: undefined, sectionBody: 'The chain rule is...',
      });
      expect(mockLlm.answerInline).toHaveBeenCalledWith(
        expect.anything(), 'The chain rule is...', expect.anything(), expect.anything(), expect.anything(), expect.anything(), undefined,
      );
    });

    it('throws BadRequestException when the anchor text is missing', async () => {
      await expect(
        service.createNode(SUB, SESSION_ID, { ...inlineDto, highlightText: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('createInlineNote — "Explain" (#237 Phase 1b)', () => {
    const dto = {
      nodeId: PARENT_NODE_ID,
      sectionId: 'sec-1',
      text: 'gradient descent',
      start: 10,
      end: 27,
      question: 'Why does this work?',
    };

    const inlineLlmResult = {
      answer: 'Because the loss surface is convex here.',
      usage: { inputTokens: 40, outputTokens: 20 },
    };

    const savedHighlight = {
      PK: `SESSION#${SESSION_ID}`,
      SK: 'HL#hl-1',
      hlId: 'hl-1',
      nodeId: PARENT_NODE_ID,
      sectionId: 'sec-1',
      text: 'gradient descent',
      start: 10,
      end: 27,
      bg: 'note',
      fg: null,
      note: inlineLlmResult.answer,
      noteQuestion: dto.question,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    beforeEach(() => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      mockLlm.answerInline.mockResolvedValue(inlineLlmResult);
      mockHighlights.create.mockResolvedValue(savedHighlight);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
    });

    it('writes a highlight carrying the note, with the "note" sentinel bg', async () => {
      const result = await service.createInlineNote(SUB, SESSION_ID, dto);

      expect(mockLlm.answerInline).toHaveBeenCalledWith(
        [{ title: 'Root Title', query: 'Root query' }],
        'gradient descent',
        'Why does this work?',
        BRANCH_DEFAULT_MODEL,
        false,
        40,
        undefined, // extraContext (node is not a CODE node)
      );

      expect(mockHighlights.create).toHaveBeenCalledWith(SUB, SESSION_ID, {
        nodeId: PARENT_NODE_ID,
        sectionId: 'sec-1',
        text: 'gradient descent',
        start: 10,
        end: 27,
        bg: 'note',
        fg: null,
        note: inlineLlmResult.answer,
        noteQuestion: dto.question,
      });

      expect(result).toEqual(savedHighlight);
      expect(result.noteQuestion).toBe('Why does this work?');
    });

    it('bills usage against the node, touches session updatedAt, and never creates a node', async () => {
      await service.createInlineNote(SUB, SESSION_ID, dto);

      expect(mockUsers.billUsage).toHaveBeenCalledWith(
        SUB, 40, 20, 'ASK', SESSION_ID, PARENT_NODE_ID, BRANCH_DEFAULT_MODEL,
      );
      expect(mockSessions.touchUpdatedAt).toHaveBeenCalledWith(SUB, SESSION_ID);
      expect(mockSessions.incrementNodeCount).not.toHaveBeenCalled();
      expect(mockDb.putNode).not.toHaveBeenCalled();
    });

    it('threads CODE-parent context into answerInline when the highlight is on a CODE node', async () => {
      const codeNode = {
        ...parentNode,
        kind: 'CODE',
        commitMessage: 'Add retry logic',
        diffSummary: { filesChanged: 1, additions: 5, deletions: 1, files: [{ path: 'src/retry.ts', status: 'modified', additions: 5, deletions: 1 }] },
      };
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [codeNode] });
      mockDb.getAgentRun.mockResolvedValue(null);

      await service.createInlineNote(SUB, SESSION_ID, dto);

      const extraContext = mockLlm.answerInline.mock.calls[0].at(-1);
      expect(extraContext).toContain('Add retry logic');
      expect(extraContext).toContain('src/retry.ts');
    });

    it('throws NotFoundException when the node does not exist', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [] });
      await expect(service.createInlineNote(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(mockLlm.answerInline).not.toHaveBeenCalled();
      expect(mockHighlights.create).not.toHaveBeenCalled();
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

    it('sets okr when provided (#220)', async () => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      mockDb.getNode.mockResolvedValue({ nodeId: 'n1', title: 'Old' });
      mockDb.updateNode.mockResolvedValue(undefined);
      const okr = { objective: 'Ship the retry logic', keyResults: ['p99 < 200ms'] };
      await service.updateNode(SUB, SESSION_ID, 'n1', { okr });
      expect(mockDb.updateNode).toHaveBeenCalledWith(SESSION_ID, 'n1', { okr });
    });

    it('leaves okr unchanged when the field is simply omitted from the DTO', async () => {
      mockSessions.getSession.mockResolvedValue(fullSession);
      mockDb.getNode.mockResolvedValue({ nodeId: 'n1', title: 'Old', okr: { objective: 'Existing', keyResults: [] } });
      mockDb.updateNode.mockResolvedValue(undefined);
      await service.updateNode(SUB, SESSION_ID, 'n1', { title: 'New title' });
      expect(mockDb.updateNode).toHaveBeenCalledWith(SESSION_ID, 'n1', { title: 'New title' });
      const updates = mockDb.updateNode.mock.calls[0][2] as Record<string, unknown>;
      expect('okr' in updates).toBe(false);
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

    it('plan:true always synthesizes with Opus (PLAN_MODEL_ID), ignoring dto.model', async () => {
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [parentNode, { ...sourceNode, kind: 'ASK' }],
      });
      const result = await service.createMixNode(SUB, SESSION_ID, { ...mixDto, plan: true, model: 'haiku' });
      expect(result.model).toBe(PLAN_MODEL_ID);
      expect(result.model).toBe('claude-opus-5');
    });

    it('plan:false (MIX) resolves the model from dto.model via resolveBranchModel', async () => {
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [parentNode, { ...sourceNode, kind: 'CODE' }],
      });
      const result = await service.createMixNode(SUB, SESSION_ID, { ...mixDto, model: 'sonnet' });
      expect(result.model).toBe(resolveBranchModel('sonnet'));
      expect(result.model).not.toBe(PLAN_MODEL_ID);
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

  describe('createMixNode — fromText renders source titles, not raw ULIDs', () => {
    const baseMixDto = { parentNodeId: PARENT_NODE_ID, query: 'Combine these' };
    const baseSource = { ...parentNode, sections: [] as Array<{ heading: string; body: string }> };

    beforeEach(() => {
      mockLlm.mixNodes.mockResolvedValue({ ...llmResult, title: 'Mix Result' });
      mockDb.putNode.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('joins source node titles with " · ", not their ULIDs', async () => {
      const sourceA = { ...baseSource, nodeId: '01HZSOURCEA', title: 'Auth flow research' };
      const sourceB = { ...baseSource, nodeId: '01HZSOURCEB', title: 'Rate limiting notes' };
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [parentNode, sourceA, sourceB],
      });
      const result = await service.createMixNode(SUB, SESSION_ID, {
        ...baseMixDto,
        sourceNodeIds: [sourceA.nodeId, sourceB.nodeId],
      });
      expect(result.fromText).toBe('Auth flow research · Rate limiting notes');
      expect(result.fromText).not.toMatch(/01HZSOURCE/);
    });

    it('caps at 3 titles and appends a "+N more" suffix for larger mixes', async () => {
      const sources = ['A', 'B', 'C', 'D', 'E'].map((label) => ({
        ...baseSource, nodeId: `01HZSOURCE${label}`, title: `Source ${label}`,
      }));
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [parentNode, ...sources],
      });
      const result = await service.createMixNode(SUB, SESSION_ID, {
        ...baseMixDto,
        sourceNodeIds: sources.map((s) => s.nodeId),
      });
      expect(result.fromText).toBe('Source A · Source B · Source C +2 more');
    });

    it('plan:true with zero sources uses the base node\'s own title, not an empty string', async () => {
      const base = { ...parentNode, title: 'Base Node Title', sections: [{ id: 's1', heading: 'H', body: 'Body' }] };
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [base] });
      const result = await service.createMixNode(SUB, SESSION_ID, { ...baseMixDto, sourceNodeIds: [], plan: true });
      expect(result.fromText).toBe('Base Node Title');
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
    const dto = { parentNodeId: PARENT_NODE_ID, title: 'Retry logic' };

    beforeEach(() => {
      mockDb.putNode.mockResolvedValue(undefined);
      mockDb.incrementProjectBranchCount.mockResolvedValue(undefined);
      mockDb.getProject.mockResolvedValue(null);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
    });

    it('creates a BRANCH node forking from the parent CODE node commit, slugifying the title (#219)', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [codeParent] });
      const result = await service.createBranchNode(SUB, SESSION_ID, dto);
      expect(result.kind).toBe('BRANCH');
      expect(result.title).toBe('Retry logic');
      expect(result.branchName).toBe('fork/retry-logic');
      expect(result.commitSha).toBe('abcdef1234567890');
      expect(result.parentId).toBe(PARENT_NODE_ID);
      expect(result.query).toBe('Fork from abcdef1');
    });

    it('dedupes a duplicate title into a -2 slug instead of rejecting it (#219)', async () => {
      mockSessions.getSession.mockResolvedValue({
        ...fullSession,
        nodes: [
          codeParent,
          { nodeId: '01HZEXIST', parentId: PARENT_NODE_ID, kind: 'BRANCH', branchName: 'fork/retry-logic', title: 'Retry logic', query: 'x', sections: [] },
        ],
      });
      const result = await service.createBranchNode(SUB, SESSION_ID, dto);
      expect(result.branchName).toBe('fork/retry-logic-2');
      expect(result.title).toBe('Retry logic');
    });

    it('bumps the project branchCount by 1 when the session belongs to a Project', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [codeParent] });
      await service.createBranchNode(SUB, SESSION_ID, dto);
      expect(mockDb.incrementProjectBranchCount).toHaveBeenCalledWith(SUB, 'proj-1', 1);
    });

    it('does not touch branchCount for a bare (non-project) session', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [codeParent] });
      await service.createBranchNode(SUB, SESSION_ID, dto);
      expect(mockDb.incrementProjectBranchCount).not.toHaveBeenCalled();
    });

    it('rejects a non-CODE parent', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [{ ...parentNode, kind: 'QUERY' }] });
      await expect(service.createBranchNode(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a CODE parent with no commit yet', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [{ ...parentNode, kind: 'CODE' }] });
      await expect(service.createBranchNode(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when parent node does not exist', async () => {
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [] });
      await expect(service.createBranchNode(SUB, SESSION_ID, dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    describe('eager branch push (#216)', () => {
      const githubProject = { projectId: 'proj-1', repoRef: { provider: 'github', owner: 'acme', repo: 'widgets', defaultBranch: 'main', url: 'https://github.com/acme/widgets' }, plugins: [] };
      const pushedCodeParent = { ...codeParent, pushed: true };

      it('creates the real ref and marks the branch node pushed:true when createBranchRef reports "created"', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [pushedCodeParent] });
        mockDb.getProject.mockResolvedValue(githubProject);
        mockGithubApp.createBranchRef.mockResolvedValue('created');

        const result = await service.createBranchNode(SUB, SESSION_ID, dto);

        expect(mockGithubApp.createBranchRef).toHaveBeenCalledWith(SUB, 'acme', 'widgets', 'fork/retry-logic', 'abcdef1234567890');
        expect(result.pushed).toBe(true);
      });

      it('marks pushed:true when createBranchRef reports "exists"', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [pushedCodeParent] });
        mockDb.getProject.mockResolvedValue(githubProject);
        mockGithubApp.createBranchRef.mockResolvedValue('exists');

        const result = await service.createBranchNode(SUB, SESSION_ID, dto);

        expect(result.pushed).toBe(true);
      });

      it('leaves pushed unset when createBranchRef reports "skipped"', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [pushedCodeParent] });
        mockDb.getProject.mockResolvedValue(githubProject);
        mockGithubApp.createBranchRef.mockResolvedValue('skipped');

        const result = await service.createBranchNode(SUB, SESSION_ID, dto);

        expect(result.pushed).toBeUndefined();
      });

      it('never attempts a ref for a github-mock repo', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [pushedCodeParent] });
        mockDb.getProject.mockResolvedValue({ ...githubProject, repoRef: { ...githubProject.repoRef, provider: 'github-mock' } });

        const result = await service.createBranchNode(SUB, SESSION_ID, dto);

        expect(mockGithubApp.createBranchRef).not.toHaveBeenCalled();
        expect(result.pushed).toBeUndefined();
      });

      it('never attempts a ref when the parent commit was not itself pushed', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [codeParent] }); // no pushed:true
        mockDb.getProject.mockResolvedValue(githubProject);

        const result = await service.createBranchNode(SUB, SESSION_ID, dto);

        expect(mockGithubApp.createBranchRef).not.toHaveBeenCalled();
        expect(result.pushed).toBeUndefined();
      });

      it('never attempts a ref for a bare (non-project) session', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [pushedCodeParent] });

        const result = await service.createBranchNode(SUB, SESSION_ID, dto);

        expect(mockGithubApp.createBranchRef).not.toHaveBeenCalled();
        expect(result.pushed).toBeUndefined();
      });

      it('never throws — a createBranchRef failure just leaves the node unpushed', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [pushedCodeParent] });
        mockDb.getProject.mockResolvedValue(githubProject);
        mockGithubApp.createBranchRef.mockRejectedValue(new Error('GitHub API down'));

        const result = await service.createBranchNode(SUB, SESSION_ID, dto);
        expect(result.kind).toBe('BRANCH');
        expect(result.pushed).toBeUndefined();
      });
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

    describe('real GitHub PR (WS-E)', () => {
      const githubProject = { projectId: 'proj-1', repoRef: { provider: 'github', owner: 'acme', repo: 'widgets', defaultBranch: 'main', url: 'https://github.com/acme/widgets' }, plugins: [] };
      const pushedRoot = { ...mainRoot, pushed: true };
      const pushedFeatureCommit = { ...featureCommit, pushed: true };

      it('attempts a real PR when the project is github and both ends are pushed, persisting prNumber/prUrl with NO prError', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [pushedRoot, featureBranch, pushedFeatureCommit] });
        mockDb.getProject.mockResolvedValue(githubProject);
        mockGithubApp.createPullRequest.mockResolvedValue({ number: 7, url: 'https://github.com/acme/widgets/pull/7' });

        const result = await service.createPrNode(SUB, SESSION_ID, dto);

        expect(result.prNumber).toBe(7);
        expect(result.prUrl).toBe('https://github.com/acme/widgets/pull/7');
        expect(result.prError).toBeUndefined();
        expect(mockGithubApp.createPullRequest).toHaveBeenCalledWith(
          SUB, 'acme', 'widgets',
          expect.objectContaining({ head: 'feature/x', base: 'main', title: 'PR: feature/x → main' }),
        );
      });

      it('keeps internal-only behavior (no GitHub attempt, no prError) for a github-mock repo', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [pushedRoot, featureBranch, pushedFeatureCommit] });
        mockDb.getProject.mockResolvedValue({ ...githubProject, repoRef: { ...githubProject.repoRef, provider: 'github-mock' } });

        const result = await service.createPrNode(SUB, SESSION_ID, dto);

        expect(mockGithubApp.createPullRequest).not.toHaveBeenCalled();
        expect(result.prNumber).toBeUndefined();
        expect(result.prUrl).toBeUndefined();
        expect(result.prError).toBeUndefined();
      });

      it('keeps internal-only behavior (no GitHub attempt, no prError) when the commits were not pushed', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [mainRoot, featureBranch, featureCommit] }); // no pushed:true
        mockDb.getProject.mockResolvedValue(githubProject);

        const result = await service.createPrNode(SUB, SESSION_ID, dto);

        expect(mockGithubApp.createPullRequest).not.toHaveBeenCalled();
        expect(result.prNumber).toBeUndefined();
        expect(result.prError).toBeUndefined();
      });

      it("records prError: 'app_not_enabled' when there is no App installation (null token)", async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [pushedRoot, featureBranch, pushedFeatureCommit] });
        mockDb.getProject.mockResolvedValue(githubProject);
        mockGithubApp.createPullRequest.mockResolvedValue(null);

        const result = await service.createPrNode(SUB, SESSION_ID, dto);

        expect(result.kind).toBe('MERGE');
        expect(result.prNumber).toBeUndefined();
        expect(result.prError).toBe('app_not_enabled');
      });

      it.each(['exists', 'no_diff', 'forbidden', 'failed'] as const)(
        "records prError: '%s' when GitHub returns that typed failure, degrading to internal-only",
        async (error) => {
          mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [pushedRoot, featureBranch, pushedFeatureCommit] });
          mockDb.getProject.mockResolvedValue(githubProject);
          mockGithubApp.createPullRequest.mockResolvedValue({ error });

          const result = await service.createPrNode(SUB, SESSION_ID, dto);

          expect(result.kind).toBe('MERGE'); // the internal record still lands
          expect(result.prNumber).toBeUndefined();
          expect(result.prUrl).toBeUndefined();
          expect(result.prError).toBe(error);
        },
      );

      it("records prError: 'failed' (no throw, no 500) when the GitHub call itself throws", async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [pushedRoot, featureBranch, pushedFeatureCommit] });
        mockDb.getProject.mockResolvedValue(githubProject);
        mockGithubApp.createPullRequest.mockRejectedValue(new Error('GitHub API down'));

        await expect(service.createPrNode(SUB, SESSION_ID, dto)).resolves.toMatchObject({ kind: 'MERGE', prStatus: 'open', prError: 'failed' });
      });
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

    describe('real GitHub merge (WS-E)', () => {
      const githubProject = { projectId: 'proj-1', repoRef: { provider: 'github', owner: 'acme', repo: 'widgets', defaultBranch: 'main', url: 'https://github.com/acme/widgets' }, plugins: [] };
      const openMergeWithPr = { ...openMerge, prNumber: 7, prUrl: 'https://github.com/acme/widgets/pull/7' };

      it('merges the real GitHub PR when the MERGE node carries a prNumber', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [mainRoot, featureBranch, featureCommit, openMergeWithPr] });
        mockDb.getProject.mockResolvedValue(githubProject);
        mockGithubApp.mergePullRequest.mockResolvedValue(true);

        await service.mergePrNode(SUB, SESSION_ID, 'merge1');

        expect(mockGithubApp.mergePullRequest).toHaveBeenCalledWith(SUB, 'acme', 'widgets', 7);
      });

      it('does not attempt a GitHub merge when the MERGE node has no prNumber (internal-only PR)', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [mainRoot, featureBranch, featureCommit, openMerge] });
        mockDb.getProject.mockResolvedValue(githubProject);

        await service.mergePrNode(SUB, SESSION_ID, 'merge1');

        expect(mockGithubApp.mergePullRequest).not.toHaveBeenCalled();
      });

      it('still completes the internal merge-commit when the GitHub merge call reports failure', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [mainRoot, featureBranch, featureCommit, openMergeWithPr] });
        mockDb.getProject.mockResolvedValue(githubProject);
        mockGithubApp.mergePullRequest.mockResolvedValue(false);

        const result = await service.mergePrNode(SUB, SESSION_ID, 'merge1');

        expect(result.mergeNode.prStatus).toBe('merged');
      });

      it('still completes the internal merge-commit (no throw, no 500) when the GitHub merge call itself throws', async () => {
        mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [mainRoot, featureBranch, featureCommit, openMergeWithPr] });
        mockDb.getProject.mockResolvedValue(githubProject);
        mockGithubApp.mergePullRequest.mockRejectedValue(new Error('GitHub API down'));

        await expect(service.mergePrNode(SUB, SESSION_ID, 'merge1')).resolves.toMatchObject({ mergeNode: { prStatus: 'merged' } });
      });
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
      mockDb.updateSessionMeta.mockResolvedValue(undefined);
      mockSessions.touchUpdatedAt.mockResolvedValue(undefined);
      mockSessions.incrementNodeCount.mockResolvedValue(undefined);
      mockLlm.generateCodeMeta.mockResolvedValue({ title: 'Add Retry Logic', emoji: '🔁', lede: 'Adds retry logic to the fetch client.' });
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

    it('uses generateCodeMeta for title/emoji/lede on the done path, calling it with the haiku model', async () => {
      const received: Array<{ type: string; node?: { title?: string; emoji?: string | null; lede?: string } }> = [];
      await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, (d) => received.push(d as typeof received[number]));

      expect(mockLlm.generateCodeMeta).toHaveBeenCalledWith(
        dto.instruction,
        agentFinal.commitMessage,
        agentFinal.diffSummary,
        'claude-haiku-4-5-20251001',
      );
      expect(mockDb.updateNode).toHaveBeenCalledWith(
        SESSION_ID,
        expect.any(String),
        expect.objectContaining({ title: 'Add Retry Logic', lede: 'Adds retry logic to the fetch client.', emoji: '🔁' }),
      );
      const done = received.find((e) => e.type === 'done')!;
      expect(done.node!.title).toBe('Add Retry Logic');
      expect(done.node!.emoji).toBe('🔁');
    });

    it('falls back to commit-message truncation (and trims trailing punctuation) when generateCodeMeta errors', async () => {
      mockLlm.generateCodeMeta.mockRejectedValueOnce(new Error('llm down'));
      runnerYields(agentEvents, { ...agentFinal, commitMessage: 'feat: Scaffold CLI with Commander, config loader, and S3 client' });
      const send = () => {};

      await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, send);

      expect(mockDb.updateNode).toHaveBeenCalledWith(
        SESSION_ID,
        expect.any(String),
        expect.objectContaining({ title: 'feat: Scaffold CLI with Commander' }),
      );
      // Fallback never touches emoji — the persist-first node's null stays untouched.
      const updateArgs = mockDb.updateNode.mock.calls[0][2] as { emoji?: string };
      expect(updateArgs.emoji).toBeUndefined();
    });

    it('falls back to commit-message truncation when generateCodeMeta is unavailable (bare mock, no explicit resolve)', async () => {
      mockLlm.generateCodeMeta.mockReset(); // undoes this describe's default mockResolvedValue — simulates an unwired/empty mock
      const send = () => {};

      await expect(service.createCodeNodeStreaming(SUB, SESSION_ID, dto, send)).resolves.toBeUndefined();

      expect(mockDb.updateNode).toHaveBeenCalledWith(
        SESSION_ID,
        expect.any(String),
        expect.objectContaining({ title: expect.any(String), lede: agentFinal.commitMessage }),
      );
    });

    describe('lastRunStatus denormalization (History Continue rail)', () => {
      it("writes lastRunStatus:'running' onto the session at persist-first, before init", async () => {
        const order: string[] = [];
        mockDb.updateSessionMeta.mockImplementation((_sub: string, _sid: string, updates: { lastRunStatus?: string }) => {
          if (updates.lastRunStatus) order.push(`meta:${updates.lastRunStatus}`);
          return Promise.resolve();
        });
        const send = (d: object) => order.push(`send:${(d as { type: string }).type}`);

        await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, send);

        expect(mockDb.updateSessionMeta).toHaveBeenCalledWith(SUB, SESSION_ID, { lastRunStatus: 'running' });
        // running is written before the init event (part of the persist-first group).
        expect(order.indexOf('meta:running')).toBeLessThan(order.indexOf('send:init'));
      });

      it("writes lastRunStatus:'done' onto the session on the done path", async () => {
        await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());
        expect(mockDb.updateSessionMeta).toHaveBeenCalledWith(SUB, SESSION_ID, { lastRunStatus: 'running' });
        expect(mockDb.updateSessionMeta).toHaveBeenCalledWith(SUB, SESSION_ID, { lastRunStatus: 'done' });
      });

      it("writes lastRunStatus:'error' onto the session when the runner fails mid-stream", async () => {
        runnerYields(agentEvents, new Error('boom'));

        await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());

        expect(mockDb.updateSessionMeta).toHaveBeenCalledWith(SUB, SESSION_ID, { lastRunStatus: 'error' });
        // never a 'done' write on the error path.
        expect(mockDb.updateSessionMeta).not.toHaveBeenCalledWith(SUB, SESSION_ID, { lastRunStatus: 'done' });
      });
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
        // The mock runner never calls ctx.onPhase — the heartbeat stays on its
        // one generic default rather than the old rotating 3-message list.
        expect(received[heartbeatIdx].event!.payload).toBe('Working…');

        const doneCall = mockDb.updateAgentRun.mock.calls.find((c) => (c[2] as { status?: string }).status === 'done');
        const persisted = JSON.parse((doneCall![2] as { events: string }).events) as AgentEvent[];
        expect(persisted.every((e) => e.seq >= 0)).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('reflects real boot-phase text reported via ctx.onPhase in the heartbeat, not a rotating list', async () => {
      jest.useFakeTimers();
      try {
        let releaseFirstYield: () => void = () => {};
        const firstYieldGate = new Promise<void>((resolve) => { releaseFirstYield = resolve; });
        // Simulates CloudAgentRunner: reports real boot progress via ctx.onPhase
        // before its first real event, same as FlyProvider.provisionInApp does.
        agentRunner.run.mockImplementation(async function* (ctx: AgentRunContext) {
          ctx.onPhase?.('Provisioning machine…');
          ctx.onPhase?.('Booting sandbox (image pull, ~1 min)…');
          await firstYieldGate;
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
        for (let i = 0; i < 20; i++) await Promise.resolve();

        jest.advanceTimersByTime(3100); // one heartbeat tick after onPhase has updated the latest phase
        releaseFirstYield();
        await runPromise;

        const heartbeat = received.find((e) => e.type === 'agent-event' && (e.event?.seq ?? 0) < 0);
        expect(heartbeat!.event!.payload).toBe('Booting sandbox (image pull, ~1 min)…');
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

    it("feeds the rail's BRANCH node okr onto ctx.okr (#220)", async () => {
      const okr = { objective: 'Ship the retry logic', keyResults: ['p99 < 200ms', 'no flaky tests'] };
      const branchNode = {
        nodeId: 'branch-1', parentId: 'plan-1', kind: 'BRANCH', branchName: 'feature/manual',
        commitSha: 'branch-sha', title: 'branch', query: 'q', okr,
      };
      mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [planNode, branchNode] });
      await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, parentNodeId: 'branch-1' }, jest.fn());
      const ctxArg = agentRunner.run.mock.calls[0][0];
      expect(ctxArg.okr).toEqual(okr);
    });

    it('sets ctx.okr to null when the rail has no BRANCH node (or the BRANCH node has none)', async () => {
      await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());
      const ctxArg = agentRunner.run.mock.calls[0][0];
      expect(ctxArg.okr).toBeNull();
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

    it('persists runCostUsd on the node for a mock (non-cloud) run — hoisted above the cloud-only billing ternary so it is no longer cloud-exclusive', async () => {
      const received: Array<{ type: string; node?: { runCostUsd?: number } }> = [];
      await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, (d) => received.push(d as typeof received[number]));

      // agentFinal has no claudeCostUsd — falls back to token×priceFor(BRANCH_DEFAULT_MODEL) × creditMultiplier, same basis as the cloud path's fallback.
      expect(mockDb.updateNode).toHaveBeenCalledWith(SESSION_ID, expect.any(String), expect.objectContaining({ runCostUsd: 0.003 }));
      const done = received.find((e) => e.type === 'done')!;
      expect(done.node!.runCostUsd).toBe(0.003);
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

      it('public github repo falls back to the tokenless clone URL when no installation token is available', async () => {
        mockDb.getProject.mockResolvedValue(githubProject());
        mockGithubApp.mintInstallationToken.mockResolvedValue(null);

        await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());

        const ctxArg = agentRunner.run.mock.calls[0][0];
        expect(ctxArg.repo).toEqual({ cloneUrl: 'https://github.com/acme/widgets.git' });
        expect(mockGithubApp.mintInstallationToken).toHaveBeenCalledWith(SUB, 'acme', 'widgets');
      });

      // A tokenless clone has no push credentials — an attached PUBLIC repo would
      // otherwise clone fine but silently fail to push. Prefer a tokened clone
      // whenever an installation covers the repo, private or not.
      it('public github repo prefers a tokened clone URL when an installation token is available', async () => {
        mockDb.getProject.mockResolvedValue(githubProject());
        mockGithubApp.mintInstallationToken.mockResolvedValue('ghs_installtoken');

        await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());

        const ctxArg = agentRunner.run.mock.calls[0][0];
        expect(ctxArg.repo).toEqual({ cloneUrl: 'https://x-access-token:ghs_installtoken@github.com/acme/widgets.git' });
      });

      // Regression: a from-scratch project git-inits an EMPTY sandbox repo, so a
      // parent's synthesized/placeholder commitSha isn't a real tree — passing it
      // as baseRef made the sandbox's `git checkout <sha>` exit 128 on every
      // from-scratch CODE run. baseCommitSha must key off the resolved run target
      // (ctx.repo.init), not just "does the parent happen to have a commitSha".
      const codeParentWithCommit = {
        nodeId: 'code-1', parentId: 'plan-1', kind: 'CODE', title: 'Base commit', query: 'Base commit',
        sections: [], commitSha: 'basecommitsha1234567890', branchName: 'main',
      };

      it("provider 'new' — baseCommitSha is null even when the parent node has a commitSha (no real git history to check out)", async () => {
        mockDb.getProject.mockResolvedValue({
          projectId: 'proj-1',
          repoRef: { provider: 'new', owner: 'you', repo: 'widgets', defaultBranch: 'main', url: 'mock://new/widgets' },
          plugins: [],
        });
        mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [planNode, codeParentWithCommit], projectId: 'proj-1' });

        await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, parentNodeId: 'code-1' }, jest.fn());

        const ctxArg = agentRunner.run.mock.calls[0][0];
        expect(ctxArg.repo).toEqual({ init: { defaultBranch: 'main' } });
        expect(ctxArg.baseCommitSha).toBeNull();
      });

      it('cloned real repo (public github) — baseCommitSha still passes the parent commitSha through', async () => {
        mockDb.getProject.mockResolvedValue(githubProject());
        mockGithubApp.mintInstallationToken.mockResolvedValue(null);
        mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [planNode, codeParentWithCommit], projectId: 'proj-1' });

        await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, parentNodeId: 'code-1' }, jest.fn());

        const ctxArg = agentRunner.run.mock.calls[0][0];
        expect(ctxArg.repo).toEqual({ cloneUrl: 'https://github.com/acme/widgets.git' });
        expect(ctxArg.baseCommitSha).toBe('basecommitsha1234567890');
      });

      // A 'new' project attached to a real repo mid-session (PATCH /projects/:id/repo)
      // leaves old nodes with commitShas fabricated against the since-replaced fake
      // repo — those don't exist on the just-attached remote either, so the guard
      // must also key off createdAt vs. repoAttachedAt, not just ctx.repo.init.
      describe('repoAttachedAt guard (parent predates a mid-session repo attach)', () => {
        const attachedGithubProject = (repoAttachedAt: string) => ({
          projectId: 'proj-1',
          repoRef: { provider: 'github', owner: 'acme', repo: 'widgets', defaultBranch: 'main', url: 'https://github.com/acme/widgets' },
          plugins: [],
          repoAttachedAt,
        });

        it('parent createdAt before repoAttachedAt — baseCommitSha is null (sha fabricated against the old fake repo)', async () => {
          mockDb.getProject.mockResolvedValue(attachedGithubProject('2026-01-02T00:00:00.000Z'));
          const staleParent = { ...codeParentWithCommit, createdAt: '2026-01-01T00:00:00.000Z' };
          mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [planNode, staleParent], projectId: 'proj-1' });

          await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, parentNodeId: 'code-1' }, jest.fn());

          const ctxArg = agentRunner.run.mock.calls[0][0];
          expect(ctxArg.baseCommitSha).toBeNull();
        });

        it('parent createdAt at/after repoAttachedAt — baseCommitSha is passed through', async () => {
          mockDb.getProject.mockResolvedValue(attachedGithubProject('2026-01-01T00:00:00.000Z'));
          const freshParent = { ...codeParentWithCommit, createdAt: '2026-01-02T00:00:00.000Z' };
          mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [planNode, freshParent], projectId: 'proj-1' });

          await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, parentNodeId: 'code-1' }, jest.fn());

          const ctxArg = agentRunner.run.mock.calls[0][0];
          expect(ctxArg.baseCommitSha).toBe('basecommitsha1234567890');
        });

        it('no repoAttachedAt on the project — unchanged, baseCommitSha passes through regardless of parent createdAt', async () => {
          mockDb.getProject.mockResolvedValue(githubProject());
          const staleParent = { ...codeParentWithCommit, createdAt: '2020-01-01T00:00:00.000Z' };
          mockSessions.getSession.mockResolvedValue({ ...fullSession, nodes: [planNode, staleParent], projectId: 'proj-1' });

          await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, parentNodeId: 'code-1' }, jest.fn());

          const ctxArg = agentRunner.run.mock.calls[0][0];
          expect(ctxArg.baseCommitSha).toBe('basecommitsha1234567890');
        });
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

      describe('eager branch push on the auto-branch fork (#216)', () => {
        const githubProject = { projectId: 'proj-1', repoRef: { provider: 'github', owner: 'acme', repo: 'widgets', defaultBranch: 'main', url: 'https://github.com/acme/widgets' }, plugins: [] };
        const pushedCodeParent = { ...codeParent, pushed: true };

        it('marks the auto-branch node pushed:true when createBranchRef succeeds', async () => {
          mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [planNode, pushedCodeParent, childOf('done')] });
          mockDb.getProject.mockResolvedValue(githubProject);
          mockGithubApp.createBranchRef.mockResolvedValue('created');
          const received: Array<{ type: string; node?: { pushed?: boolean } }> = [];

          await service.createCodeNodeStreaming(SUB, SESSION_ID, codeDto, (d) => received.push(d as typeof received[number]));

          expect(mockGithubApp.createBranchRef).toHaveBeenCalledWith(SUB, 'acme', 'widgets', expect.any(String), codeParent.commitSha);
          expect(received[0].type).toBe('branch-init');
          expect(received[0].node!.pushed).toBe(true);
        });

        it('leaves the auto-branch node unpushed (never throws) when createBranchRef fails or is skipped', async () => {
          mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [planNode, pushedCodeParent, childOf('done')] });
          mockDb.getProject.mockResolvedValue(githubProject);
          mockGithubApp.createBranchRef.mockRejectedValue(new Error('GitHub API down'));
          const received: Array<{ type: string; node?: { pushed?: boolean } }> = [];

          await expect(
            service.createCodeNodeStreaming(SUB, SESSION_ID, codeDto, (d) => received.push(d as typeof received[number])),
          ).resolves.toBeUndefined();

          expect(received[0].node!.pushed).toBeUndefined();
        });

        it('never attempts a ref when the CODE parent was not itself pushed', async () => {
          mockSessions.getSession.mockResolvedValue({ ...fullSession, projectId: 'proj-1', nodes: [planNode, codeParent, childOf('done')] }); // no pushed:true
          mockDb.getProject.mockResolvedValue(githubProject);

          await service.createCodeNodeStreaming(SUB, SESSION_ID, codeDto, jest.fn());

          expect(mockGithubApp.createBranchRef).not.toHaveBeenCalled();
        });
      });
    });

    describe('ADR-0004 cloud billing (pre-auth hold + reconciliation, cost-basis redesign)', () => {
      beforeEach(() => {
        mockRunners.isCloud.mockReturnValue(true);
        mockUsers.placeHold.mockResolvedValue({ holdUsd: 1, ceilingUsd: 1 });
        mockUsers.reconcileHold.mockResolvedValue(undefined);
      });

      it('places a hold (not checkCredit) before persisting any node, keyed by the minted nodeId, always on the sonnet id', async () => {
        const order: string[] = [];
        mockUsers.placeHold.mockImplementation(() => { order.push('placeHold'); return Promise.resolve({ holdUsd: 1, ceilingUsd: 1 }); });
        mockDb.putNode.mockImplementation(() => { order.push('putNode'); return Promise.resolve(); });

        await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, environment: 'cloud' }, jest.fn());

        expect(order[0]).toBe('placeHold');
        expect(order[1]).toBe('putNode');
        // Cloud CODE runs always use Sonnet regardless of dto.model — this is
        // what keeps the hold/usage-event model and the sandbox's actual
        // --model flag from disagreeing (the old model-mismatch bug).
        expect(mockUsers.placeHold).toHaveBeenCalledWith(SUB, SESSION_ID, expect.any(String), CLOUD_CODE_MODEL_ID);
        expect(mockUsers.checkCredit).not.toHaveBeenCalled();
      });

      it('forces ctx.model to the sonnet id and threads maxBudgetUsd = ceilingUsd / creditMultiplier into ctx for a cloud run', async () => {
        await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, environment: 'cloud' }, jest.fn());
        const ctxArg = agentRunner.run.mock.calls[0][0];
        expect(ctxArg.sub).toBe(SUB);
        expect(ctxArg.sessionId).toBe(SESSION_ID);
        expect(ctxArg.model).toBe(CLOUD_CODE_MODEL_ID);
        // ceilingUsd=1 (mocked placeHold), creditMultiplier=1.5 (mockConfig) →
        // maxBudgetUsd is claude's own RAW budget, mapped down from the
        // BILLED ceiling so the sandbox's cap doesn't let claude overspend
        // by the multiplier before it trips.
        expect(ctxArg.maxBudgetUsd).toBeCloseTo(1 / 1.5);
      });

      it('reconciles the hold with runCostUsd = claudeCostUsd × creditMultiplier on done — not billUsage', async () => {
        runnerYields(agentEvents, { ...agentFinal, claudeCostUsd: 0.02 });
        await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, environment: 'cloud' }, jest.fn());
        // round6(0.02 * 1.5 * 1e6) / 1e6 = 0.03
        expect(mockUsers.reconcileHold).toHaveBeenCalledWith(SUB, SESSION_ID, expect.any(String), 0.03, 500, 300, BRANCH_DEFAULT_MODEL, 'CODE');
        expect(mockUsers.billUsage).not.toHaveBeenCalled();
      });

      it('falls back to a token×priceFor estimate when the runner reports no claudeCostUsd (rare no-result-line case)', async () => {
        // agentFinal has no claudeCostUsd — model BRANCH_DEFAULT_MODEL (haiku):
        // input $1/MTok, output $5/MTok. 500 input + 300 output:
        // raw = 500*1/1e6 + 300*5/1e6 = 0.0005 + 0.0015 = 0.002
        // round6(0.002 * 1.5 * 1e6)/1e6 = 0.003
        await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, environment: 'cloud' }, jest.fn());
        expect(mockUsers.reconcileHold).toHaveBeenCalledWith(SUB, SESSION_ID, expect.any(String), 0.003, 500, 300, BRANCH_DEFAULT_MODEL, 'CODE');
      });

      it('reconciles the hold with runCostUsd=0 and zero tokens when the runner fails mid-stream', async () => {
        runnerYields(agentEvents, new Error('boom'));
        await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, environment: 'cloud' }, jest.fn());
        expect(mockUsers.reconcileHold).toHaveBeenCalledWith(SUB, SESSION_ID, expect.any(String), 0, 0, 0, CLOUD_CODE_MODEL_ID, 'CODE');
        expect(mockUsers.billUsage).not.toHaveBeenCalled();
      });

      it('releases the hold when a failure happens after placeHold but before the run loop starts', async () => {
        mockDb.putNode.mockRejectedValueOnce(new Error('ddb blip'));

        await expect(
          service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, environment: 'cloud' }, jest.fn()),
        ).rejects.toThrow('ddb blip');

        expect(mockUsers.reconcileHold).toHaveBeenCalledWith(SUB, SESSION_ID, expect.any(String), 0, 0, 0, CLOUD_CODE_MODEL_ID, 'CODE');
      });

      it('a reconcileHold failure does not mask the original error surfacing to the caller', async () => {
        mockDb.putNode.mockRejectedValueOnce(new Error('ddb blip'));
        mockUsers.reconcileHold.mockRejectedValueOnce(new Error('reconcile also failed'));

        await expect(
          service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, environment: 'cloud' }, jest.fn()),
        ).rejects.toThrow('ddb blip');
      });

      it('persists and emits budgetExceeded when the runner sets it', async () => {
        runnerYields(agentEvents, { ...agentFinal, budgetExceeded: true });
        const received: Array<{ type: string; node?: { budgetExceeded?: boolean } }> = [];

        await service.createCodeNodeStreaming(SUB, SESSION_ID, { ...dto, environment: 'cloud' }, (d) => received.push(d as typeof received[number]));

        expect(mockDb.updateNode).toHaveBeenCalledWith(SESSION_ID, expect.any(String), expect.objectContaining({ budgetExceeded: true }));
        const done = received.find((e) => e.type === 'done')!;
        expect(done.node!.budgetExceeded).toBe(true);
      });

      it('a non-cloud run never places or reconciles a hold — checkCredit/billUsage unchanged, model stays dto.model-resolved', async () => {
        mockRunners.isCloud.mockReturnValue(false);
        await service.createCodeNodeStreaming(SUB, SESSION_ID, dto, jest.fn());
        expect(mockUsers.placeHold).not.toHaveBeenCalled();
        expect(mockUsers.reconcileHold).not.toHaveBeenCalled();
        expect(mockUsers.checkCredit).toHaveBeenCalledWith(SUB);
        expect(mockUsers.billUsage).toHaveBeenCalledWith(SUB, 500, 300, 'CODE', SESSION_ID, expect.any(String), BRANCH_DEFAULT_MODEL);
        const ctxArg = agentRunner.run.mock.calls[0][0];
        expect(ctxArg.model).toBe(BRANCH_DEFAULT_MODEL);
        expect(ctxArg.maxBudgetUsd).toBeUndefined();
      });
    });
  });
});
