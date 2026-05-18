import { Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { LlmService } from '@/llm/llm.service';
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
}

export interface FullSession extends SessionSummary {
  nodes: Record<string, unknown>[];
  annotations: Record<string, unknown>[];
  highlights: Record<string, unknown>[];
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly llm: LlmService,
  ) {}

  private sessionPk(sessionId: string) { return `SESSION#${sessionId}`; }
  private userPk(sub: string) { return `USER#${sub}`; }
  private sessionSk(sessionId: string) { return `SESSION#${sessionId}`; }

  async createStreaming(
    sub: string,
    dto: CreateSessionDto,
    send: (data: object) => void,
  ): Promise<void> {
    const sessionId = ulid();
    const nodeId = ulid();
    const now = new Date().toISOString();

    let title = '';
    let emoji = '';
    let lede = '';
    const sections: Array<{ id: string; heading: string; body: string }> = [];

    for await (const event of this.llm.streamAnswerQuery(dto.query, dto.sectionCount ?? 5)) {
      if (event.type === 'meta') {
        title = event.title;
        emoji = event.emoji;
        lede = event.lede;
        send({ type: 'meta', title, emoji, lede });
      } else if (event.type === 'section') {
        const section = { id: ulid(), heading: event.heading, body: event.body };
        sections.push(section);
        send({ type: 'section', ...section });
      } else if (event.type === 'done') {
        // Persist to DynamoDB now that all sections are collected
        const rootNode: Record<string, unknown> = {
          PK: this.sessionPk(sessionId),
          SK: `NODE#${nodeId}`,
          nodeId,
          parentId: null,
          kind: 'QUERY',
          title,
          emoji,
          query: dto.query,
          lede,
          sections,
          fromSection: null,
          fromText: null,
          highlights: {},
          createdAt: now,
        };

        const sessionMeta: Record<string, unknown> = {
          PK: this.userPk(sub),
          SK: this.sessionSk(sessionId),
          sessionId,
          title,
          emoji,
          lede,
          rootNodeId: nodeId,
          nodeCount: 1,
          createdAt: now,
          updatedAt: now,
          gsi1pk: this.userPk(sub),
          gsi1sk: `UPDATED#${now}`,
        };

        await Promise.all([this.db.put(rootNode), this.db.put(sessionMeta)]);
        send({ type: 'done', sessionId, nodeId });
      }
    }
  }

  async create(sub: string, dto: CreateSessionDto): Promise<FullSession> {
    const sessionId = ulid();
    const nodeId = ulid();
    const now = new Date().toISOString();

    // Fire LLM for root node
    const llmResult = await this.llm.answerQuery(dto.query, dto.sectionCount ?? 5);

    const sections = llmResult.sections.map((s) => ({ id: ulid(), ...s }));

    const rootNode: Record<string, unknown> = {
      PK: this.sessionPk(sessionId),
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
      highlights: {},
      createdAt: now,
    };

    const sessionMeta: Record<string, unknown> = {
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
      // GSI-1: list sessions sorted by last activity
      gsi1pk: this.userPk(sub),
      gsi1sk: `UPDATED#${now}`,
    };

    await Promise.all([this.db.put(rootNode), this.db.put(sessionMeta)]);

    return {
      sessionId,
      title: llmResult.title,
      emoji: llmResult.emoji,
      lede: llmResult.lede,
      createdAt: now,
      updatedAt: now,
      nodeCount: 1,
      nodes: [rootNode],
      annotations: [],
      highlights: [],
    };
  }

  async list(sub: string): Promise<SessionSummary[]> {
    const items = await this.db.queryGsi('gsi1', this.userPk(sub), {
      scanIndexForward: false,
    });
    return items
      .filter((i) => (i['SK'] as string).startsWith('SESSION#'))
      .map(this.toSummary);
  }

  async getSession(sub: string, sessionId: string): Promise<FullSession> {
    // Verify the session belongs to this user
    const meta = await this.db.get(this.userPk(sub), this.sessionSk(sessionId));
    if (!meta) throw new NotFoundException(`Session ${sessionId} not found`);

    // Single query loads all nodes + annotations + highlights for this session
    const items = await this.db.query(this.sessionPk(sessionId));
    const nodes = items.filter((i) => (i['SK'] as string).startsWith('NODE#'));
    const annotations = items.filter((i) => (i['SK'] as string).startsWith('ANN#'));
    const highlights = items.filter((i) => (i['SK'] as string).startsWith('HL#'));

    return {
      ...this.toSummary(meta),
      nodes,
      annotations,
      highlights,
    };
  }

  async update(sub: string, sessionId: string, dto: UpdateSessionDto): Promise<void> {
    const meta = await this.db.get(this.userPk(sub), this.sessionSk(sessionId));
    if (!meta) throw new NotFoundException(`Session ${sessionId} not found`);
    const now = new Date().toISOString();
    await this.db.update(this.userPk(sub), this.sessionSk(sessionId), {
      title: dto.title,
      updatedAt: now,
      gsi1sk: `UPDATED#${now}`,
    });
  }

  async delete(sub: string, sessionId: string): Promise<void> {
    const meta = await this.db.get(this.userPk(sub), this.sessionSk(sessionId));
    if (!meta) throw new NotFoundException(`Session ${sessionId} not found`);

    // Load every item under this session and batch-delete them
    const items = await this.db.query(this.sessionPk(sessionId));
    const sessionKeys = items.map((i) => ({
      pk: i['PK'] as string,
      sk: i['SK'] as string,
    }));
    // Also delete the session metadata from the user partition
    const allKeys = [...sessionKeys, { pk: this.userPk(sub), sk: this.sessionSk(sessionId) }];
    await this.db.batchDelete(allKeys);
  }

  async touchUpdatedAt(sub: string, sessionId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.update(this.userPk(sub), this.sessionSk(sessionId), {
      updatedAt: now,
      gsi1sk: `UPDATED#${now}`,
    });
  }

  async incrementNodeCount(sub: string, sessionId: string, delta: number): Promise<void> {
    const meta = await this.db.get(this.userPk(sub), this.sessionSk(sessionId));
    if (!meta) return;
    const current = (meta['nodeCount'] as number) ?? 0;
    await this.db.update(this.userPk(sub), this.sessionSk(sessionId), {
      nodeCount: Math.max(0, current + delta),
    });
  }

  private toSummary(item: Record<string, unknown>): SessionSummary {
    return {
      sessionId: item['sessionId'] as string,
      title: item['title'] as string,
      emoji: item['emoji'] as string,
      lede: item['lede'] as string,
      createdAt: item['createdAt'] as string,
      updatedAt: item['updatedAt'] as string,
      nodeCount: (item['nodeCount'] as number) ?? 0,
    };
  }
}
