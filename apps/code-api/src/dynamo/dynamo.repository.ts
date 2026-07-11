import { Injectable, Inject } from '@nestjs/common';
import {
  USER_META_MODEL,
  SESSION_META_MODEL,
  NODE_MODEL,
  ANNOTATION_MODEL,
  HIGHLIGHT_MODEL,
  USAGE_EVENT_MODEL,
  PAYMENT_MODEL,
  CREDIT_EVENT_MODEL,
  PROJECT_MODEL,
  AGENT_RUN_MODEL,
  DYNAMO_TABLE,
} from './dynamo.constants';
import type {
  UserMetaItem,
  SessionMetaItem,
  NodeItem,
  AnnotationItem,
  HighlightItem,
  UsageEventItem,
  PaymentItem,
  CreditEventItem,
  ProjectItem,
  AgentRunItem,
} from './dynamo.interfaces';

@Injectable()
export class DynamoRepository {
  constructor(
    @Inject(DYNAMO_TABLE) _table: unknown,
    @Inject(USER_META_MODEL) private readonly userMetaModel: any,
    @Inject(SESSION_META_MODEL) private readonly sessionMetaModel: any,
    @Inject(NODE_MODEL) private readonly nodeModel: any,
    @Inject(ANNOTATION_MODEL) private readonly annotationModel: any,
    @Inject(HIGHLIGHT_MODEL) private readonly highlightModel: any,
    @Inject(USAGE_EVENT_MODEL) private readonly usageEventModel: any,
    @Inject(PAYMENT_MODEL) private readonly paymentModel: any,
    @Inject(CREDIT_EVENT_MODEL) private readonly creditEventModel: any,
    @Inject(PROJECT_MODEL) private readonly projectModel: any,
    @Inject(AGENT_RUN_MODEL) private readonly agentRunModel: any,
  ) {}

  // ── Key helpers ─────────────────────────────────────────────────────────────

  private userPk(sub: string) { return `USER#${sub}`; }
  private sessionSk(sessionId: string) { return `SESSION#${sessionId}`; }
  private sessionPk(sessionId: string) { return `SESSION#${sessionId}`; }
  private nodeSk(nodeId: string) { return `NODE#${nodeId}`; }
  private annSk(annId: string) { return `ANN#${annId}`; }
  private hlSk(hlId: string) { return `HL#${hlId}`; }
  private projectSk(projectId: string) { return `PROJECT#${projectId}`; }
  private agentRunSk(nodeId: string) { return `AGENTRUN#${nodeId}`; }

  private toPlain<T>(item: any): T {
    return (item?.toJSON ? item.toJSON() : item) as T;
  }

  private toPlainArray<T>(items: any[]): T[] {
    return items.map((i) => this.toPlain<T>(i));
  }

