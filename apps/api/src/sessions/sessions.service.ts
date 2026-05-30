import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ulid } from 'ulid';
import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { NodeItem, AnnotationItem, HighlightItem, SessionMetaItem } from '@/dynamo/dynamo.interfaces';
import { LlmService } from '@/llm/llm.service';
import { ROOT_MODEL } from '@/llm/models';
import { UsersService } from '@/users/users.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';

export interface SessionSummary {
  sessionId: string;
  title: string;
  emoji: string;
  lede: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  highlightCount: number;
  notionPageUrl?: string | null;
  shareToken?: string | null;
  ownerSub?: string | null;
  isTrial?: boolean;
}

export interface FullSession extends SessionSummary {
  nodes: NodeItem[];
  annotations: AnnotationItem[];
  highlights: HighlightItem[];
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly llm: LlmService,
    private readonly users: UsersService,
    private readonly cfg: ConfigService,
  ) {}

  private userPk(sub: string) { return `USER#${sub}`; }
  private sessionSk(sessionId: string) { return `SESSION#${sessionId}`; }

  async createStreaming(
    sub: string,
    dto: CreateSessionDto,
    send: (data: object) => void,
  ): Promise<void> {
    await this.users.checkCredit(sub);

    const sessionId = ulid();
    const nodeId = ulid();
    const now = new Date().toISOString();

    // Writes to a disconnected client throw — swallow so the LLM loop still
    // completes and the full result is persisted even if the user navigated away.
    const emit = (data: object) => { try { send(data); } catch { /* client gone */ } };

    const rootNode: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: null,
      kind: 'QUERY',
      title: dto.query.slice(0, 60),
      emoji: null,
      query: dto.query,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: now,
      model: ROOT_MODEL,
    };
    const sessionMeta: SessionMetaItem = {
      PK: this.userPk(sub),
      SK: this.sessionSk(sessionId),
      sessionId,
      title: dto.query.slice(0, 60),
      emoji: '',
      lede: '',
      rootNodeId: nodeId,
      nodeCount: 1,
      createdAt: now,
      updatedAt: now,
      gsi1pk: this.userPk(sub),
      gsi1sk: `UPDATED#${now}`,
    };

    // Persist the session up-front and tell the client its id NOW (the `init`
    // event), so the URL updates immediately and a refresh mid-stream restores
    // the real session instead of dropping to Landing. Filled in as it streams.
    await Promise.all([this.db.putNode(rootNode), this.db.putSessionMeta(sessionMeta)]);
    emit({ type: 'init', sessionId, nodeId });

    let title = '';
    let emoji = '';
    let lede = '';
    const sections: Array<{ id: string; heading: string; body: string }> = [];

    for await (const event of this.llm.streamAnswerQuery(dto.query, dto.sectionCount ?? 5, dto.webSearch ?? false)) {
      if (event.type === 'meta') {
        title = event.title;
        emoji = event.emoji;
        lede = event.lede;
        emit({ type: 'meta', title, emoji, lede });
      } else if (event.type === 'section') {
        const section = { id: ulid(), heading: event.heading, body: event.body };
        sections.push(section);
        emit({ type: 'section', ...section });
        // Incrementally persist so a refresh shows progress, not an empty node.
        await this.db.putNode({ ...rootNode, title: title || rootNode.title, emoji, lede, sections: [...sections] });
      } else if (event.type === 'done') {
        // Citation-processed bodies arrive only at done; map them onto the streamed
        // sections by index to preserve their ids. Sources are persisted on the node.
        if (event.sections) {
          event.sections.forEach((s, i) => { if (sections[i]) sections[i].body = s.body; });
        }
        const sourcesPatch = event.sources?.length ? { sources: event.sources } : {};
        await Promise.all([
          this.db.putNode({ ...rootNode, title, emoji, lede, sections, ...sourcesPatch }),
          this.db.putSessionMeta({ ...sessionMeta, title, emoji, lede }),
        ]);
        await this.users.billUsage(sub, event.usage.inputTokens, event.usage.outputTokens, 'QUERY', sessionId, nodeId, ROOT_MODEL);
        emit({ type: 'done', sessionId, nodeId, sections, sources: event.sources });
      }
    }
  }

  async createTrialSessionStreaming(
    dto: CreateSessionDto,
    send: (data: object) => void,
  ): Promise<void> {
    const houseSub = this.cfg.get<string>('TRIAL_HOUSE_SUB') ?? process.env.TRIAL_HOUSE_SUB;
    if (!houseSub) throw new Error('TRIAL_HOUSE_SUB not configured');

    await this.users.checkCredit(houseSub);

    const sessionId = ulid();
    const nodeId = ulid();
    const token = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();

    // Writes to a disconnected client throw — swallow so the LLM loop still
    // completes and the full result is persisted even if the user navigated away.
    const emit = (data: object) => { try { send(data); } catch { /* client gone */ } };

    const rootNode: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: null,
      kind: 'QUERY',
      title: dto.query.slice(0, 60),
      emoji: null,
      query: dto.query,
      lede: '',
      sections: [],
      fromSection: null,
      fromText: null,
      createdAt: now,
      model: ROOT_MODEL,
    };
    const sessionMeta: SessionMetaItem = {
      PK: this.userPk(houseSub),
      SK: this.sessionSk(sessionId),
      sessionId,
      title: dto.query.slice(0, 60),
      emoji: '',
      lede: '',
      rootNodeId: nodeId,
      nodeCount: 1,
      isTrial: true,
      shareToken: token,
      createdAt: now,
      updatedAt: now,
      gsi1pk: this.userPk(houseSub),
      gsi1sk: `UPDATED#${now}`,
    };

    // Persist the session + share token up-front so a refresh mid-stream can
    // restore it. The node/meta are filled in as sections stream and at `done`.
    await Promise.all([
      this.db.putNode(rootNode),
      this.db.putSessionMeta(sessionMeta),
      this.db.putShareToken(token, sessionId, houseSub),
    ]);
    emit({ type: 'init', sessionId, nodeId, token });

    let title = '';
    let emoji = '';
    let lede = '';
    const sections: Array<{ id: string; heading: string; body: string }> = [];

    for await (const event of this.llm.streamAnswerQuery(dto.query, dto.sectionCount ?? 5, dto.webSearch ?? false)) {
      if (event.type === 'meta') {
        title = event.title;
        emoji = event.emoji;
        lede = event.lede;
        emit({ type: 'meta', title, emoji, lede });
      } else if (event.type === 'section') {
        const section = { id: ulid(), heading: event.heading, body: event.body };
        sections.push(section);
        emit({ type: 'section', ...section });
        // Incrementally persist so a refresh shows progress, not an empty node.
        await this.db.putNode({ ...rootNode, title: title || rootNode.title, emoji, lede, sections: [...sections] });
      } else if (event.type === 'done') {
        // Citation-processed bodies arrive only at done; map them onto the streamed
        // sections by index to preserve their ids. Sources are persisted on the node.
        if (event.sections) {
          event.sections.forEach((s, i) => { if (sections[i]) sections[i].body = s.body; });
        }
        const sourcesPatch = event.sources?.length ? { sources: event.sources } : {};
        await Promise.all([
          this.db.putNode({ ...rootNode, title, emoji, lede, sections, ...sourcesPatch }),
          this.db.putSessionMeta({ ...sessionMeta, title, emoji, lede }),
        ]);
        await this.users.billUsage(houseSub, event.usage.inputTokens, event.usage.outputTokens, 'QUERY', sessionId, nodeId, ROOT_MODEL);
        emit({ type: 'done', sessionId, nodeId, token, sections, sources: event.sources });
      }
    }
  }

  async create(sub: string, dto: CreateSessionDto): Promise<FullSession> {
    await this.users.checkCredit(sub);

    const sessionId = ulid();
    const nodeId = ulid();
    const now = new Date().toISOString();

    const llmResult = await this.llm.answerQuery(dto.query, dto.sectionCount ?? 4, dto.webSearch ?? false);
    const sections = llmResult.sections.map((s) => ({ id: ulid(), ...s }));

    const rootNode: NodeItem = {
      PK: `SESSION#${sessionId}`,
      SK: `NODE#${nodeId}`,
      nodeId,
      parentId: null,
      kind: 'QUERY',
      title: llmResult.title,
      emoji: llmResult.emoji,
      query: dto.query,
      lede: llmResult.lede,
      sections,
      fromSection: null,
      fromText: null,
      createdAt: now,
      model: ROOT_MODEL,
      ...(llmResult.sources?.length ? { sources: llmResult.sources } : {}),
    };

    const sessionMeta: SessionMetaItem = {
      PK: this.userPk(sub),
      SK: this.sessionSk(sessionId),
      sessionId,
      title: llmResult.title,
      emoji: llmResult.emoji,
      lede: llmResult.lede,
      rootNodeId: nodeId,
      nodeCount: 1,
      createdAt: now,
      updatedAt: now,
      gsi1pk: this.userPk(sub),
      gsi1sk: `UPDATED#${now}`,
    };

    await Promise.all([this.db.putNode(rootNode), this.db.putSessionMeta(sessionMeta)]);
    await this.users.billUsage(sub, llmResult.usage.inputTokens, llmResult.usage.outputTokens, 'QUERY', sessionId, nodeId, ROOT_MODEL);

    return {
      sessionId,
      title: llmResult.title,
      emoji: llmResult.emoji,
      lede: llmResult.lede,
      createdAt: now,
      updatedAt: now,
      nodeCount: 1,
      highlightCount: 0,
      nodes: [rootNode],
      annotations: [],
      highlights: [],
    };
  }

  async list(sub: string): Promise<SessionSummary[]> {
    const items = await this.db.listSessionMeta(sub);
    const counts = await Promise.all(
      items.map(async (m) => (await this.db.queryHighlights(m.sessionId)).length),
    );
    return items.map((m, i) => ({ ...this.toSummary(m), highlightCount: counts[i] }));
  }

  async getSession(sub: string, sessionId: string): Promise<FullSession> {
    const meta = await this.db.getSessionMeta(sub, sessionId);
    if (!meta) throw new NotFoundException(`Session ${sessionId} not found`);

    const [nodes, annotations, highlights] = await Promise.all([
      this.db.queryNodes(sessionId),
      this.db.queryAnnotations(sessionId),
      this.db.queryHighlights(sessionId),
    ]);

    return { ...this.toSummary(meta), highlightCount: highlights.length, nodes, annotations, highlights };
  }

  async update(sub: string, sessionId: string, dto: UpdateSessionDto): Promise<void> {
    const meta = await this.db.getSessionMeta(sub, sessionId);
    if (!meta) throw new NotFoundException(`Session ${sessionId} not found`);
    const now = new Date().toISOString();
    const updates: Partial<Parameters<typeof this.db.updateSessionMeta>[2]> = {
      updatedAt: now,
      gsi1sk: `UPDATED#${now}`,
    };
    if (dto.title !== undefined) updates.title = dto.title;
    if (dto.notionPageUrl !== undefined) updates.notionPageUrl = dto.notionPageUrl;
    await this.db.updateSessionMeta(sub, sessionId, updates);
  }

  async delete(sub: string, sessionId: string): Promise<void> {
    const meta = await this.db.getSessionMeta(sub, sessionId);
    if (!meta) throw new NotFoundException(`Session ${sessionId} not found`);

    const [nodes, annotations, highlights] = await Promise.all([
      this.db.queryNodes(sessionId),
      this.db.queryAnnotations(sessionId),
      this.db.queryHighlights(sessionId),
    ]);

    await Promise.all([
      this.db.batchDeleteNodes(sessionId, nodes.map((n) => n.nodeId)),
      this.db.batchDeleteAnnotations(sessionId, annotations.map((a) => a.annId)),
      this.db.batchDeleteHighlights(sessionId, highlights.map((h) => h.hlId)),
      this.db.deleteSessionMeta(sub, sessionId),
    ]);
  }

  async touchUpdatedAt(sub: string, sessionId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.updateSessionMeta(sub, sessionId, { updatedAt: now, gsi1sk: `UPDATED#${now}` });
  }

  async incrementNodeCount(sub: string, sessionId: string, delta: number): Promise<void> {
    const meta = await this.db.getSessionMeta(sub, sessionId);
    if (!meta) return;
    await this.db.updateSessionMeta(sub, sessionId, {
      nodeCount: Math.max(0, (meta.nodeCount ?? 0) + delta),
    });
  }

  async generateShareToken(sub: string, sessionId: string): Promise<{ token: string }> {
    const meta = await this.db.getSessionMeta(sub, sessionId);
    if (!meta) throw new NotFoundException(`Session ${sessionId} not found`);

    // Revoke existing token if present
    if (meta.shareToken) {
      await this.db.deleteShareToken(meta.shareToken);
    }

    const token = randomBytes(32).toString('base64url');
    await Promise.all([
      this.db.putShareToken(token, sessionId, sub),
      this.db.updateSessionMeta(sub, sessionId, { shareToken: token }),
    ]);
    return { token };
  }

  async revokeShareToken(sub: string, sessionId: string): Promise<void> {
    const meta = await this.db.getSessionMeta(sub, sessionId);
    if (!meta) throw new NotFoundException(`Session ${sessionId} not found`);
    if (!meta.shareToken) return;
    await Promise.all([
      this.db.deleteShareToken(meta.shareToken),
      this.db.updateSessionMeta(sub, sessionId, { shareToken: null }),
    ]);
  }

  async getShareStatus(sub: string, sessionId: string): Promise<{ active: boolean; token?: string }> {
    const meta = await this.db.getSessionMeta(sub, sessionId);
    if (!meta) throw new NotFoundException(`Session ${sessionId} not found`);
    if (!meta.shareToken) return { active: false };
    return { active: true, token: meta.shareToken };
  }

  async getSessionByToken(token: string): Promise<FullSession> {
    const share = await this.db.getShareToken(token);
    if (!share) throw new ForbiddenException('Invalid or revoked share token');
    const [nodes, annotations, highlights, meta] = await Promise.all([
      this.db.queryNodes(share.sessionId),
      this.db.queryAnnotations(share.sessionId),
      this.db.queryHighlights(share.sessionId),
      this.db.getSessionMeta(share.ownerSub, share.sessionId),
    ]);
    if (!meta) throw new ForbiddenException('Invalid or revoked share token');
    return { ...this.toSummary(meta), highlightCount: highlights.length, nodes, annotations, highlights };
  }

  async claimSession(guestSub: string, token: string): Promise<SessionSummary> {
    const share = await this.db.getShareToken(token);
    if (!share) throw new ForbiddenException('Invalid or revoked share token');

    // No-op if already claimed
    const existing = await this.db.getSessionMeta(guestSub, share.sessionId);
    if (existing) return this.toSummary(existing);

    const ownerMeta = await this.db.getSessionMeta(share.ownerSub, share.sessionId);
    if (!ownerMeta) throw new ForbiddenException('Invalid or revoked share token');

    await this.db.putClaimedSessionMeta(guestSub, ownerMeta);
    const claimed = await this.db.getSessionMeta(guestSub, share.sessionId);
    return this.toSummary(claimed!);
  }

  private toSummary(item: SessionMetaItem): SessionSummary {
    return {
      sessionId: item.sessionId,
      title: item.title,
      emoji: item.emoji,
      lede: item.lede,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      nodeCount: item.nodeCount ?? 0,
      highlightCount: 0,
      notionPageUrl: item.notionPageUrl || null,
      shareToken: item.shareToken || null,
      ownerSub: item.ownerSub || null,
      isTrial: item.isTrial ?? false,
    };
  }
}
