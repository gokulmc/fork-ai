import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { NodeItem, AgentRunItem } from '@/dynamo/dynamo.interfaces';
import { LlmService } from '@/llm/llm.service';
import { resolveBranchModel } from '@/llm/models';
import { NodeKind } from '@/llm/llm.types';
import { SessionsService } from '@/sessions/sessions.service';
import { UsersService } from '@/users/users.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { CreateMixNodeDto } from './dto/create-mix-node.dto';
import { CreateBranchNodeDto } from './dto/create-branch-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { assertKindAllowed, LEARN_KINDS } from './node-grammar';

@Injectable()
export class NodesService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly llm: LlmService,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
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

    if (dto.kind === 'DEEPER') {
      if (!dto.sectionBody) throw new BadRequestException('sectionBody required for DEEPER nodes');
      llmResult = await this.llm.expandSection(ancestors, dto.query, dto.sectionBody, dto.sectionCount ?? 4, dto.webSearch ?? false, model, dto.verbose ?? false, true, boost, avoidEmojis, persona);
      fromText = `${dto.query}: ${dto.sectionBody.slice(0, 200)}…`;
    } else {
      if (!dto.highlightText) throw new BadRequestException('highlightText required for ASK nodes');
      llmResult = await this.llm.followUpFromHighlight(ancestors, dto.highlightText, dto.query, dto.sectionCount ?? 4, dto.webSearch ?? false, model, dto.verbose ?? false, true, boost, avoidEmojis, persona);
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
    };

    await this.db.putNode(node);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, 1),
      this.users.billUsage(sub, llmResult.usage.inputTokens, llmResult.usage.outputTokens, kind, sessionId, node.nodeId, model),
    ]);

    return node;
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
