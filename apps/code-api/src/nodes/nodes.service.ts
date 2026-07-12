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
import { CreatePrNodeDto } from './dto/create-pr-node.dto';
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

    const sourceIds = dto.sourceNodeIds ?? [];

    if (sourceIds.includes(dto.parentNodeId)) {
      throw new BadRequestException('sourceNodeIds must not include parentNodeId');
    }

    const sourceNodeList = sourceIds.map((id) => {
      const n = nodeById.get(id);
      if (!n) throw new NotFoundException(`Source node ${id} not found`);
      return n;
    });

    // A mix can never be built from a PLAN/CODE/BRANCH base node. Non-plan mixes
    // stay MIX-only children of a learn node (checked via the grammar map); plan
    // mode produces a PLAN node instead, which isn't a valid child in that map, so
    // it's checked directly against LEARN_KINDS — along with every source node.
    // Plan mode additionally allows a BRANCH base (forking a plan straight off a
    // fresh branch point), but only once it carries content to plan from.
    if (dto.plan) {
      if (!LEARN_KINDS.includes(parentNode.kind as NodeKind) && parentNode.kind !== 'BRANCH') {
        throw new BadRequestException('Plan base node must be a learn node (QUERY/DEEPER/ASK/MIX) or a BRANCH node with content');
      }
      if (parentNode.kind === 'BRANCH' && parentNode.sections.length === 0) {
        throw new BadRequestException('Plan base BRANCH node has no content to plan from');
      }
      for (const n of sourceNodeList) {
        if (!LEARN_KINDS.includes(n.kind as NodeKind)) {
          throw new BadRequestException(`Source node ${n.nodeId} must be a learn node (QUERY/DEEPER/ASK/MIX) to build a plan`);
        }
      }
    } else {
      if (sourceIds.length === 0) {
        throw new BadRequestException('Mixer requires at least one source node');
      }
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

    // Build source node content for LLM (title + sections, body capped to keep context size sane).
    // A 0-source plan has no separate sources to synthesize — the base node's own
    // sections ARE the source material.
    const sourceNodes = dto.plan && sourceNodeList.length === 0
      ? [{ title: parentNode.title, sections: parentNode.sections.map((s) => ({ heading: s.heading, body: s.body })) }]
      : sourceNodeList.map((n) => ({
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

    // A PLAN forks a new git branch off the tip of its base node's own lane —
    // findLaneBranchName walks up from the base to the nearest ancestor (rail or
    // learn) carrying a branchName, so a plan based off a non-main lane (e.g. a
    // BRANCH node, or a learn node hanging off one) forks from THAT lane's tip,
    // not main's. A legacy learn-only session with no lane at all falls back to
    // the original main-chain behavior (and its no-CODE-root fallback below).
    let planBranchFields: Partial<Pick<NodeItem, 'branchName' | 'commitSha'>> = {};
    if (dto.plan) {
      const laneNode = this.findLaneBranchName(nodeById, dto.parentNodeId);
      // findLaneChainTip only finds a tip once the lane has a CODE commit on it —
      // a plan forked straight off a fresh BRANCH root (no CODE children yet) has
      // no chain to walk, so fall back to the lane node's own commitSha as the
      // fork point (it IS the tip, there's just nothing built on it yet).
      const chainTip = laneNode
        ? this.findLaneChainTip(session.nodes, nodeById, laneNode.branchName!)
          ?? (laneNode.commitSha ? { branchName: laneNode.branchName!, commitSha: laneNode.commitSha } : null)
        : this.findMainChainTip(session.nodes);
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
      fromText: sourceIds.join(','),
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

  // Walks forward from a lane's known CODE root to that lane's tip ("HEAD") —
  // through same-branchName CODE children AND MERGE children (a MERGE sits ON
  // the lane; its own CODE child, once merged, continues it), returning the
  // actual tip NodeItem. The tip is the LAST node encountered that carries a
  // commitSha — a bare open MERGE has none, so it's walked through but never
  // becomes the tip itself (new PRs onto that lane are blocked by the
  // open-PR guard in createPrNode regardless). Shared by walkLaneTip (below)
  // and findLaneChainTipNode, which differ only in how they locate the root.
  private walkLaneTipNode(nodes: NodeItem[], root: NodeItem): NodeItem {
    let cur = root;
    let tipWithSha = root;
    for (;;) {
      const children = nodes.filter(
        (n) => (n.kind === 'CODE' || n.kind === 'MERGE') && n.parentId === cur.nodeId && n.branchName === root.branchName,
      );
      if (!children.length) break;
      // A fork can only happen if the user Continued a lane more than once from
      // the same commit — prefer the newest attempt as the true tip.
      cur = children.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
      if (cur.commitSha) tipWithSha = cur;
    }
    return tipWithSha;
  }

  // branchName/commitSha-only view of walkLaneTipNode — used by every caller
  // that doesn't need the tip node's own id.
  private walkLaneTip(nodes: NodeItem[], root: NodeItem): { branchName: string; commitSha: string } {
    const tip = this.walkLaneTipNode(nodes, root);
    return { branchName: root.branchName!, commitSha: tip.commitSha ?? root.commitSha! };
  }

  // Walks the main branch's CODE chain to its tip — "main's HEAD" for
  // fork-point purposes, which may differ from the imported HEAD if the user
  // has since Continued main. Returns null when the session has no CODE root
  // at all (a legacy learn-only session), so the caller can omit
  // branchName/commitSha entirely.
  private findMainChainTip(nodes: NodeItem[]): { branchName: string; commitSha: string } | null {
    const root = nodes.find((n) => n.kind === 'CODE' && n.parentId === null);
    if (!root || !root.branchName || !root.commitSha) return null;
    return this.walkLaneTip(nodes, root);
  }

  // Generalizes findMainChainTip to an arbitrary lane: the lane's root is the
  // CODE node whose parent isn't itself part of the same-branchName chain (the
  // BRANCH/PLAN node that forked the lane — or, for main, no parent at all),
  // then walks forward to the tip node. A MERGE node counts as "part of the
  // chain" here too — otherwise a post-merge CODE commit (whose parent is the
  // MERGE node, not another CODE node) would be misidentified as a second lane
  // root, and `.find` would nondeterministically return either it or the real
  // genesis commit depending on array order. Returns null if the lane has no
  // CODE commits yet (e.g. a freshly-forked BRANCH with nothing built on it).
  private findLaneChainTipNode(
    nodes: NodeItem[],
    nodeById: Map<string, NodeItem>,
    branchName: string,
  ): NodeItem | null {
    const root = nodes.find((n) => {
      if (n.kind !== 'CODE' || n.branchName !== branchName) return false;
      const parent = n.parentId ? nodeById.get(n.parentId) : undefined;
      const parentContinuesLane = !!parent && (parent.kind === 'CODE' || parent.kind === 'MERGE') && parent.branchName === branchName;
      return !parentContinuesLane;
    });
    if (!root || !root.commitSha) return null;
    return this.walkLaneTipNode(nodes, root);
  }

  // branchName/commitSha-only view of findLaneChainTipNode — used by every
  // existing caller that doesn't need the tip node's own id.
  private findLaneChainTip(
    nodes: NodeItem[],
    nodeById: Map<string, NodeItem>,
    branchName: string,
  ): { branchName: string; commitSha: string } | null {
    const tip = this.findLaneChainTipNode(nodes, nodeById, branchName);
    return tip ? { branchName: tip.branchName!, commitSha: tip.commitSha! } : null;
  }

  // Finds which git lane a base node sits on by walking parentId links upward
  // (inclusive of the base node itself) to the nearest ancestor carrying a
  // branchName — a rail node (BRANCH/PLAN/CODE) or a learn node hanging off
  // one. Returns the NODE itself (not just its name) so a caller with no
  // further CODE chain to walk (findLaneChainTip) can still fall back to this
  // node's own commitSha as the fork point. Returns null when no ancestor has
  // one (a legacy learn-only session).
  private findLaneBranchName(nodeById: Map<string, NodeItem>, fromNodeId: string): NodeItem | null {
    let cur: string | null | undefined = fromNodeId;
    while (cur) {
      const n = nodeById.get(cur);
      if (!n) break;
      if (n.branchName) return n;
      cur = n.parentId ?? null;
    }
    return null;
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

  // Opens a PR: a MERGE node parented onto the TARGET branch's tip commit,
  // carrying the SOURCE commit as a second, render-only parent
  // (mergeFromNodeId — see ADR-0005). No LLM call. MERGE is deliberately absent
  // from every ALLOWED_CHILD_KINDS entry in node-grammar.ts (it's only ever
  // created here, like BRANCH is only ever created by createBranchNode above)
  // so this method owns its own validation instead of calling assertKindAllowed.
  async createPrNode(sub: string, sessionId: string, dto: CreatePrNodeDto): Promise<NodeItem> {
    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    const sourceNode = nodeById.get(dto.sourceNodeId);
    if (!sourceNode) {
      throw new NotFoundException(`Source node ${dto.sourceNodeId} not found`);
    }
    if (sourceNode.kind !== 'CODE' || !sourceNode.commitSha) {
      throw new BadRequestException('PR source must be a CODE node with a commit');
    }

    const targetNode = nodeById.get(dto.targetNodeId);
    if (!targetNode) {
      throw new NotFoundException(`Target node ${dto.targetNodeId} not found`);
    }

    const sourceLaneNode = this.findLaneBranchName(nodeById, sourceNode.nodeId);
    const targetLaneNode = this.findLaneBranchName(nodeById, targetNode.nodeId);
    if (!sourceLaneNode?.branchName || !targetLaneNode?.branchName) {
      throw new BadRequestException('Could not resolve a branch for the PR source or target');
    }
    const sourceBranch = sourceLaneNode.branchName;
    const targetBranch = targetLaneNode.branchName;
    if (sourceBranch === targetBranch) {
      throw new BadRequestException('PR source and target must be on different branches');
    }

    const targetTip = this.findLaneChainTipNode(session.nodes, nodeById, targetBranch);
    if (!targetTip) {
      throw new BadRequestException('Target branch has no commits to merge onto');
    }

    const hasOpenPr = session.nodes.some(
      (n) => n.kind === 'MERGE' && n.prStatus === 'open' && n.parentId === targetTip.nodeId,
    );
    if (hasOpenPr) {
      throw new BadRequestException('Target branch already has an open PR');
    }

    const nodeId = ulid();
    const now = new Date().toISOString();
    const title = `PR: ${sourceBranch} → ${targetBranch}`;

    const node: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: targetTip.nodeId,
      kind: 'MERGE',
      title,
      emoji: '',
      query: title,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: now,
      branchName: targetBranch,
      mergeFromNodeId: sourceNode.nodeId,
      prStatus: 'open',
    };

    await this.db.putNode(node);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, 1),
    ]);

    return node;
  }

  // Merges an open PR: spawns the merge-commit CODE node (parented on the
  // MERGE node) and flips the MERGE node's prStatus to 'merged'. No LLM call —
  // the commit sha is mocked the same way createCodeNodeStreaming mocks one.
  // The merge commit deliberately omits agentStatus (rather than 'done'):
  // AgentLogPane only fetches an AgentRun when agentStatus is 'done'/'error',
  // and none exists for a merge commit — omitting the field skips that dead
  // fetch entirely while `node.agentStatus ?? 'done'` still renders the pane's
  // status chip as "done".
  async mergePrNode(sub: string, sessionId: string, nodeId: string): Promise<{ mergeNode: NodeItem; commitNode: NodeItem }> {
    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    const mergeNode = nodeById.get(nodeId);
    if (!mergeNode) {
      throw new NotFoundException(`Node ${nodeId} not found`);
    }
    if (mergeNode.kind !== 'MERGE' || mergeNode.prStatus !== 'open') {
      throw new BadRequestException('Node is not an open PR');
    }

    const sourceNode = mergeNode.mergeFromNodeId ? nodeById.get(mergeNode.mergeFromNodeId) : undefined;
    const sourceLaneNode = sourceNode ? this.findLaneBranchName(nodeById, sourceNode.nodeId) : null;
    const sourceBranch = sourceLaneNode?.branchName ?? 'source';
    const targetBranch = mergeNode.branchName!;

    const commitNodeId = ulid();
    const commitSha = randomBytes(20).toString('hex');
    const now = new Date().toISOString();
    const commitMessage = `Merge branch '${sourceBranch}' into ${targetBranch}`;

    const commitNode: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${commitNodeId}`,
      nodeId: commitNodeId,
      parentId: mergeNode.nodeId,
      kind: 'CODE',
      title: commitMessage.slice(0, 60),
      emoji: null,
      query: commitMessage,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: now,
      branchName: targetBranch,
      commitSha,
      commitMessage,
    };

    await Promise.all([
      this.db.putNode(commitNode),
      this.db.updateNode(sessionId, mergeNode.nodeId, { prStatus: 'merged' }),
    ]);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, 1),
    ]);

    return { mergeNode: { ...mergeNode, prStatus: 'merged' }, commitNode };
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

    const emit = (data: object) => { try { send(data); } catch { /* client gone */ } };

    // Auto-branch on a parallel instruction: submitting a NEW instruction while
    // sitting on a CODE node that already has a *finished* CODE child means this
    // is a second, independent line of work off the same commit — not a
    // continuation of that child — so fork a BRANCH node first rather than
    // silently adding a second child under the same parent. A running/errored
    // existing child is left alone (retry semantics, newest-wins, no branch) so
    // a failed/in-flight attempt can still just be retried directly.
    let autoBranchNode: NodeItem | null = null;
    if (parentNode.kind === 'CODE') {
      const existingCodeChildren = session.nodes.filter((n) => n.kind === 'CODE' && n.parentId === parentNode.nodeId);
      const tip = existingCodeChildren.length
        ? existingCodeChildren.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
        : null;
      if (tip?.agentStatus === 'done') {
        const existingBranchNames = new Set(
          session.nodes.filter((n) => n.branchName).map((n) => n.branchName as string),
        );
        const branchNodeId = ulid();
        const branchNow = new Date().toISOString();
        const newBranchName = this.slugifyBranchName(dto.instruction, existingBranchNames);
        autoBranchNode = {
          PK: `SESSION#${sessionId}`,
          SK: `NODE#${branchNodeId}`,
          nodeId: branchNodeId,
          parentId: parentNode.nodeId,
          kind: 'BRANCH',
          title: newBranchName,
          emoji: null,
          query: `Fork from ${parentNode.commitSha!.slice(0, 7)}`,
          lede: '',
          sections: [],
          fromSection: null,
          fromText: null,
          createdAt: branchNow,
          branchName: newBranchName,
          commitSha: parentNode.commitSha!,
        };
        await this.db.putNode(autoBranchNode);
        nodeById.set(branchNodeId, autoBranchNode);
        await Promise.all([
          this.sessions.touchUpdatedAt(sub, sessionId),
          this.sessions.incrementNodeCount(sub, sessionId, 1),
        ]);
        emit({ type: 'branch-init', node: autoBranchNode });
      }
    }

    // The CODE node's real parent is the auto-branch node when one was just
    // forked, otherwise the requested parent, unchanged.
    const codeParentId = autoBranchNode?.nodeId ?? dto.parentNodeId;

    // Lane identity: the nearest BRANCH ancestor's branchName wins; otherwise a
    // PLAN's own forked branchName (F1); otherwise the project's default
    // branch; otherwise a bare 'main' (no project at all).
    const chain = findRailChain(nodeById, codeParentId);
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
      // Attachments only ever feed the prompt — never spread onto the NodeItem
      // below (Dynamoose saveUnknown:false would silently strip them anyway,
      // but the node schema doesn't declare the field at all; see root CLAUDE.md).
      attachments: dto.attachments?.map((a) => ({ name: a.name, content: a.content })),
    };

    const nodeId = ulid();
    // No real git backend exists yet (mock-first per ADR-0001) — a random SHA-1-
    // shaped hex string stands in for the commit this run "produces".
    const commitSha = randomBytes(20).toString('hex');
    const now = new Date().toISOString();

    const node: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: codeParentId,
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
