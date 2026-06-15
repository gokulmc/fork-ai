import { Injectable, Inject } from '@nestjs/common';
import { providerNameFor } from '../llm/models';
import {
  USER_META_MODEL,
  SESSION_META_MODEL,
  NODE_MODEL,
  ANNOTATION_MODEL,
  HIGHLIGHT_MODEL,
  SHARE_TOKEN_MODEL,
  USAGE_EVENT_MODEL,
  PAYMENT_MODEL,
  ADMIN_AUDIT_MODEL,
  REFERRAL_MODEL,
  CREDIT_EVENT_MODEL,
  BLOG_SUBMISSION_MODEL,
  BLOG_VIEW_MODEL,
  TRIAL_SPEND_MODEL,
  DYNAMO_TABLE,
} from './dynamo.constants';
import type {
  UserMetaItem,
  SessionMetaItem,
  NodeItem,
  AnnotationItem,
  HighlightItem,
  ShareTokenItem,
  UsageEventItem,
  PaymentItem,
  AdminAuditItem,
  ReferralItem,
  CreditEventItem,
  BlogSubmissionItem,
  BlogViewItem,
  TrialSpendItem,
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
    @Inject(SHARE_TOKEN_MODEL) private readonly shareTokenModel: any,
    @Inject(USAGE_EVENT_MODEL) private readonly usageEventModel: any,
    @Inject(PAYMENT_MODEL) private readonly paymentModel: any,
    @Inject(ADMIN_AUDIT_MODEL) private readonly adminAuditModel: any,
    @Inject(REFERRAL_MODEL) private readonly referralModel: any,
    @Inject(CREDIT_EVENT_MODEL) private readonly creditEventModel: any,
    @Inject(BLOG_SUBMISSION_MODEL) private readonly blogSubmissionModel: any,
    @Inject(BLOG_VIEW_MODEL) private readonly blogViewModel: any,
    @Inject(TRIAL_SPEND_MODEL) private readonly trialSpendModel: any,
  ) {}

  // ── Key helpers ─────────────────────────────────────────────────────────────

  private userPk(sub: string) { return `USER#${sub}`; }
  private sessionSk(sessionId: string) { return `SESSION#${sessionId}`; }
  private sessionPk(sessionId: string) { return `SESSION#${sessionId}`; }
  private nodeSk(nodeId: string) { return `NODE#${nodeId}`; }
  private annSk(annId: string) { return `ANN#${annId}`; }
  private hlSk(hlId: string) { return `HL#${hlId}`; }

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

  async updateUserMeta(sub: string, updates: Partial<Pick<UserMetaItem, 'hasOnboarded' | 'creditUsd' | 'updatedAt' | 'referralSlug' | 'referredBy' | 'referralCreditAwarded'>>): Promise<void> {
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

  // ── Trial daily budget ────────────────────────────────────────────────────

  async getTrialSpend(day: string): Promise<number> {
    const item = await this.trialSpendModel.get({ PK: `TRIAL#${day}`, SK: 'METADATA' });
    return item ? (this.toPlain<TrialSpendItem>(item).spentUsd ?? 0) : 0;
  }

  async addTrialSpend(day: string, amount: number): Promise<void> {
    await this.trialSpendModel.update(
      { PK: `TRIAL#${day}`, SK: 'METADATA' },
      { '$ADD': { spentUsd: amount } },
    );
  }

  async updateNotionToken(sub: string, token: string | null): Promise<void> {
    const updates: Partial<UserMetaItem> = { updatedAt: new Date().toISOString() };
    if (token !== null) updates.notionAccessToken = token;
    await this.userMetaModel.update(
      { PK: this.userPk(sub), SK: 'METADATA' },
      updates,
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
    updates: Partial<Pick<SessionMetaItem, 'title' | 'emoji' | 'lede' | 'nodeCount' | 'notionPageUrl' | 'shareToken' | 'updatedAt' | 'gsi1sk'>>,
  ): Promise<void> {
    // Dynamoose v4 rejects null for typed fields. Translate null → $REMOVE so
    // callers can clear optional fields (shareToken, notionPageUrl) by passing null.
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

  async putClaimedSessionMeta(guestSub: string, source: SessionMetaItem): Promise<void> {
    const now = new Date().toISOString();
    const claimed: SessionMetaItem = {
      ...source,
      PK: this.userPk(guestSub),
      SK: this.sessionSk(source.sessionId),
      gsi1pk: this.userPk(guestSub),
      gsi1sk: `UPDATED#${now}`,
      updatedAt: now,
      ownerSub: source.PK.replace('USER#', ''),
      shareToken: null,
    };
    await this.sessionMetaModel.create(this.clean(claimed), { overwrite: true });
  }

  // ── Share tokens ──────────────────────────────────────────────────────────

  private shareTokenPk(token: string) { return `SHARE#${token}`; }

  async putShareToken(token: string, sessionId: string, ownerSub: string): Promise<void> {
    const item: ShareTokenItem = {
      PK: this.shareTokenPk(token),
      SK: 'METADATA',
      token,
      sessionId,
      ownerSub,
      createdAt: new Date().toISOString(),
    };
    await this.shareTokenModel.create(this.clean(item), { overwrite: true });
  }

  async getShareToken(token: string): Promise<ShareTokenItem | null> {
    const item = await this.shareTokenModel.get({ PK: this.shareTokenPk(token), SK: 'METADATA' });
    return item ? this.toPlain<ShareTokenItem>(item) : null;
  }

  async deleteShareToken(token: string): Promise<void> {
    await this.shareTokenModel.delete({ PK: this.shareTokenPk(token), SK: 'METADATA' });
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
    updates: Partial<Pick<NodeItem, 'title' | 'starred'>>,
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

  // ── Referrals ────────────────────────────────────────────────────────────────

  async getReferralBySlug(slug: string): Promise<ReferralItem | null> {
    const item = await this.referralModel.get({ PK: `REFERRAL#${slug}`, SK: 'METADATA' });
    return item ? this.toPlain<ReferralItem>(item) : null;
  }

  async createReferral(data: ReferralItem): Promise<void> {
    await this.referralModel.create(this.clean(data), { overwrite: false });
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

  // ── Admin: audit log ─────────────────────────────────────────────────────────

  async putAuditLog(data: AdminAuditItem): Promise<void> {
    await this.adminAuditModel.create(this.clean(data), { overwrite: false });
  }

  async listAuditLog(limit: number): Promise<AdminAuditItem[]> {
    const items = await this.adminAuditModel
      .query('PK')
      .eq('ADMIN_AUDIT')
      .sort('descending')
      .limit(limit)
      .exec();
    return this.toPlainArray<AdminAuditItem>(items);
  }

  // ── Blog submissions ─────────────────────────────────────────────────────────

  async putBlogSubmission(data: BlogSubmissionItem): Promise<void> {
    await this.blogSubmissionModel.create(this.clean(data), { overwrite: false });
  }

  async listBlogSubmissions(limit: number): Promise<BlogSubmissionItem[]> {
    const items = await this.blogSubmissionModel
      .query('PK')
      .eq('BLOGSUB')
      .sort('descending')
      .limit(limit)
      .exec();
    return this.toPlainArray<BlogSubmissionItem>(items);
  }

  // One author's submissions (the BLOGSUB partition is small, so a filtered
  // query reads it and returns only this author's rows).
  async listBlogSubmissionsByAuthor(sub: string): Promise<BlogSubmissionItem[]> {
    const items = await this.blogSubmissionModel
      .query('PK')
      .eq('BLOGSUB')
      .filter('authorSub')
      .eq(sub)
      .sort('descending')
      .exec();
    return this.toPlainArray<BlogSubmissionItem>(items);
  }

  async updateBlogSubmissionStatus(id: string, status: string): Promise<void> {
    await this.blogSubmissionModel.update({ PK: 'BLOGSUB', SK: id }, { status });
  }

  async listApprovedBlogSubmissions(): Promise<BlogSubmissionItem[]> {
    const items = await this.blogSubmissionModel
      .query('PK')
      .eq('BLOGSUB')
      .filter('status')
      .eq('approved')
      .sort('descending')
      .exec();
    return this.toPlainArray<BlogSubmissionItem>(items);
  }

  async getApprovedBlogSubmissionBySlug(slug: string): Promise<BlogSubmissionItem | null> {
    const items = await this.blogSubmissionModel
      .query('PK')
      .eq('BLOGSUB')
      .filter('slug')
      .eq(slug)
      .filter('status')
      .eq('approved')
      .exec();
    const arr = this.toPlainArray<BlogSubmissionItem>(items);
    return arr[0] ?? null;
  }

  // ── Blog views ───────────────────────────────────────────────────────────────

  async incrementBlogView(slug: string): Promise<number> {
    const updated = await this.blogViewModel.update(
      { PK: 'BLOGVIEW', SK: slug },
      { $ADD: { views: 1 } },
    );
    return this.toPlain<BlogViewItem>(updated).views ?? 0;
  }

  async listBlogViews(): Promise<BlogViewItem[]> {
    const items = await this.blogViewModel.query('PK').eq('BLOGVIEW').exec();
    return this.toPlainArray<BlogViewItem>(items);
  }

  async getBlogView(slug: string): Promise<BlogViewItem | null> {
    const item = await this.blogViewModel.get({ PK: 'BLOGVIEW', SK: slug });
    return item ? this.toPlain<BlogViewItem>(item) : null;
  }

  // ── Admin: cross-user reads ────────────────────────────────────────────────
  // These use table Scans (no GSI spans all users). Callers MUST paginate and
  // cache — an unbounded scan competes for read capacity with live traffic.

  async listPayments(sub: string): Promise<PaymentItem[]> {
    const items = await this.paymentModel
      .query('PK')
      .eq(this.userPk(sub))
      .where('SK')
      .beginsWith('PAYMENT#')
      .sort('descending')
      .exec();
    return this.toPlainArray<PaymentItem>(items);
  }

  // Full filtered scan of all user-profile rows (PK=USER#…, SK=METADATA).
  // NOTE: a Scan FilterExpression with a small Limit returns empty pages until
  // the scan reaches matching items — so we use .all() and return every match.
  async scanUsers(): Promise<UserMetaItem[]> {
    const items = await this.userMetaModel
      .scan('SK')
      .eq('METADATA')
      .and()
      .where('PK')
      .beginsWith('USER#')
      .all()
      .exec();
    return this.toPlainArray<UserMetaItem>(items);
  }

  // Full filtered scan of all payment rows across users.
  async scanPayments(): Promise<PaymentItem[]> {
    const items = await this.paymentModel.scan('SK').beginsWith('PAYMENT#').all().exec();
    return this.toPlainArray<PaymentItem>(items);
  }

  // One projected full-table scan → totals + a daily time-series for charts.
  // Auto-paginates via .all(); projects only key/numeric/date fields.
  async aggregatePlatformMetrics(): Promise<PlatformMetrics> {
    // Each money field must be read through the model that declares it. A scan via
    // userMetaModel returns documents shaped by UserMetaSchema, which (saveUnknown:false)
    // strips costUsd/amountUsd/model — so usage cost and payment revenue need their own
    // scans against the models whose schemas actually define those fields.
    const [metaRows, usageRows, paymentRows] = (await Promise.all([
      this.userMetaModel.scan().attributes(['PK', 'SK', 'creditUsd', 'createdAt']).all().exec(),
      this.usageEventModel.scan('SK').beginsWith('USAGE#').attributes(['costUsd', 'createdAt', 'model']).all().exec(),
      this.paymentModel.scan('SK').beginsWith('PAYMENT#').attributes(['amountUsd', 'createdAt']).all().exec(),
    ])) as [
      Array<{ PK?: string; SK?: string; creditUsd?: number; createdAt?: string }>,
      Array<{ costUsd?: number; createdAt?: string; model?: string }>,
      Array<{ amountUsd?: number; createdAt?: string }>,
    ];

    const m = {
      userCount: 0,
      sessionCount: 0,
      nodeCount: 0,
      revenueUsd: 0,
      llmSpendUsd: 0,
      outstandingCreditUsd: 0,
      llmSpendByProvider: { anthropic: 0, gemini: 0, deepseek: 0 } as ProviderSpend,
    };
    const byDay = new Map<string, MetricsDay>();
    const day = (iso?: string): MetricsDay | null => {
      if (!iso) return null;
      const d = iso.slice(0, 10);
      let entry = byDay.get(d);
      if (!entry) {
        entry = { date: d, users: 0, sessions: 0, nodes: 0, revenueUsd: 0, llmSpendUsd: 0, spendByProvider: { anthropic: 0, gemini: 0, deepseek: 0 } };
        byDay.set(d, entry);
      }
      return entry;
    };

    for (const r of metaRows) {
      const sk = r.SK ?? '';
      if (sk === 'METADATA' && r.PK?.startsWith('USER#')) {
        m.userCount += 1;
        m.outstandingCreditUsd += r.creditUsd ?? 0;
        const e = day(r.createdAt);
        if (e) e.users += 1;
      } else if (sk.startsWith('SESSION#')) {
        m.sessionCount += 1;
        const e = day(r.createdAt);
        if (e) e.sessions += 1;
      } else if (sk.startsWith('NODE#')) {
        m.nodeCount += 1;
        const e = day(r.createdAt);
        if (e) e.nodes += 1;
      }
    }

    for (const r of usageRows) {
      const cost = r.costUsd ?? 0;
      // Provider is derived from the stored model id (legacy events without one were Claude).
      const prov = providerNameFor(r.model ?? '');
      m.llmSpendUsd += cost;
      m.llmSpendByProvider[prov] += cost;
      const e = day(r.createdAt);
      if (e) { e.llmSpendUsd += cost; e.spendByProvider[prov] += cost; }
    }

    for (const r of paymentRows) {
      m.revenueUsd += r.amountUsd ?? 0;
      const e = day(r.createdAt);
      if (e) e.revenueUsd += r.amountUsd ?? 0;
    }

    const series = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    return { ...m, series };
  }

  // Per-day drill-down for the admin histograms: usage grouped by user, plus the
  // actual queries asked that day. Same full-table-scan approach as
  // aggregatePlatformMetrics, filtered to a single day. `date` is YYYY-MM-DD.
  async aggregateDayMetrics(date: string): Promise<DayMetrics> {
    const [usageRows, nodeRows, userRows] = (await Promise.all([
      this.usageEventModel
        .scan('SK').beginsWith('USAGE#')
        .and().where('createdAt').beginsWith(date)
        .attributes(['sub', 'nodeId', 'kind', 'model', 'costUsd', 'inputTokens', 'outputTokens', 'createdAt'])
        .all().exec(),
      this.nodeModel
        .scan('SK').beginsWith('NODE#')
        .and().where('createdAt').beginsWith(date)
        .attributes(['nodeId', 'query', 'title'])
        .all().exec(),
      this.userMetaModel
        .scan('SK').eq('METADATA').and().where('PK').beginsWith('USER#')
        .attributes(['sub', 'email'])
        .all().exec(),
    ])) as [
      Array<{ sub?: string; nodeId?: string; kind?: string; model?: string; costUsd?: number; inputTokens?: number; outputTokens?: number; createdAt?: string }>,
      Array<{ nodeId?: string; query?: string; title?: string }>,
      Array<{ sub?: string; email?: string }>,
    ];

    const nodeById = new Map<string, { query?: string; title?: string }>();
    for (const n of nodeRows) if (n.nodeId) nodeById.set(n.nodeId, n);
    const emailBySub = new Map<string, string>();
    for (const u of userRows) if (u.sub) emailBySub.set(u.sub, u.email ?? '');

    const totals: DayTotals = { costUsd: 0, inputTokens: 0, outputTokens: 0, eventCount: 0, byKind: {}, byModel: {} };
    const usersBySub = new Map<string, DayUser>();
    const topics: DayTopic[] = [];

    for (const r of usageRows) {
      const sub = r.sub ?? '';
      const kind = r.kind ?? 'QUERY';
      const model = r.model || 'unknown';
      const cost = r.costUsd ?? 0;
      const inTok = r.inputTokens ?? 0;
      const outTok = r.outputTokens ?? 0;

      totals.costUsd += cost;
      totals.inputTokens += inTok;
      totals.outputTokens += outTok;
      totals.eventCount += 1;
      totals.byKind[kind] = (totals.byKind[kind] ?? 0) + 1;
      totals.byModel[model] = (totals.byModel[model] ?? 0) + 1;

      let u = usersBySub.get(sub);
      if (!u) {
        u = { sub, email: emailBySub.get(sub) ?? '', costUsd: 0, inputTokens: 0, outputTokens: 0, eventCount: 0, byKind: {}, byModel: {} };
        usersBySub.set(sub, u);
      }
      u.costUsd += cost;
      u.inputTokens += inTok;
      u.outputTokens += outTok;
      u.eventCount += 1;
      u.byKind[kind] = (u.byKind[kind] ?? 0) + 1;
      u.byModel[model] = (u.byModel[model] ?? 0) + 1;

      const node = r.nodeId ? nodeById.get(r.nodeId) : undefined;
      topics.push({
        query: node?.query ?? node?.title ?? '',
        title: node?.title ?? '',
        kind,
        model,
        email: emailBySub.get(sub) ?? '',
        sub,
        costUsd: cost,
        createdAt: r.createdAt ?? '',
      });
    }

    const users = [...usersBySub.values()].sort((a, b) => b.costUsd - a.costUsd);
    topics.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { date, totals, users, topics };
  }
}

export interface ProviderSpend {
  anthropic: number;
  gemini: number;
  deepseek: number;
}

export interface MetricsDay {
  date: string;
  users: number;
  sessions: number;
  nodes: number;
  revenueUsd: number;
  llmSpendUsd: number;
  spendByProvider: ProviderSpend;
}

export interface PlatformMetrics {
  userCount: number;
  sessionCount: number;
  nodeCount: number;
  revenueUsd: number;
  llmSpendUsd: number;
  outstandingCreditUsd: number;
  llmSpendByProvider: ProviderSpend;
  series: MetricsDay[];
}

export interface DayTotals {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  eventCount: number;
  byKind: Record<string, number>;
  byModel: Record<string, number>;
}

export interface DayUser {
  sub: string;
  email: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  eventCount: number;
  byKind: Record<string, number>;
  byModel: Record<string, number>;
}

export interface DayTopic {
  query: string;
  title: string;
  kind: string;
  model: string;
  email: string;
  sub: string;
  costUsd: number;
  createdAt: string;
}

export interface DayMetrics {
  date: string;
  totals: DayTotals;
  users: DayUser[];
  topics: DayTopic[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