  // Dynamoose v4 rejects null for typed String/Number fields even when
  // required: false. Strip nulls so DynamoDB stores absence instead.
  private clean<T extends object>(obj: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(obj).filter(([, v]) => v !== null && v !== undefined),
    ) as Partial<T>;
  }

  // ── User ────────────────────────────────────────────────────────────────────

  async getUserMeta(sub: string): Promise<UserMetaItem | null> {
    const item = await this.userMetaModel.get({ PK: this.userPk(sub), SK: 'METADATA' });
    return item ? this.toPlain<UserMetaItem>(item) : null;
  }

  async putUserMeta(data: UserMetaItem): Promise<void> {
    await this.userMetaModel.create(this.clean(data), { overwrite: true });
  }

  async updateUserMeta(sub: string, updates: Partial<Pick<UserMetaItem, 'hasOnboarded' | 'creditUsd' | 'updatedAt' | 'persona'>>): Promise<void> {
    await this.userMetaModel.update(
      { PK: this.userPk(sub), SK: 'METADATA' },
      { updatedAt: new Date().toISOString(), ...updates },
    );
  }

  async deductCredit(sub: string, amount: number): Promise<void> {
    await this.userMetaModel.update(
      { PK: this.userPk(sub), SK: 'METADATA' },
      { '$ADD': { creditUsd: -amount } },
    );
  }

  async putUsageEvent(data: UsageEventItem): Promise<void> {
    await this.usageEventModel.create(this.clean(data), { overwrite: true });
  }

  async listUsageEvents(sub: string, limit: number): Promise<UsageEventItem[]> {
    const items = await this.usageEventModel
      .query('PK')
      .eq(this.userPk(sub))
      .where('SK')
      .beginsWith('USAGE#')
      .sort('descending')
      .limit(limit)
      .exec();
    return this.toPlainArray<UsageEventItem>(items);
  }

  // ── Payments ─────────────────────────────────────────────────────────────────

  async getPayment(sub: string, paymentId: string): Promise<PaymentItem | null> {
    const item = await this.paymentModel.get({ PK: this.userPk(sub), SK: `PAYMENT#${paymentId}` });
    return item ? this.toPlain<PaymentItem>(item) : null;
  }

  async putPayment(data: PaymentItem): Promise<void> {
    await this.paymentModel.create(this.clean(data), { overwrite: false });
  }

  async addCredit(sub: string, amount: number): Promise<void> {
    await this.userMetaModel.update(
      { PK: this.userPk(sub), SK: 'METADATA' },
      { '$ADD': { creditUsd: amount } },
    );
  }

  // ── Session metadata ─────────────────────────────────────────────────────────

  async getSessionMeta(sub: string, sessionId: string): Promise<SessionMetaItem | null> {
    const item = await this.sessionMetaModel.get({
      PK: this.userPk(sub),
      SK: this.sessionSk(sessionId),
    });
    return item ? this.toPlain<SessionMetaItem>(item) : null;
  }

  async putSessionMeta(data: SessionMetaItem): Promise<void> {
    await this.sessionMetaModel.create(this.clean(data), { overwrite: true });
  }

  async listSessionMeta(sub: string): Promise<SessionMetaItem[]> {
    const items = await this.sessionMetaModel
      .query('gsi1pk')
      .eq(this.userPk(sub))
      .using('gsi1')
      .sort('descending')
      .all() // paginate so users with many sessions see their full History
      .exec();
    return this.toPlainArray<SessionMetaItem>(items);
  }

  async updateSessionMeta(
    sub: string,
    sessionId: string,
    updates: Partial<Pick<SessionMetaItem, 'title' | 'emoji' | 'lede' | 'nodeCount' | 'updatedAt' | 'gsi1sk'>>,
  ): Promise<void> {
    // Dynamoose v4 rejects null for typed fields. Translate null → $REMOVE so
    // callers can clear optional fields by passing null.
    const set: Record<string, unknown> = {};
    const remove: string[] = [];
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) remove.push(k);
      else if (v !== undefined) set[k] = v;
    }
    const op: Record<string, unknown> = { ...set };
    if (remove.length) op.$REMOVE = remove;
    if (!Object.keys(op).length) return;
    await this.sessionMetaModel.update(
      { PK: this.userPk(sub), SK: this.sessionSk(sessionId) },
      op,
    );
  }

  async deleteSessionMeta(sub: string, sessionId: string): Promise<void> {
    await this.sessionMetaModel.delete({
      PK: this.userPk(sub),
      SK: this.sessionSk(sessionId),
    });
  }

  // ── Nodes ────────────────────────────────────────────────────────────────────

  async getNode(sessionId: string, nodeId: string): Promise<NodeItem | null> {
    const item = await this.nodeModel.get({
      PK: this.sessionPk(sessionId),
      SK: this.nodeSk(nodeId),
    });
    return item ? this.toPlain<NodeItem>(item) : null;
  }

  async putNode(data: NodeItem): Promise<void> {
    await this.nodeModel.create(this.clean(data), { overwrite: true });
  }

  async queryNodes(sessionId: string): Promise<NodeItem[]> {
    // .all() paginates past DynamoDB's 1MB-per-Query limit. Without it, a session
    // whose nodes exceed 1MB (a few verbose / web-search answers do) silently
    // loses its newest nodes on load — they render after creation but vanish on
    // refresh.
    const items = await this.nodeModel
      .query('PK')
      .eq(this.sessionPk(sessionId))
      .where('SK')
      .beginsWith('NODE#')
      .all()
      .exec();
    return this.toPlainArray<NodeItem>(items);
  }

  async updateNode(
    sessionId: string,
    nodeId: string,
    updates: Partial<Pick<NodeItem, 'title' | 'starred' | 'commitSha' | 'branchName' | 'commitMessage' | 'diffSummary' | 'agentStatus' | 'imported'>>,
  ): Promise<void> {
    await this.nodeModel.update(
      { PK: this.sessionPk(sessionId), SK: this.nodeSk(nodeId) },
      updates,
    );
  }

  async batchDeleteNodes(sessionId: string, nodeIds: string[]): Promise<void> {
    if (!nodeIds.length) return;
    const pk = this.sessionPk(sessionId);
    const chunks = chunk(nodeIds, 25);
    await Promise.all(
      chunks.map((ids) =>
        this.nodeModel.batchDelete(ids.map((id) => ({ PK: pk, SK: this.nodeSk(id) }))),
      ),
    );
  }

  // ── Annotations ──────────────────────────────────────────────────────────────

  async getAnnotation(sessionId: string, annId: string): Promise<AnnotationItem | null> {
    const item = await this.annotationModel.get({
      PK: this.sessionPk(sessionId),
      SK: this.annSk(annId),
    });
    return item ? this.toPlain<AnnotationItem>(item) : null;
  }

  async putAnnotation(data: AnnotationItem): Promise<void> {
    await this.annotationModel.create(this.clean(data), { overwrite: true });
  }

  async queryAnnotations(sessionId: string): Promise<AnnotationItem[]> {
    const items = await this.annotationModel
      .query('PK')
      .eq(this.sessionPk(sessionId))
      .where('SK')
      .beginsWith('ANN#')
      .all() // paginate past the 1MB Query limit (see queryNodes)
      .exec();
    return this.toPlainArray<AnnotationItem>(items);
  }

  async deleteAnnotation(sessionId: string, annId: string): Promise<void> {
    await this.annotationModel.delete({
      PK: this.sessionPk(sessionId),
      SK: this.annSk(annId),
    });
  }

  async batchDeleteAnnotations(sessionId: string, annIds: string[]): Promise<void> {
    if (!annIds.length) return;
    const pk = this.sessionPk(sessionId);
    const chunks = chunk(annIds, 25);
    await Promise.all(
      chunks.map((ids) =>
        this.annotationModel.batchDelete(ids.map((id) => ({ PK: pk, SK: this.annSk(id) }))),
      ),
    );
  }

  // ── Highlights ───────────────────────────────────────────────────────────────

  async getHighlight(sessionId: string, hlId: string): Promise<HighlightItem | null> {
    const item = await this.highlightModel.get({
      PK: this.sessionPk(sessionId),
      SK: this.hlSk(hlId),
    });
    return item ? this.toPlain<HighlightItem>(item) : null;
  }

  async putHighlight(data: HighlightItem): Promise<void> {
    await this.highlightModel.create(this.clean(data), { overwrite: true });
  }

  async queryHighlights(sessionId: string): Promise<HighlightItem[]> {
    const items = await this.highlightModel
      .query('PK')
      .eq(this.sessionPk(sessionId))
      .where('SK')
      .beginsWith('HL#')
      .all() // paginate past the 1MB Query limit (see queryNodes)
      .exec();
    return this.toPlainArray<HighlightItem>(items);
  }

  async updateHighlight(
    sessionId: string,
    hlId: string,
    updates: Partial<Pick<HighlightItem, 'bg' | 'fg'>>,
  ): Promise<void> {
    await this.highlightModel.update(
      { PK: this.sessionPk(sessionId), SK: this.hlSk(hlId) },
      updates,
    );
  }

  async deleteHighlight(sessionId: string, hlId: string): Promise<void> {
    await this.highlightModel.delete({
      PK: this.sessionPk(sessionId),
      SK: this.hlSk(hlId),
    });
  }

  async batchDeleteHighlights(sessionId: string, hlIds: string[]): Promise<void> {
    if (!hlIds.length) return;
    const pk = this.sessionPk(sessionId);
    const chunks = chunk(hlIds, 25);
    await Promise.all(
      chunks.map((ids) =>
        this.highlightModel.batchDelete(ids.map((id) => ({ PK: pk, SK: this.hlSk(id) }))),
      ),
    );
  }

  // Best-effort signup location enrichment (separate from updateUserMeta, which
  // whitelists only onboarding/credit fields).
  async setUserLocation(
    sub: string,
    loc: { signupIp?: string; signupCountry?: string; signupCity?: string },
  ): Promise<void> {
    const updates = this.clean(loc);
    if (!Object.keys(updates).length) return;
    await this.userMetaModel.update(
      { PK: this.userPk(sub), SK: 'METADATA' },
      { updatedAt: new Date().toISOString(), ...updates },
    );
  }

  // ── Credit events ────────────────────────────────────────────────────────────

  async putCreditEvent(data: CreditEventItem): Promise<void> {
    await this.creditEventModel.create(this.clean(data), { overwrite: true });
  }

  async listCreditEvents(sub: string, limit: number): Promise<CreditEventItem[]> {
    const items = await this.creditEventModel
      .query('PK')
      .eq(this.userPk(sub))
      .where('SK')
      .beginsWith('CREDITEVT#')
      .sort('descending')
      .limit(limit)
      .exec();
    return this.toPlainArray<CreditEventItem>(items);
  }

  // ── Projects ─────────────────────────────────────────────────────────────────

  async putProject(data: ProjectItem): Promise<void> {
    await this.projectModel.create(this.clean(data), { overwrite: true });
  }

  async getProject(sub: string, projectId: string): Promise<ProjectItem | null> {
    const item = await this.projectModel.get({
      PK: this.userPk(sub),
      SK: this.projectSk(projectId),
    });
    return item ? this.toPlain<ProjectItem>(item) : null;
  }

  async listProjects(sub: string): Promise<ProjectItem[]> {
    const items = await this.projectModel
      .query('PK')
      .eq(this.userPk(sub))
      .where('SK')
      .beginsWith('PROJECT#')
      .all()
      .exec();
    return this.toPlainArray<ProjectItem>(items);
  }

  async updateProject(
    sub: string,
    projectId: string,
    updates: Partial<Pick<ProjectItem, 'name' | 'plugins' | 'updatedAt'>>,
  ): Promise<void> {
    await this.projectModel.update(
      { PK: this.userPk(sub), SK: this.projectSk(projectId) },
      updates,
    );
  }

  // ── Agent runs ───────────────────────────────────────────────────────────────

  async putAgentRun(data: AgentRunItem): Promise<void> {
    await this.agentRunModel.create(this.clean(data), { overwrite: true });
  }

  async getAgentRun(sessionId: string, nodeId: string): Promise<AgentRunItem | null> {
    const item = await this.agentRunModel.get({
      PK: this.sessionPk(sessionId),
      SK: this.agentRunSk(nodeId),
    });
    return item ? this.toPlain<AgentRunItem>(item) : null;
  }

  async updateAgentRun(
    sessionId: string,
    nodeId: string,
    updates: Partial<Pick<AgentRunItem, 'status' | 'events' | 'commitSha' | 'branchName' | 'commitMessage' | 'diffSummary' | 'updatedAt'>>,
  ): Promise<void> {
    await this.agentRunModel.update(
      { PK: this.sessionPk(sessionId), SK: this.agentRunSk(nodeId) },
      updates,
    );
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
