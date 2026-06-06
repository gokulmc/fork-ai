import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import { SessionsService } from '@/sessions/sessions.service';
import type { UserMetaItem, PaymentItem, AdminAuditItem } from '@/dynamo/dynamo.interfaces';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Actor {
  sub: string;
  email: string;
}

// Captured once at module load — process start time for uptime reporting.
const PROCESS_STARTED_AT = new Date().toISOString();

const METRICS_TTL_MS = 60_000;

@Injectable()
export class AdminService {
  private metricsCache: { at: number; data: unknown } | null = null;

  constructor(
    private readonly db: DynamoRepository,
    private readonly sessions: SessionsService,
    private readonly cfg: ConfigService,
  ) {}

  // Cached so a dashboard refresh doesn't re-scan the whole table each time.
  // `fresh` bypasses the cache (the dashboard's Refresh button) for an up-to-date read.
  async getMetrics(fresh = false) {
    const now = Date.now();
    if (!fresh && this.metricsCache && now - this.metricsCache.at < METRICS_TTL_MS) {
      return this.metricsCache.data;
    }
    const data = await this.db.aggregatePlatformMetrics();
    this.metricsCache = { at: now, data };
    return data;
  }

  // Per-day drill-down for the admin histograms — user-level usage + the day's
  // queries. Not cached: it's an explicit bar-click, not a polled dashboard.
  async getDayMetrics(date: string) {
    return this.db.aggregateDayMetrics(date);
  }

  // Full filtered scan (table is small); pagination params kept for API
  // compatibility but every match is returned with a null cursor.
  async listUsers(): Promise<Page<UserMetaItem>> {
    const items = await this.db.scanUsers();
    items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return { items, nextCursor: null };
  }

  async getUser(sub: string) {
    const meta = await this.db.getUserMeta(sub);
    if (!meta) throw new NotFoundException(`User ${sub} not found`);
    const [sessions, usage, payments] = await Promise.all([
      this.db.listSessionMeta(sub),
      this.db.listUsageEvents(sub, 50),
      this.db.listPayments(sub),
    ]);
    return { user: meta, sessions, usage, payments };
  }

  async listPayments(): Promise<Page<PaymentItem>> {
    const items = await this.db.scanPayments();
    items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return { items, nextCursor: null };
  }

  // This API instance's build/runtime info. commit is baked in at build time
  // (APP_COMMIT); falls back to the CodeBuild source version or 'dev'.
  getDeployment() {
    return {
      commit:
        this.cfg.get<string>('app.commit') ??
        process.env.APP_COMMIT ??
        process.env.CODEBUILD_RESOLVED_SOURCE_VERSION ??
        'dev',
      version: process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.1.0',
      env: process.env.NODE_ENV ?? 'development',
      region: this.cfg.get<string>('aws.region') ?? 'ap-south-1',
      startedAt: PROCESS_STARTED_AT,
      uptimeSec: Math.round(process.uptime()),
    };
  }

  // mode 'add' applies a (possibly negative) delta via $ADD; 'set' writes an
  // absolute balance. Both reuse existing repo methods — no billing logic touched.
  async adjustCredit(
    actor: Actor,
    sub: string,
    amountUsd: number,
    mode: 'add' | 'set',
  ): Promise<{ creditUsd: number }> {
    const existing = await this.db.getUserMeta(sub);
    if (!existing) throw new NotFoundException(`User ${sub} not found`);
    let creditUsd: number;
    if (mode === 'set') {
      await this.db.updateUserMeta(sub, { creditUsd: amountUsd });
      creditUsd = amountUsd;
    } else {
      await this.db.addCredit(sub, amountUsd);
      creditUsd = (existing.creditUsd ?? 0) + amountUsd;
    }
    await this.audit(actor, 'credit.adjust', sub, `${mode} ${amountUsd} → ${creditUsd.toFixed(2)}`);
    return { creditUsd };
  }

  async deleteSession(actor: Actor, sub: string, sessionId: string): Promise<void> {
    await this.sessions.delete(sub, sessionId);
    await this.audit(actor, 'session.delete', sub, sessionId);
  }

  async listAudit(limit: number): Promise<AdminAuditItem[]> {
    return this.db.listAuditLog(limit);
  }

  getConfig(): { signupCreditUsd: number; referralCreditUsd: number; creditMultiplier: number } {
    return {
      signupCreditUsd: this.cfg.get<number>('billing.signupCreditUsd') ?? 5.00,
      referralCreditUsd: this.cfg.get<number>('billing.referralCreditUsd') ?? 5.00,
      creditMultiplier: this.cfg.get<number>('billing.creditMultiplier') ?? 1.5,
    };
  }

  private async audit(actor: Actor, action: string, targetSub: string, detail: string): Promise<void> {
    const auditId = ulid();
    const item: AdminAuditItem = {
      PK: 'ADMIN_AUDIT',
      SK: `AUDIT#${auditId}`,
      auditId,
      actorSub: actor.sub,
      actorEmail: actor.email,
      action,
      targetSub,
      detail,
      createdAt: new Date().toISOString(),
    };
    await this.db.putAuditLog(item);
  }
}
