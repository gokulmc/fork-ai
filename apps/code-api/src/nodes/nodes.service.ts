import { randomBytes } from 'crypto';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { NodeItem, AgentRunItem } from '@/dynamo/dynamo.interfaces';
import { LlmService, friendlyLlmError } from '@/llm/llm.service';
import { resolveBranchModel } from '@/llm/models';
import { NodeKind } from '@/llm/llm.types';
import { SessionsService } from '@/sessions/sessions.service';
import { UsersService } from '@/users/users.service';
import { MockAgentService, AgentRunContext } from '@/agent/mock-agent.service';
import { AgentEvent, serializeEventsCapped } from '@/agent/agent-run.util';
import { CreateNodeDto } from './dto/create-node.dto';
import { CreateMixNodeDto } from './dto/create-mix-node.dto';
import { CreateBranchNodeDto } from './dto/create-branch-node.dto';
import { CreateCodeNodeDto } from './dto/create-code-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { assertKindAllowed, LEARN_KINDS } from './node-grammar';
import { findRailChain, planDocOf, codeSummaryOf, codeContextBlockOf } from './context';

// Pacing between replayed agent events on the CODE-node stream — simulates a
// live run instead of dumping the whole mocked transcript at once.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function jitterMs(): number {
  return 100 + Math.floor(Math.random() * 500);
}

