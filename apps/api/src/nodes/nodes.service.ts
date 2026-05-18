import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { LlmService } from '@/llm/llm.service';
import { SessionsService } from '@/sessions/sessions.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';

@Injectable()
export class NodesService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly llm: LlmService,
    private readonly sessions: SessionsService,
  ) {}

  private sessionPk(sessionId: string) { return `SESSION#${sessionId}`; }
  private nodeSk(nodeId: string) { return `NODE#${nodeId}`; }

  async createNode(
    sub: string,
    sessionId: string,
    dto: CreateNodeDto,
  ): Promise<Record<string, unknown>> {
    // Load all session nodes in one query — needed for ancestor chain
    const session = await this.sessions.getSession(sub, sessionId);
    const allNodes = session.nodes as Record<string, unknown>[];
    const nodeById = new Map(allNodes.map(n => [n['nodeId'] as string, n]));

    const parent = nodeById.get(dto.parentNodeId);
    if (!parent) throw new NotFoundException(`Parent node ${dto.parentNodeId} not found`);

    // Walk up to root to build context trail (root first)
    const ancestors: Array<{ title: string; query: string }> = [];
    let cur: string | null = dto.parentNodeId;
    while (cur) {
      const n = nodeById.get(cur);
      if (!n) break;
      ancestors.unshift({ title: n['title'] as string, query: n['query'] as string });
      cur = (n['parentId'] as string | null);
    }

    let llmResult;
    let fromText: string;

    if (dto.kind === 'DEEPER') {
      if (!dto.sectionBody) throw new BadRequestException('sectionBody required for DEEPER nodes');
      llmResult = await this.llm.expandSection(ancestors, dto.query, dto.sectionBody);
      fromText = `${dto.query}: ${dto.sectionBody.slice(0, 200)}…`;
    } else {
      // ASK
      if (!dto.highlightText) throw new BadRequestException('highlightText required for ASK nodes');
      llmResult = await this.llm.followUpFromHighlight(ancestors, dto.highlightText, dto.query);
      fromText = dto.highlightText;
    }

    const nodeId = ulid();
    const now = new Date().toISOString();
    const sections = llmResult.sections.map((s) => ({ id: ulid(), ...s }));

    const node: Record<string, unknown> = {
      PK: this.sessionPk(sessionId),
      SK: this.nodeSk(nodeId),
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
      highlights: {},
      createdAt: now,
    };

    await this.db.put(node);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, 1),
    ]);

    return node;
  }

  async renameNode(
    sub: string,
    sessionId: string,
    nodeId: string,
    dto: UpdateNodeDto,
  ): Promise<void> {
    await this.sessions.getSession(sub, sessionId);
    const node = await this.db.get(this.sessionPk(sessionId), this.nodeSk(nodeId));
    if (!node) throw new NotFoundException(`Node ${nodeId} not found`);
    await this.db.update(this.sessionPk(sessionId), this.nodeSk(nodeId), { title: dto.title });
  }

  async deleteBranch(sub: string, sessionId: string, nodeId: string): Promise<void> {
    await this.sessions.getSession(sub, sessionId);

    // Load all nodes in the session to find descendants
    const allNodes = await this.db.query(this.sessionPk(sessionId), 'NODE#');
    const nodeMap = new Map(allNodes.map((n) => [n['nodeId'] as string, n]));

    if (!nodeMap.has(nodeId)) throw new NotFoundException(`Node ${nodeId} not found`);

    // BFS to collect the subtree
    const toDelete = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length) {
      const current = queue.shift()!;
      for (const n of nodeMap.values()) {
        if (n['parentId'] === current && !toDelete.has(n['nodeId'] as string)) {
          const id = n['nodeId'] as string;
          toDelete.add(id);
          queue.push(id);
        }
      }
    }

    const keys = [...toDelete].map((id) => ({
      pk: this.sessionPk(sessionId),
      sk: this.nodeSk(id),
    }));

    // Also delete all annotations and highlights attached to these nodes
    const annAndHl = (await this.db.query(this.sessionPk(sessionId))).filter((i) => {
      const sk = i['SK'] as string;
      return (
        (sk.startsWith('ANN#') || sk.startsWith('HL#')) &&
        toDelete.has(i['nodeId'] as string)
      );
    });
    const extraKeys = annAndHl.map((i) => ({
      pk: i['PK'] as string,
      sk: i['SK'] as string,
    }));

    await this.db.batchDelete([...keys, ...extraKeys]);
    await Promise.all([
      this.sessions.touchUpdatedAt(sub, sessionId),
      this.sessions.incrementNodeCount(sub, sessionId, -toDelete.size),
    ]);
  }
}
