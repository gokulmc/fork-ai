import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { UserMetaItem, UsageEventItem, CreditEventItem } from '@/dynamo/dynamo.interfaces';
import { CognitoUser } from '@/auth/jwt.strategy';
import { priceFor } from '@/llm/models';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly db: DynamoRepository,
    private readonly cfg: ConfigService,
  ) {}

  async upsert(user: CognitoUser, ip?: string): Promise<UserMetaItem> {
    const existing = await this.db.getUserMeta(user.sub);
    if (existing) {
      if (existing.creditUsd == null) {
        const signupCredit = this.cfg.get<number>('billing.signupCreditUsd') ?? 5.00;
        await this.db.updateUserMeta(user.sub, { creditUsd: signupCredit });
        return { ...existing, creditUsd: signupCredit };
      }
      return existing;
    }

    const now = new Date().toISOString();
    const signupCredit = this.cfg.get<number>('billing.signupCreditUsd') ?? 5.00;
    const record: UserMetaItem = {
      PK: `USER#${user.sub}`,
      SK: 'METADATA',
      sub: user.sub,
      email: user.email,
      createdAt: now,
      updatedAt: now,
      creditUsd: signupCredit,
    };
    await this.db.putUserMeta(record);
    // Fire-and-forget — enrichment must never block or fail user creation.
    void this.enrichLocation(user.sub, ip);
    return record;
  }

  // Best-effort geo lookup of the signup IP. Swallows all errors.
  private async enrichLocation(sub: string, ip?: string): Promise<void> {
    if (!ip || isPrivateIp(ip)) return;
    try {
      const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,city`);
      if (!res.ok) return;
      const data = (await res.json()) as { status?: string; country?: string; city?: string };
      await this.db.setUserLocation(sub, {
        signupIp: ip,
        signupCountry: data.status === 'success' ? data.country : undefined,
        signupCity: data.status === 'success' ? data.city : undefined,
      });
    } catch (err) {
      this.logger.warn(`Location enrichment failed for ${sub}: ${String(err)}`);
    }
  }

  async getMe(sub: string): Promise<UserMetaItem | null> {
    return this.db.getUserMeta(sub);
  }

  async patchMe(sub: string, updates: { hasOnboarded?: boolean; persona?: string }): Promise<void> {
    await this.db.updateUserMeta(sub, updates);
  }

  // Persona is prepended to every LLM prompt for this user. Returns undefined
  // (not injected) until the user first saves a non-empty one.
  async getPersona(sub: string): Promise<string | undefined> {
    const user = await this.db.getUserMeta(sub);
    const persona = user?.persona?.trim();
    return persona ? persona : undefined;
  }

  async checkCredit(sub: string): Promise<void> {
    const user = await this.db.getUserMeta(sub);
    const credit = user?.creditUsd ?? 0;
    if (credit <= 0) {
      throw new HttpException('Payment Required — out of credit', HttpStatus.PAYMENT_REQUIRED);
    }
  }

  async billUsage(
    sub: string,
    inputTokens: number,
    outputTokens: number,
    kind: 'QUERY' | 'DEEPER' | 'ASK' | 'MIX' | 'PLAN' | 'CODE',
    sessionId: string,
    nodeId: string,
    model: string,
  ): Promise<void> {
    const multiplier = this.cfg.get<number>('billing.creditMultiplier') ?? 1.5;
    const now = new Date();
    const rate = priceFor(model, now);
    const rawCost = (inputTokens * rate.input / 1_000_000) + (outputTokens * rate.output / 1_000_000);
    const costUsd = Math.round(rawCost * multiplier * 1_000_000) / 1_000_000;

    const usageId = ulid();
    const event: UsageEventItem = {
      PK: `USER#${sub}`,
      SK: `USAGE#${usageId}`,
      usageId,
      sub,
      inputTokens,
      outputTokens,
      costUsd,
      kind,
      model,
      sessionId,
      nodeId,
      createdAt: now.toISOString(),
    };

    await Promise.all([
      this.db.deductCredit(sub, costUsd),
      this.db.putUsageEvent(event),
    ]);
  }

  async getUsageEvents(sub: string): Promise<UsageEventItem[]> {
    return this.db.listUsageEvents(sub, 50);
  }

  async getCreditEvents(sub: string): Promise<CreditEventItem[]> {
    return this.db.listCreditEvents(sub, 50);
  }
}

export function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('127.') || ip === 'localhost') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('::ffff:')) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}
