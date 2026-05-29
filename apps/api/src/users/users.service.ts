import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { UserMetaItem, UsageEventItem, CreditEventItem } from '@/dynamo/dynamo.interfaces';
import { CognitoUser } from '@/auth/jwt.strategy';

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

    void this.maybeAwardReferralCredit(sub);
  }

  async getUsageEvents(sub: string): Promise<UsageEventItem[]> {
    return this.db.listUsageEvents(sub, 50);
  }

  async getCreditEvents(sub: string): Promise<CreditEventItem[]> {
    return this.db.listCreditEvents(sub, 50);
  }

  async getOrCreateReferralLink(sub: string, email: string): Promise<{ slug: string; url: string }> {
    const existing = await this.db.getUserMeta(sub);
    if (existing?.referralSlug) {
      const frontendUrl = this.cfg.get<string>('frontendUrl') ?? 'http://localhost:3001';
      return { slug: existing.referralSlug, url: `${frontendUrl}?ref=${existing.referralSlug}` };
    }

    const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    let candidate = base;
    let counter = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const taken = await this.db.getReferralBySlug(candidate);
      if (!taken) break;
      if (taken.sub === sub) {
        await this.db.updateUserMeta(sub, { referralSlug: candidate });
        const frontendUrl = this.cfg.get<string>('frontendUrl') ?? 'http://localhost:3001';
        return { slug: candidate, url: `${frontendUrl}?ref=${candidate}` };
      }
      counter += 1;
      candidate = `${base}${counter}`;
    }

    await this.db.createReferral({
      PK: `REFERRAL#${candidate}`,
      SK: 'METADATA',
      slug: candidate,
      sub,
      email,
      createdAt: new Date().toISOString(),
    });
    await this.db.updateUserMeta(sub, { referralSlug: candidate });

    const frontendUrl = this.cfg.get<string>('frontendUrl') ?? 'http://localhost:3001';
    return { slug: candidate, url: `${frontendUrl}?ref=${candidate}` };
  }

  async recordReferral(sub: string, referrerSlug: string): Promise<void> {
    const user = await this.db.getUserMeta(sub);
    if (!user) { this.logger.log(`[referral] recordReferral: user not found sub=${sub}`); return; }
    if (user.referredBy) { this.logger.log(`[referral] recordReferral: already attributed sub=${sub} referredBy=${user.referredBy}`); return; }

    const referrer = await this.db.getReferralBySlug(referrerSlug);
    if (!referrer) { this.logger.log(`[referral] recordReferral: slug not found slug=${referrerSlug}`); return; }
    if (referrer.sub === sub) { this.logger.log(`[referral] recordReferral: self-referral blocked sub=${sub}`); return; }

    await this.db.updateUserMeta(sub, { referredBy: referrer.sub });
    this.logger.log(`[referral] recorded: sub=${sub} referredBy=${referrer.sub}`);
  }

  private async maybeAwardReferralCredit(sub: string): Promise<void> {
    try {
      const user = await this.db.getUserMeta(sub);
      if (!user?.referredBy) { return; }
      if (user.referralCreditAwarded) { return; }

      const referralCreditUsd = this.cfg.get<number>('billing.referralCreditUsd') ?? 5.00;
      this.logger.log(`[referral] awarding $${referralCreditUsd} to referrer=${user.referredBy} for referred=${sub}`);
      const creditEventId = ulid();
      const creditEvent: CreditEventItem = {
        PK: `USER#${user.referredBy}`,
        SK: `CREDITEVT#${creditEventId}`,
        creditEventId,
        sub: user.referredBy,
        type: 'REFERRAL',
        amountUsd: referralCreditUsd,
        createdAt: new Date().toISOString(),
      };
      await Promise.all([
        this.db.addCredit(user.referredBy, referralCreditUsd),
        this.db.updateUserMeta(sub, { referralCreditAwarded: true }),
        this.db.putCreditEvent(creditEvent),
      ]);
      this.logger.log(`[referral] credit awarded OK referrer=${user.referredBy}`);
    } catch (err) {
      this.logger.warn(`[referral] award failed for ${sub}: ${String(err)}`);
    }
  }
}

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('127.') || ip === 'localhost') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('::ffff:')) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}