@Injectable()
export class NodesService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly llm: LlmService,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
    private readonly mockAgent: MockAgentService,
  ) {}

  async createNode(sub: string, sessionId: string, dto: CreateNodeDto): Promise<NodeItem> {
    await this.users.checkCredit(sub);

    const model = resolveBranchModel(dto.model);

    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    const parentNode = nodeById.get(dto.parentNodeId);
    if (!parentNode) {
      throw new NotFoundException(`Parent node ${dto.parentNodeId} not found`);
    }
    assertKindAllowed(parentNode.kind as NodeKind, dto.kind);

    // Soft-dedupe emoji against existing siblings (same parent) so the map
    // doesn't repeat the same icon across branches under one node.
    const usedEmojis = new Set(
      session.nodes
        .filter((n) => n.parentId === dto.parentNodeId && n.emoji)
        .map((n) => n.emoji as string),
    );

    // Walk up to root to build context trail (root first), also collecting
    // ancestor emojis so a branch doesn't echo its parent/grandparent icon.
    const ancestors: Array<{ title: string; query: string }> = [];
    let cur: string | null = dto.parentNodeId;
    while (cur) {
      const n = nodeById.get(cur);
      if (!n) break;
      ancestors.unshift({ title: n.title, query: n.query });
      if (n.emoji) usedEmojis.add(n.emoji);
      cur = n.parentId ?? null;
    }
    const avoidEmojis = [...usedEmojis];

    let llmResult;
    let fromText: string;

    // All callers are authenticated now (guest mode removed), so the larger
    // Output Budget and boosted retry are always available. See ADR-0009.
    const boost = dto.boost ?? false;
    const persona = await this.users.getPersona(sub);

    // A DEEPER/ASK hanging directly off a CODE node is grounded in what the agent
    // actually did, not just the parent's title/query like a normal ancestor —
    // fetching the AgentRun is best-effort (skipped silently if absent/erroring).
    let extraContext: string | undefined;
    if (parentNode.kind === 'CODE') {
      const run = await this.db.getAgentRun(sessionId, parentNode.nodeId).catch(() => null);
      let recentEvents: AgentEvent[] = [];
      if (run) {
        try { recentEvents = (JSON.parse(run.events) as AgentEvent[]).slice(-15); } catch { /* malformed events blob — degrade gracefully */ }
      }
      extraContext = codeContextBlockOf(parentNode, recentEvents);
    }

    if (dto.kind === 'DEEPER') {
      if (!dto.sectionBody) throw new BadRequestException('sectionBody required for DEEPER nodes');
      llmResult = await this.llm.expandSection(ancestors, dto.query, dto.sectionBody, dto.sectionCount ?? 4, dto.webSearch ?? false, model, dto.verbose ?? false, true, boost, avoidEmojis, persona, extraContext);
      fromText = `${dto.query}: ${dto.sectionBody.slice(0, 200)}…`;
    } else {
      if (!dto.highlightText) throw new BadRequestException('highlightText required for ASK nodes');
      llmResult = await this.llm.followUpFromHighlight(ancestors, dto.highlightText, dto.query, dto.sectionCount ?? 4, dto.webSearch ?? false, model, dto.verbose ?? false, true, boost, avoidEmojis, persona, extraContext);
      fromText = dto.highlightText;
    }

    const nodeId = ulid();
    const now = new Date().toISOString();
    const sections = llmResult.sections.map((s) => ({ id: ulid(), ...s }));

    const node: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: dto.parentNodeId,
      kind: dto.kind,
      title: llmResult.title,
      emoji: llmResult.emoji,
      query: dto.query,
      lede: llmResult.lede,
      sections,
      fromSection: dto.fromSection,
      fromText,
      createdAt: now,
      model,
      ...(llmResult.sources?.length ? { sources: llmResult.sources } : {}),
    };

    await this.db.putNode(node);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, 1),
      this.users.billUsage(sub, llmResult.usage.inputTokens, llmResult.usage.outputTokens, dto.kind, sessionId, node.nodeId, model),
    ]);

    return node;
  }

  async createMixNode(sub: string, sessionId: string, dto: CreateMixNodeDto): Promise<NodeItem> {
    await this.users.checkCredit(sub);

    const model = resolveBranchModel(dto.model);

    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    const parentNode = nodeById.get(dto.parentNodeId);
    if (!parentNode) {
      throw new NotFoundException(`Parent node ${dto.parentNodeId} not found`);
    }

    if (dto.sourceNodeIds.includes(dto.parentNodeId)) {
      throw new BadRequestException('sourceNodeIds must not include parentNodeId');
    }

    const sourceNodeList = dto.sourceNodeIds.map((id) => {
      const n = nodeById.get(id);
      if (!n) throw new NotFoundException(`Source node ${id} not found`);
      return n;
    });

    // A mix can never be built from a PLAN/CODE/BRANCH base node. Non-plan mixes
    // stay MIX-only children of a learn node (checked via the grammar map); plan
    // mode produces a PLAN node instead, which isn't a valid child in that map, so
    // it's checked directly against LEARN_KINDS — along with every source node.
    if (dto.plan) {
      if (!LEARN_KINDS.includes(parentNode.kind as NodeKind)) {
        throw new BadRequestException('Plan base node must be a learn node (QUERY/DEEPER/ASK/MIX)');
      }
      for (const n of sourceNodeList) {
        if (!LEARN_KINDS.includes(n.kind as NodeKind)) {
          throw new BadRequestException(`Source node ${n.nodeId} must be a learn node (QUERY/DEEPER/ASK/MIX) to build a plan`);
        }
      }
    } else {
      assertKindAllowed(parentNode.kind as NodeKind, 'MIX');
    }

    // Collect sibling + ancestor emojis to avoid icon duplication
    const usedEmojis = new Set(
      session.nodes
        .filter((n) => n.parentId === dto.parentNodeId && n.emoji)
        .map((n) => n.emoji as string),
    );

    // Build ancestor context trail for A (root → parentNode)
    const ancestors: Array<{ title: string; query: string }> = [];
    let cur: string | null = dto.parentNodeId;
    while (cur) {
      const n = nodeById.get(cur);
      if (!n) break;
      ancestors.unshift({ title: n.title, query: n.query });
      if (n.emoji) usedEmojis.add(n.emoji);
      cur = n.parentId ?? null;
    }

    // Build source node content for LLM (title + sections, body capped to keep context size sane)
    const sourceNodes = sourceNodeList.map((n) => ({
      title: n.title,
      sections: n.sections.map((s) => ({ heading: s.heading, body: s.body })),
    }));

    const persona = await this.users.getPersona(sub);

    const llmResult = await this.llm.mixNodes(
      ancestors,
      sourceNodes,
      dto.query,
      dto.sectionCount ?? 4,
      model,
      true,
      [...usedEmojis],
      persona,
      dto.plan ?? false,
    );

    const kind: NodeKind = dto.plan ? 'PLAN' : 'MIX';
    const nodeId = ulid();
    const now = new Date().toISOString();
    const sections = llmResult.sections.map((s) => ({ id: ulid(), ...s }));

    // A PLAN forks a new git branch off the tip of the main CODE chain — see
    // planBranchFields below (F1). A legacy learn-only session (no CODE root at
    // all) has no chain to fork from, so the fields are simply omitted.
    let planBranchFields: Partial<Pick<NodeItem, 'branchName' | 'commitSha'>> = {};
    if (dto.plan) {
      const chainTip = this.findMainChainTip(session.nodes);
      if (chainTip) {
        const existingBranchNames = new Set(
          session.nodes.filter((n) => n.branchName).map((n) => n.branchName as string),
        );
        planBranchFields = {
          branchName: this.slugifyBranchName(llmResult.title, existingBranchNames),
          commitSha: chainTip.commitSha,
        };
      }
    }

    const node: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: dto.parentNodeId,
      kind,
      title: llmResult.title,
      emoji: llmResult.emoji,
      query: dto.query,
      lede: llmResult.lede,
      sections,
      fromSection: null,
      fromText: dto.sourceNodeIds.join(','),
      createdAt: now,
      model,
      ...planBranchFields,
    };

    await this.db.putNode(node);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, 1),
      this.users.billUsage(sub, llmResult.usage.inputTokens, llmResult.usage.outputTokens, kind, sessionId, node.nodeId, model),
    ]);

    return node;
  }

  // Walks the main branch's CODE chain (root → newest child on the same
  // branchName, repeated) to its tip — "main's HEAD" for fork-point purposes,
  // which may differ from the imported HEAD if the user has since Continued
  // main. Returns null when the session has no CODE root at all (a legacy
  // learn-only session), so the caller can omit branchName/commitSha entirely.
  private findMainChainTip(nodes: NodeItem[]): { branchName: string; commitSha: string } | null {
    const root = nodes.find((n) => n.kind === 'CODE' && n.parentId === null);
    if (!root || !root.branchName || !root.commitSha) return null;

    let tip = root;
    for (;;) {
      const children = nodes.filter(
        (n) => n.kind === 'CODE' && n.parentId === tip.nodeId && n.branchName === root.branchName,
      );
      if (!children.length) break;
      // A fork can only happen if the user Continued main more than once from
      // the same commit — prefer the newest attempt as the true tip.
      tip = children.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    }
    return { branchName: tip.branchName!, commitSha: tip.commitSha ?? root.commitSha! };
  }

  // Slugifies an LLM-returned plan title into a `fork/<slug>` branch name,
  // de-duped (suffix -2, -3…) against every branchName already in the session.
  private slugifyBranchName(title: string, existing: Set<string>): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'plan';

    let branchName = `fork/${slug}`;
    for (let n = 2; existing.has(branchName); n++) branchName = `fork/${slug}-${n}`;
    return branchName;
  }

  async createBranchNode(sub: string, sessionId: string, dto: CreateBranchNodeDto): Promise<NodeItem> {
    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    const parentNode = nodeById.get(dto.parentNodeId);
    if (!parentNode) {
      throw new NotFoundException(`Parent node ${dto.parentNodeId} not found`);
    }
    assertKindAllowed(parentNode.kind as NodeKind, 'BRANCH');

    if (!parentNode.commitSha) {
      throw new BadRequestException('Parent CODE node has no commit to fork from');
    }

    const existingNames = new Set(
      session.nodes
        .filter((n) => n.kind === 'BRANCH' && n.branchName)
        .map((n) => n.branchName as string),
    );
    if (existingNames.has(dto.branchName)) {
      throw new BadRequestException(`Branch name "${dto.branchName}" already exists in this session`);
    }

    const nodeId = ulid();
    const now = new Date().toISOString();

    const node: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: dto.parentNodeId,
      kind: 'BRANCH',
      title: dto.branchName,
      emoji: null,
      query: `Fork from ${parentNode.commitSha.slice(0, 7)}`,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: now,
      branchName: dto.branchName,
      commitSha: parentNode.commitSha,
    };

    await this.db.putNode(node);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, 1),
    ]);

    return node;
  }

  // Streaming CODE-node creation: persist-first (loading node + running AgentRun,
  // `init` emitted before any agent-event — see root CLAUDE.md's root-query
  // streaming contract, followed here for the same refresh-survives-mid-run
  // reason), then a single mocked agent run replayed over SSE with jittered
  // pacing. `send` is wrapped in a swallow-errors `emit` exactly like
  // SessionsService.createStreaming so a client disconnect never aborts the run —
  // it still lands fully in the DB.
  async createCodeNodeStreaming(
    sub: string,
    sessionId: string,
    dto: CreateCodeNodeDto,
    send: (data: object) => void,
  ): Promise<void> {
    await this.users.checkCredit(sub);

    const model = resolveBranchModel(dto.model);
    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    const parentNode = nodeById.get(dto.parentNodeId);
    if (!parentNode) {
      throw new NotFoundException(`Parent node ${dto.parentNodeId} not found`);
    }
    assertKindAllowed(parentNode.kind as NodeKind, 'CODE');

    // Lane identity: the nearest BRANCH ancestor's branchName wins; otherwise a
    // PLAN's own forked branchName (F1); otherwise the project's default
    // branch; otherwise a bare 'main' (no project at all).
    const chain = findRailChain(nodeById, dto.parentNodeId);
    const project = session.projectId ? await this.db.getProject(sub, session.projectId) : null;
    const branchName = chain.branchNode?.branchName ?? chain.planNode?.branchName ?? project?.repoRef.defaultBranch ?? 'main';
    const baseCommitSha = parentNode.commitSha ?? null;

    const ctx: AgentRunContext = {
      instruction: dto.instruction,
      planDoc: chain.planNode ? planDocOf(chain.planNode) : null,
      branchName,
      baseCommitSha,
      repoRef: project?.repoRef ?? null,
      plugins: project?.plugins ?? [],
      ancestorCodeSummaries: chain.codeAncestors.slice(0, 10).map(codeSummaryOf),
      model,
    };

    const nodeId = ulid();
    // No real git backend exists yet (mock-first per ADR-0001) — a random SHA-1-
    // shaped hex string stands in for the commit this run "produces".
    const commitSha = randomBytes(20).toString('hex');
    const now = new Date().toISOString();
    const emit = (data: object) => { try { send(data); } catch { /* client gone */ } };

    const node: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: dto.parentNodeId,
      kind: 'CODE',
      title: dto.instruction.slice(0, 60),
      emoji: null,
      query: dto.instruction,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: now,
      model,
      branchName,
      commitSha,
      agentStatus: 'running',
    };
    const agentRun: AgentRunItem = {
      PK: `SESSION#${sessionId}`,
      SK: `AGENTRUN#${nodeId}`,
      nodeId,
      status: 'running',
      events: '[]',
      createdAt: now,
      updatedAt: now,
    };

    // Persist BEFORE any SSE event — a refresh mid-run must restore a real node,
    // not drop back to nothing.
    await Promise.all([this.db.putNode(node), this.db.putAgentRun(agentRun)]);
    emit({ type: 'init', node });

    let result;
    try {
      result = await this.mockAgent.generate(ctx);
    } catch (err) {
      const message = friendlyLlmError(err as Error);
      await Promise.all([
        this.db.updateNode(sessionId, nodeId, { agentStatus: 'error' }),
        this.db.updateAgentRun(sessionId, nodeId, { status: 'error', updatedAt: new Date().toISOString() }),
      ]);
      emit({ type: 'error', message });
      return;
    }

    const events: AgentEvent[] = [];
    let lastPersistAt = Date.now();
    for (const event of result.events) {
      await sleep(jitterMs());
      events.push(event);
      emit({ type: 'agent-event', event });
      if (events.length % 10 === 0 || Date.now() - lastPersistAt >= 2000) {
        await this.db.updateAgentRun(sessionId, nodeId, { events: serializeEventsCapped(events), updatedAt: new Date().toISOString() });
        lastPersistAt = Date.now();
      }
    }

    // No extra LLM call for title/lede — a simple truncation of the commit
    // message is enough for the map card and breadcrumb.
    const title = result.commitMessage.split(/\s+/).filter(Boolean).slice(0, 5).join(' ') || node.title;
    const lede = result.commitMessage.length > 140 ? `${result.commitMessage.slice(0, 140)}…` : result.commitMessage;

    await Promise.all([
      this.db.updateNode(sessionId, nodeId, {
        title,
        lede,
        commitMessage: result.commitMessage,
        diffSummary: result.diffSummary,
        agentStatus: 'done',
      }),
      this.db.updateAgentRun(sessionId, nodeId, {
        status: 'done',
        events: serializeEventsCapped(events),
        commitSha,
        branchName,
        commitMessage: result.commitMessage,
        diffSummary: result.diffSummary,
        updatedAt: new Date().toISOString(),
      }),
    ]);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, 1),
      this.users.billUsage(sub, result.inputTokens, result.outputTokens, 'CODE', sessionId, nodeId, result.model),
    ]);

    emit({ type: 'commit', sha: commitSha, branchName, message: result.commitMessage, diffSummary: result.diffSummary });
    emit({
      type: 'done',
      node: { ...node, title, lede, commitMessage: result.commitMessage, diffSummary: result.diffSummary, agentStatus: 'done' },
    });
  }

  async getAgentRun(sub: string, sessionId: string, nodeId: string): Promise<AgentRunItem> {
    await this.sessions.getSession(sub, sessionId); // ownership check
    const run = await this.db.getAgentRun(sessionId, nodeId);
    if (!run) throw new NotFoundException(`AgentRun for node ${nodeId} not found`);
    return run;
  }

  async updateNode(sub: string, sessionId: string, nodeId: string, dto: UpdateNodeDto): Promise<void> {
    await this.sessions.getSession(sub, sessionId);
    const node = await this.db.getNode(sessionId, nodeId);
    if (!node) throw new NotFoundException(`Node ${nodeId} not found`);

    const updates: Partial<Pick<NodeItem, 'title' | 'starred'>> = {};
    if (dto.title !== undefined) updates.title = dto.title;
    if (dto.starred !== undefined) updates.starred = dto.starred;
    if (!Object.keys(updates).length) return;

    await this.db.updateNode(sessionId, nodeId, updates);
  }

  async deleteBranch(sub: string, sessionId: string, nodeId: string): Promise<void> {
    await this.sessions.getSession(sub, sessionId);

    const allNodes = await this.db.queryNodes(sessionId);
    const nodeMap = new Map(allNodes.map((n) => [n.nodeId, n]));

    if (!nodeMap.has(nodeId)) throw new NotFoundException(`Node ${nodeId} not found`);

    // BFS to collect the full subtree
    const toDelete = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length) {
      const current = queue.shift()!;
      for (const n of nodeMap.values()) {
        if (n.parentId === current && !toDelete.has(n.nodeId)) {
          toDelete.add(n.nodeId);
          queue.push(n.nodeId);
        }
      }
    }

    const [allAnnotations, allHighlights] = await Promise.all([
      this.db.queryAnnotations(sessionId),
      this.db.queryHighlights(sessionId),
    ]);

    const annIds = allAnnotations.filter((a) => toDelete.has(a.nodeId)).map((a) => a.annId);
    const hlIds = allHighlights.filter((h) => toDelete.has(h.nodeId)).map((h) => h.hlId);

    await Promise.all([
      this.db.batchDeleteNodes(sessionId, [...toDelete]),
      this.db.batchDeleteAnnotations(sessionId, annIds),
      this.db.batchDeleteHighlights(sessionId, hlIds),
    ]);

    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, -toDelete.size),
    ]);
  }
}
