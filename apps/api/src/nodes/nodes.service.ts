import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { NodeItem } from '@/dynamo/dynamo.interfaces';
import { LlmService } from '@/llm/llm.service';
import { resolveBranchModel } from '@/llm/models';
import { SessionsService } from '@/sessions/sessions.service';
import { UsersService } from '@/users/users.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';

@Injectable()
export class NodesService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly llm: LlmService,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
  ) {}

  async createNode(sub: string, sessionId: string, dto: CreateNodeDto, isGuest = false, isTrial = false): Promise<NodeItem> {
    await this.users.checkCredit(sub);

    const model = resolveBranchModel(dto.model, isGuest);

    const session = await this.sessions.getSession(sub, sessionId);
    const nodeById = new Map(session.nodes.map((n) => [n.nodeId, n]));

    if (!nodeById.has(dto.parentNodeId)) {
      throw new NotFoundException(`Parent node ${dto.parentNodeId} not found`);
    }

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

    // Authenticated callers get the larger Output Budget; a boosted retry only
    // applies for them (guests can't Retry a Cut-Off). See ADR-0009.
    const authed = !isGuest;
    const boost = authed && (dto.boost ?? false);

    // Persona is a per-user setting — only the account owner's branches inherit
    // it. Guests (shared sessions) never carry the host's persona.
    const persona = authed ? await this.users.getPersona(sub) : undefined;

    if (dto.kind === 'DEEPER') {
      if (!dto.sectionBody) throw new BadRequestException('sectionBody required for DEEPER nodes');
      llmResult = await this.llm.expandSection(ancestors, dto.query, dto.sectionBody, dto.sectionCount ?? 4, dto.webSearch ?? false, model, dto.verbose ?? false, authed, boost, avoidEmojis, persona);
      fromText = `${dto.query}: ${dto.sectionBody.slice(0, 200)}…`;
    } else {
      if (!dto.highlightText) throw new BadRequestException('highlightText required for ASK nodes');
      llmResult = await this.llm.followUpFromHighlight(ancestors, dto.highlightText, dto.query, dto.sectionCount ?? 4, dto.webSearch ?? false, model, dto.verbose ?? false, authed, boost, avoidEmojis, persona);
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
      // Invalidate any previous Notion export — the branch tree just changed.
      // Works for both authed and guest writes (guest can't call PATCH /sessions/:id).
      this.db.updateSessionMeta(sub, sessionId, { notionPageUrl: null }),
      this.users.billUsage(sub, llmResult.usage.inputTokens, llmResult.usage.outputTokens, dto.kind, sessionId, node.nodeId, model, isTrial),
    ]);

    return node;
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

    // Starring changes the Notion export, so any previously-saved page is now stale.
    if (dto.starred !== undefined) {
      await this.db.updateSessionMeta(sub, sessionId, { notionPageUrl: null });
    }
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
