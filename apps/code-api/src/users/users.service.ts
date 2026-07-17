import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import { DynamoRepository } from '@/dynamo/dynamo.repository';
import type { UserMetaItem, UsageEventItem, CreditEventItem, HoldItem, MachineBillItem } from '@/dynamo/dynamo.interfaces';
import { CognitoUser } from '@/auth/jwt.strategy';
import { priceFor, machineSecondsCostUsd, machineSplitCostUsd } from '@/llm/models';

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

  // ── Cloud-run billing (ADR-0004) ────────────────────────────────────────────
  // See root CLAUDE.md's ADR-0004 note for the design: a strict pre-auth hold
  // at run start, settled exactly once at run end via the conditional flip in
  // DynamoRepository.reconcileHoldStatus, plus full-machine-lifetime billing
  // guarded by DynamoRepository.putMachineBill. Non-cloud paths keep using
  // checkCredit/billUsage above, untouched.

  // Money-correctness fix I1/M1: the strict pre-auth gate and the deduction
  // are now ONE atomic conditional op (deductCreditIfSufficient), not a
  // read-then-check-then-write — closing the TOCTOU window where two
  // concurrent cloud runs could each pass a stale balance check and overdraw
  // past $0. Deduct-FIRST ordering also means putHold can never leave an
  // orphan 'held' record with no matching deduction behind it (the old bug:
  // deductCredit throwing after putHold succeeded left free, un-taken money
  // "reserved" that reconcileStaleHolds would later release back — net zero
  // charge for a run that actually happened). If putHold itself throws AFTER
  // the deduct succeeds, compensate with addCredit before rethrowing so the
  // reserve isn't stranded either way.
  async placeHold(sub: string, sessionId: string, nodeId: string, model: string): Promise<{ holdUsd: number; ceilingUsd: number }> {
    const holdUsd = this.cfg.get<number>('billing.sandboxHoldUsd') ?? 1.00;
    const maxRunCostUsd = this.cfg.get<number>('billing.maxRunCostUsd') ?? 1.00;

    // Only used for the ceiling's min(cap, balance) — the actual strict gate
    // is the atomic conditional deduct below, so a slightly-stale read here
    // (a concurrent spend landing between this read and the deduct) is
    // harmless: it can only make the ceiling a little more generous, never
    // let an insufficient-balance run through.
    const user = await this.db.getUserMeta(sub);
    const ceilingUsd = Math.min(maxRunCostUsd, user?.creditUsd ?? 0);

    const ok = await this.db.deductCreditIfSufficient(sub, holdUsd);
    if (!ok) {
      throw new HttpException('Payment Required — insufficient credit for a cloud run', HttpStatus.PAYMENT_REQUIRED);
    }

    const now = new Date().toISOString();
    const hold: HoldItem = {
      PK: `USER#${sub}`,
      SK: `HOLD#${nodeId}`,
      sub,
      nodeId,
      sessionId,
      holdUsd,
      status: 'held',
      model,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.db.putHold(hold);
    } catch (err) {
      await this.db.addCredit(sub, holdUsd); // undo the deduct — never strand the reserve
      throw err;
    }
    return { holdUsd, ceilingUsd };
  }

  // ADR-0004 redesign: the caller supplies the already-computed cost
  // (runCostUsd — claude's own reported total_cost_usd × creditMultiplier,
  // or a token-based fallback for the rare run with no reported cost — see
  // nodes.service.ts). Per-message token counts from the sandbox stream are
  // placeholder values and were never a valid billing basis, so this method
  // no longer computes cost itself; inputTokens/outputTokens are recorded on
  // the usage event purely as audit/analytics fields.
  async reconcileHold(
    sub: string,
    sessionId: string,
    nodeId: string,
    runCostUsd: number,
    inputTokens: number,
    outputTokens: number,
    model: string,
    kind: 'QUERY' | 'DEEPER' | 'ASK' | 'MIX' | 'PLAN' | 'CODE' = 'CODE',
  ): Promise<void> {
    // The flip precedes release/charge and is the exactly-once guard: a run's
    // own done/error path and a concurrent reconcileStaleHolds sweep tick can
    // both reach this for the same nodeId, and only the winner may settle.
    const won = await this.db.reconcileHoldStatus(sub, nodeId);
    if (!won) return;

    const hold = await this.db.getHold(sub, nodeId);
    if (!hold) {
      // Shouldn't happen — a winning flip implies the HoldItem existed (an
      // update's ConditionExpression can't match a nonexistent attribute).
      // Defensive only: never charge blind.
      this.logger.warn(`reconcileHold: winning flip but no HoldItem for sub=${sub} nodeId=${nodeId}`);
      return;
    }

    const usageId = ulid();
    const event: UsageEventItem = {
      PK: `USER#${sub}`,
      SK: `USAGE#${usageId}`,
      usageId,
      sub,
      inputTokens,
      outputTokens,
      costUsd: runCostUsd,
      kind,
      model,
      sessionId,
      nodeId,
      createdAt: new Date().toISOString(),
      runId: nodeId,
    };

    // Money-correctness fix I2: release(+holdUsd) and charge(-costUsd) used to
    // be two independent $ADD calls — if one succeeded and the other threw,
    // the mis-bill was permanent (the flip guard above is already spent, so
    // no retry can re-settle it). A single net atomic $ADD can't partially
    // apply: net = holdUsd - runCostUsd is identical to the old two-op result
    // when both succeeded, but now it's all-or-nothing.
    await this.db.deductCredit(sub, runCostUsd - hold.holdUsd);
    // Best-effort audit row — losing it loses only the audit trail, not
    // money (the settlement above already landed), so a write failure here
    // must not throw past a successful settlement.
    await this.db.putUsageEvent(event).catch((err) => {
      this.logger.warn(`reconcileHold: putUsageEvent failed after settlement sub=${sub} nodeId=${nodeId}: ${String(err)}`);
    });
  }

  async billMachineUsage(
    sub: string,
    sandboxId: string,
    sessionId: string,
    nodeId: string,
    createdAtIso: string,
    destroyAtMs: number,
  ): Promise<void> {
    const seconds = Math.max(0, (destroyAtMs - Date.parse(createdAtIso)) / 1000);
    const rate = this.cfg.get<number>('billing.flyMinuteRateUsd') ?? 0.0009;
    const multiplier = this.cfg.get<number>('billing.creditMultiplier') ?? 1.5;
    const costUsd = machineSecondsCostUsd(seconds, rate, multiplier);

    const now = new Date().toISOString();
    const bill: MachineBillItem = {
      PK: `USER#${sub}`,
      SK: `MACHINEBILL#${sandboxId}`,
      sub,
      sandboxId,
      sessionId,
      nodeId,
      machineSeconds: seconds,
      costUsd,
      createdAt: now,
    };
    // Guard-before-charge: this conditional create MUST precede deductCredit
    // so a sweep tick racing the runner's own error-path `finally` bills the
    // machine exactly once.
    const won = await this.db.putMachineBill(bill);
    if (!won) return;

    const usageId = ulid();
    const event: UsageEventItem = {
      PK: `USER#${sub}`,
      SK: `USAGE#${usageId}`,
      usageId,
      sub,
      inputTokens: 0,
      outputTokens: 0,
      costUsd,
      kind: 'MACHINE',
      model: 'fly:machine',
      sessionId,
      nodeId,
      createdAt: now,
      runId: nodeId,
      machineSeconds: seconds,
    };

    await this.db.deductCredit(sub, costUsd);
    // Best-effort audit row, same reasoning as reconcileHold's — the charge
    // above already landed, so a putUsageEvent failure here must only lose
    // the audit trail, never mask/undo the settled charge.
    await this.db.putUsageEvent(event).catch((err) => {
      this.logger.warn(`billMachineUsage: putUsageEvent failed after settlement sub=${sub} sandboxId=${sandboxId}: ${String(err)}`);
    });
    // Best-effort — surfaces the machine cost on the node's own cost
    // breakdown (alongside runCostUsd) for an accurate total; a write failure
    // here must never mask/undo the settled charge above either.
    await this.db.updateNode(sessionId, nodeId, { machineCostUsd: costUsd }).catch((err) => {
      this.logger.warn(`billMachineUsage: updateNode failed after settlement sub=${sub} sandboxId=${sandboxId} nodeId=${nodeId}: ${String(err)}`);
    });
  }

  // Blaxel split-billing counterpart of billMachineUsage: charges the active
  // compute window (create → activeUntil) at the Blaxel per-minute rate and the
  // idle standby window (activeUntil → destroy) at the near-zero per-GB-second
  // storage rate. activeUntilMs absent (error/no-result path, or an un-tagged
  // machine) ⇒ the whole lifetime is billed as active, no idle. Reuses the same
  // MACHINEBILL#<sandboxId> idempotency key + guard-before-charge ordering as
  // billMachineUsage, so a sweep tick racing the runner's error-path finally
  // bills exactly once.
  async billBlaxelMachineUsage(
    sub: string,
    sandboxId: string,
    sessionId: string,
    nodeId: string,
    createdAtIso: string,
    destroyAtMs: number,
    activeUntilMs?: number,
  ): Promise<void> {
    const createdAtMs = Date.parse(createdAtIso);
    const totalSeconds = Math.max(0, (destroyAtMs - createdAtMs) / 1000);
    // Clamp activeUntil into [created, destroy] so a stale/garbage tag can never
    // produce negative or over-total active seconds.
    const activeEndMs = activeUntilMs ? Math.min(Math.max(activeUntilMs, createdAtMs), destroyAtMs) : destroyAtMs;
    const activeSeconds = Math.max(0, (activeEndMs - createdAtMs) / 1000);
    const idleSeconds = Math.max(0, totalSeconds - activeSeconds);

    const activeRate = this.cfg.get<number>('billing.blaxelActiveMinuteRateUsd') ?? 0.0028;
    const idleRate = this.cfg.get<number>('billing.blaxelStandbyGbSecondRateUsd') ?? 0.0000000772;
    const memoryGb = this.cfg.get<number>('billing.blaxelMemoryGb') ?? 4;
    const multiplier = this.cfg.get<number>('billing.creditMultiplier') ?? 1.5;
    const costUsd = machineSplitCostUsd(activeSeconds, idleSeconds, activeRate, idleRate, memoryGb, multiplier);

    const now = new Date().toISOString();
    const bill: MachineBillItem = {
      PK: `USER#${sub}`,
      SK: `MACHINEBILL#${sandboxId}`,
      sub,
      sandboxId,
      sessionId,
      nodeId,
      machineSeconds: totalSeconds,
      costUsd,
      createdAt: now,
    };
    const won = await this.db.putMachineBill(bill);
    if (!won) return;

    const usageId = ulid();
    const event: UsageEventItem = {
      PK: `USER#${sub}`,
      SK: `USAGE#${usageId}`,
      usageId,
      sub,
      inputTokens: 0,
      outputTokens: 0,
      costUsd,
      kind: 'MACHINE',
      model: 'blaxel:machine',
      sessionId,
      nodeId,
      createdAt: now,
      runId: nodeId,
      machineSeconds: totalSeconds,
    };

    await this.db.deductCredit(sub, costUsd);
    await this.db.putUsageEvent(event).catch((err) => {
      this.logger.warn(`billBlaxelMachineUsage: putUsageEvent failed after settlement sub=${sub} sandboxId=${sandboxId}: ${String(err)}`);
    });
    await this.db.updateNode(sessionId, nodeId, { machineCostUsd: costUsd }).catch((err) => {
      this.logger.warn(`billBlaxelMachineUsage: updateNode failed after settlement sub=${sub} sandboxId=${sandboxId} nodeId=${nodeId}: ${String(err)}`);
    });
  }

  // Crash net, called each sweep tick: releases the reserve for holds whose
  // run process died before a done/error event ever reconciled them. Tokens
  // were never observed for these, so only the flat holdUsd reserve is
  // returned — a bounded, intentional under-charge (see root CLAUDE.md's
  // ADR-0004 tolerated-gaps note; the machine itself is still billed
  // separately at sweep age-cap destroy).
  async reconcileStaleHolds(cutoffMinutes = 30): Promise<void> {
    const cutoffIso = new Date(Date.now() - cutoffMinutes * 60_000).toISOString();
    const stale = await this.db.scanHeldHolds(cutoffIso);
    for (const h of stale) {
      if (await this.db.reconcileHoldStatus(h.sub, h.nodeId)) {
        await this.db.addCredit(h.sub, h.holdUsd);
      }
    }
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
