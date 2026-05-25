import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { UserMetaItem, UsageEventItem } from '@/dynamo/dynamo.interfaces';
import { CognitoUser } from '@/auth/jwt.strategy';

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DynamoRepository,
    private readonly cfg: ConfigService,
  ) {}

  async upsert(user: CognitoUser): Promise<UserMetaItem> {
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
    return record;
  }

  async getMe(sub: string): Promise<UserMetaItem | null> {
    return this.db.getUserMeta(sub);
  }

  async patchMe(sub: string, updates: { hasOnboarded?: boolean }): Promise<void> {
    await this.db.updateUserMeta(sub, updates);
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
    kind: 'QUERY' | 'DEEPER' | 'ASK',
    sessionId: string,
    nodeId: string,
  ): Promise<void> {
    const multiplier = this.cfg.get<number>('billing.creditMultiplier') ?? 1.5;
    // Sonnet pricing: $3/1M input, $15/1M output
    const rawCost = (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000);
    const costUsd = Math.round(rawCost * multiplier * 1_000_000) / 1_000_000;

    const usageId = ulid();
    const now = new Date().toISOString();
    const event: UsageEventItem = {
      PK: `USER#${sub}`,
      SK: `USAGE#${usageId}`,
      usageId,
      sub,
      inputTokens,
      outputTokens,
      costUsd,
      kind,
      sessionId,
      nodeId,
      createdAt: now,
    };

    await Promise.all([
      this.db.deductCredit(sub, costUsd),
      this.db.putUsageEvent(event),
    ]);
  }

  async getUsageEvents(sub: string): Promise<UsageEventItem[]> {
    return this.db.listUsageEvents(sub, 50);
  }
}
