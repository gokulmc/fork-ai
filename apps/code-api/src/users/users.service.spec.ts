import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { DynamoRepository } from '@/dynamo/dynamo.repository';

const mockDb = {
  getUserMeta: jest.fn(),
  putHold: jest.fn(),
  getHold: jest.fn(),
  reconcileHoldStatus: jest.fn(),
  putMachineBill: jest.fn(),
  scanHeldHolds: jest.fn(),
  deductCredit: jest.fn(),
  deductCreditIfSufficient: jest.fn(),
  addCredit: jest.fn(),
  putUsageEvent: jest.fn(),
  updateNode: jest.fn(),
};

// Billing config used by the new hold/machine-billing methods — see
// configuration.ts's `billing` block. Tests override individual keys where
// the exact value matters; unset keys fall back to the service's `?? default`.
const CFG: Record<string, number> = {
  'billing.sandboxHoldUsd': 1.0,
  'billing.maxRunCostUsd': 1.0,
  'billing.creditMultiplier': 1.5,
  'billing.flyMinuteRateUsd': 0.0009,
  'billing.blaxelActiveMinuteRateUsd': 0.0028,
  'billing.blaxelStandbyGbSecondRateUsd': 0.0000000772,
  'billing.blaxelMemoryGb': 4,
};

const mockCfg = { get: jest.fn((key: string) => CFG[key]) };

const SUB = 'user-sub-123';
const SESSION_ID = '01HZSESS';
const NODE_ID = '01HZNODE';
const MODEL = 'claude-sonnet-5';

describe('UsersService — cloud-run billing (ADR-0004)', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCfg.get.mockImplementation((key: string) => CFG[key]);
    // putUsageEvent is now chained with .catch() (best-effort audit write —
    // see I2/M1 fixes), so the mock must resolve, not return undefined.
    mockDb.putUsageEvent.mockResolvedValue(undefined);
    // Same reasoning — billMachineUsage's node cost write is also .catch()-chained.
    mockDb.updateNode.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DynamoRepository, useValue: mockDb },
        { provide: ConfigService, useValue: mockCfg },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  describe('placeHold', () => {
    // Money-correctness fix I1/M1: the strict gate is now the atomic
    // deductCreditIfSufficient conditional op, not a separate getUserMeta
    // balance read — a false return (insufficient OR attribute-absent) must
    // 402 without ever writing a HoldItem or touching credit again.
    it('throws 402 when deductCreditIfSufficient returns false (insufficient credit)', async () => {
      mockDb.getUserMeta.mockResolvedValue({ creditUsd: 0.5 });
      mockDb.deductCreditIfSufficient.mockResolvedValue(false);
      const err: HttpException = await service.placeHold(SUB, SESSION_ID, NODE_ID, MODEL).catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(402);
      expect(mockDb.putHold).not.toHaveBeenCalled();
      expect(mockDb.addCredit).not.toHaveBeenCalled();
    });

    it('deducts the hold atomically, then writes a HoldItem, and returns a ceiling from the pre-hold balance', async () => {
      mockDb.getUserMeta.mockResolvedValue({ creditUsd: 3.0 });
      mockDb.deductCreditIfSufficient.mockResolvedValue(true);
      const result = await service.placeHold(SUB, SESSION_ID, NODE_ID, MODEL);

      expect(mockDb.deductCreditIfSufficient).toHaveBeenCalledWith(SUB, 1.0);
      expect(mockDb.putHold).toHaveBeenCalledWith(
        expect.objectContaining({
          PK: `USER#${SUB}`,
          SK: `HOLD#${NODE_ID}`,
          sub: SUB,
          nodeId: NODE_ID,
          sessionId: SESSION_ID,
          holdUsd: 1.0,
          status: 'held',
          model: MODEL,
        }),
      );
      // Deduct-FIRST ordering — putHold only ever runs once the atomic
      // deduct has already succeeded (see the orphan-hold bug this fixes).
      const deductOrder = mockDb.deductCreditIfSufficient.mock.invocationCallOrder[0];
      const putHoldOrder = mockDb.putHold.mock.invocationCallOrder[0];
      expect(deductOrder).toBeLessThan(putHoldOrder);
      // ceiling = min(maxRunCostUsd, PRE-hold balance) = min(1.0, 3.0) = 1.0
      expect(result).toEqual({ holdUsd: 1.0, ceilingUsd: 1.0 });
    });

    it('clamps the ceiling to a below-cap balance, not the cap itself', async () => {
      CFG['billing.maxRunCostUsd'] = 5.0;
      mockDb.getUserMeta.mockResolvedValue({ creditUsd: 2.0 });
      mockDb.deductCreditIfSufficient.mockResolvedValue(true);
      const result = await service.placeHold(SUB, SESSION_ID, NODE_ID, MODEL);
      expect(result.ceilingUsd).toBe(2.0);
      CFG['billing.maxRunCostUsd'] = 1.0; // restore
    });

    // Money-correctness fix M1: a putHold failure AFTER a successful atomic
    // deduct must not strand the reserve — compensate with addCredit before
    // rethrowing, so a crashed/failed write never leaves the user silently
    // short by holdUsd with nothing to show for it.
    it('compensates with addCredit and rethrows when putHold fails after a successful deduct', async () => {
      mockDb.getUserMeta.mockResolvedValue({ creditUsd: 3.0 });
      mockDb.deductCreditIfSufficient.mockResolvedValue(true);
      const putHoldErr = new Error('DynamoDB write failed');
      mockDb.putHold.mockRejectedValue(putHoldErr);

      await expect(service.placeHold(SUB, SESSION_ID, NODE_ID, MODEL)).rejects.toThrow(putHoldErr);
      expect(mockDb.addCredit).toHaveBeenCalledWith(SUB, 1.0);
    });
  });

  describe('reconcileHold', () => {
    // ADR-0004 redesign: the caller now supplies the already-computed
    // runCostUsd (claude's own total_cost_usd × creditMultiplier — see
    // nodes.service.ts) — this method no longer derives cost from tokens
    // internally, so these tests exercise settlement math with a plain
    // caller-supplied cost, not priceFor/token arithmetic.
    it('is an idempotent no-op when the flip loses (already settled by a concurrent caller)', async () => {
      mockDb.reconcileHoldStatus.mockResolvedValue(false);
      await service.reconcileHold(SUB, SESSION_ID, NODE_ID, 0.0495, 100, 200, MODEL);

      expect(mockDb.getHold).not.toHaveBeenCalled();
      expect(mockDb.addCredit).not.toHaveBeenCalled();
      expect(mockDb.deductCredit).not.toHaveBeenCalled();
      expect(mockDb.putUsageEvent).not.toHaveBeenCalled();
    });

    it('nets exactly holdUsd - runCostUsd via ONE atomic deductCredit call (not two independent addCredit/deductCredit ops)', async () => {
      mockDb.reconcileHoldStatus.mockResolvedValue(true);
      mockDb.getHold.mockResolvedValue({ holdUsd: 1.0 });

      // net = runCostUsd - holdUsd = 0.0495 - 1.0 = -0.9505 (a net credit-back,
      // since the flat hold over-reserved relative to the actual run cost)
      await service.reconcileHold(SUB, SESSION_ID, NODE_ID, 0.0495, 1000, 2000, MODEL);

      // Money-correctness fix I2: a single net $ADD can't partially apply —
      // no separate addCredit(hold)/deductCredit(cost) pair that could leave
      // a permanent mis-bill if only one of the two throws.
      expect(mockDb.addCredit).not.toHaveBeenCalled();
      expect(mockDb.deductCredit).toHaveBeenCalledTimes(1);
      expect(mockDb.deductCredit).toHaveBeenCalledWith(SUB, -0.9505);
      expect(mockDb.putUsageEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: SUB,
          sessionId: SESSION_ID,
          nodeId: NODE_ID,
          runId: NODE_ID,
          kind: 'CODE',
          model: MODEL,
          inputTokens: 1000,
          outputTokens: 2000,
          costUsd: 0.0495,
        }),
      );
    });

    it('a putUsageEvent failure after settlement is swallowed — the net charge already landed', async () => {
      mockDb.reconcileHoldStatus.mockResolvedValue(true);
      mockDb.getHold.mockResolvedValue({ holdUsd: 1.0 });
      mockDb.putUsageEvent.mockRejectedValue(new Error('audit write down'));

      await expect(service.reconcileHold(SUB, SESSION_ID, NODE_ID, 0.0495, 1000, 2000, MODEL)).resolves.toBeUndefined();
      expect(mockDb.deductCredit).toHaveBeenCalledTimes(1);
    });

    it('does not charge when the flip wins but no HoldItem is found (defensive)', async () => {
      mockDb.reconcileHoldStatus.mockResolvedValue(true);
      mockDb.getHold.mockResolvedValue(null);
      await service.reconcileHold(SUB, SESSION_ID, NODE_ID, 0.0495, 100, 200, MODEL);

      expect(mockDb.addCredit).not.toHaveBeenCalled();
      expect(mockDb.deductCredit).not.toHaveBeenCalled();
      expect(mockDb.putUsageEvent).not.toHaveBeenCalled();
    });

    it('releases the hold with a zero runCostUsd on the release-only path (e.g. a run error)', async () => {
      mockDb.reconcileHoldStatus.mockResolvedValue(true);
      mockDb.getHold.mockResolvedValue({ holdUsd: 1.0 });

      await service.reconcileHold(SUB, SESSION_ID, NODE_ID, 0, 0, 0, MODEL);

      expect(mockDb.deductCredit).toHaveBeenCalledWith(SUB, -1.0);
      expect(mockDb.putUsageEvent).toHaveBeenCalledWith(expect.objectContaining({ costUsd: 0, inputTokens: 0, outputTokens: 0 }));
    });
  });

  describe('billMachineUsage', () => {
    const createdAtIso = '2026-07-13T10:00:00.000Z';
    const destroyAtMs = Date.parse('2026-07-13T10:10:00.000Z'); // +600s

    it('is an idempotent no-op when the machine was already billed', async () => {
      mockDb.putMachineBill.mockResolvedValue(false);
      await service.billMachineUsage(SUB, 'sbx-1', SESSION_ID, NODE_ID, createdAtIso, destroyAtMs);

      expect(mockDb.deductCredit).not.toHaveBeenCalled();
      expect(mockDb.putUsageEvent).not.toHaveBeenCalled();
      expect(mockDb.updateNode).not.toHaveBeenCalled();
    });

    it('bills the full machine lifetime once, guard before charge, and persists machineCostUsd on the node', async () => {
      mockDb.putMachineBill.mockResolvedValue(true);
      await service.billMachineUsage(SUB, 'sbx-1', SESSION_ID, NODE_ID, createdAtIso, destroyAtMs);

      // 600s → 10min * $0.0009/min * 1.5 = $0.0135
      expect(mockDb.putMachineBill).toHaveBeenCalledWith(
        expect.objectContaining({
          PK: `USER#${SUB}`,
          SK: 'MACHINEBILL#sbx-1',
          sandboxId: 'sbx-1',
          sessionId: SESSION_ID,
          nodeId: NODE_ID,
          machineSeconds: 600,
          costUsd: 0.0135,
        }),
      );
      expect(mockDb.deductCredit).toHaveBeenCalledWith(SUB, 0.0135);
      expect(mockDb.putUsageEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'MACHINE',
          model: 'fly:machine',
          runId: NODE_ID,
          machineSeconds: 600,
          costUsd: 0.0135,
          inputTokens: 0,
          outputTokens: 0,
        }),
      );
      // Same billed figure (raw cost × creditMultiplier) as the usage event above.
      expect(mockDb.updateNode).toHaveBeenCalledWith(SESSION_ID, NODE_ID, { machineCostUsd: 0.0135 });

      // putMachineBill (the guard) must be called before deductCredit — the
      // ordering that makes it money-correct against a racing sweep/finally.
      const putOrder = mockDb.putMachineBill.mock.invocationCallOrder[0];
      const deductOrder = mockDb.deductCredit.mock.invocationCallOrder[0];
      expect(putOrder).toBeLessThan(deductOrder);
    });

    it('a failed updateNode after settlement is swallowed — the charge already landed', async () => {
      mockDb.putMachineBill.mockResolvedValue(true);
      mockDb.updateNode.mockRejectedValue(new Error('ddb blip'));

      await expect(service.billMachineUsage(SUB, 'sbx-1', SESSION_ID, NODE_ID, createdAtIso, destroyAtMs)).resolves.toBeUndefined();
      expect(mockDb.deductCredit).toHaveBeenCalledTimes(1);
    });

    it('clamps a negative duration (destroy before create, clock skew) to zero cost', async () => {
      mockDb.putMachineBill.mockResolvedValue(true);
      await service.billMachineUsage(SUB, 'sbx-2', SESSION_ID, NODE_ID, createdAtIso, Date.parse(createdAtIso) - 5000);
      expect(mockDb.deductCredit).toHaveBeenCalledWith(SUB, 0);
    });
  });

  describe('billBlaxelMachineUsage (split active/idle)', () => {
    const createdAtIso = '2026-07-13T10:00:00.000Z';
    const activeUntilMs = Date.parse('2026-07-13T10:01:30.000Z'); // +90s active
    const destroyAtMs = Date.parse('2026-07-13T10:11:30.000Z'); // +600s idle after that

    it('bills active minutes and idle GB-seconds separately, guard before charge', async () => {
      mockDb.putMachineBill.mockResolvedValue(true);
      await service.billBlaxelMachineUsage(SUB, 'blx-1', SESSION_ID, NODE_ID, createdAtIso, destroyAtMs, activeUntilMs);

      // active 90s = 0.0042 ; idle 600s * 7.72e-8 * 4GB = 0.00018528 ; ×1.5 = 0.006578
      expect(mockDb.deductCredit).toHaveBeenCalledWith(SUB, 0.006578);
      expect(mockDb.putUsageEvent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'MACHINE', model: 'blaxel:machine', costUsd: 0.006578 }),
      );
      const putOrder = mockDb.putMachineBill.mock.invocationCallOrder[0];
      const deductOrder = mockDb.deductCredit.mock.invocationCallOrder[0];
      expect(putOrder).toBeLessThan(deductOrder);
    });

    it('with no activeUntil (error path) bills the whole lifetime as active, no idle', async () => {
      mockDb.putMachineBill.mockResolvedValue(true);
      // 690s total, all active → (690/60)*0.0028*1.5 = 0.04830
      await service.billBlaxelMachineUsage(SUB, 'blx-2', SESSION_ID, NODE_ID, createdAtIso, destroyAtMs);
      expect(mockDb.deductCredit).toHaveBeenCalledWith(SUB, 0.0483);
    });

    it('is an idempotent no-op when already billed (shared MACHINEBILL# key)', async () => {
      mockDb.putMachineBill.mockResolvedValue(false);
      await service.billBlaxelMachineUsage(SUB, 'blx-3', SESSION_ID, NODE_ID, createdAtIso, destroyAtMs, activeUntilMs);
      expect(mockDb.deductCredit).not.toHaveBeenCalled();
    });
  });

  describe('reconcileStaleHolds', () => {
    it('releases credit only for holds whose flip wins, skipping ones already settled', async () => {
      mockDb.scanHeldHolds.mockResolvedValue([
        { sub: SUB, nodeId: 'n1', holdUsd: 1.0 },
        { sub: SUB, nodeId: 'n2', holdUsd: 2.0 },
      ]);
      mockDb.reconcileHoldStatus.mockImplementation((_sub: string, nodeId: string) => Promise.resolve(nodeId === 'n1'));

      await service.reconcileStaleHolds(30);

      expect(mockDb.addCredit).toHaveBeenCalledTimes(1);
      expect(mockDb.addCredit).toHaveBeenCalledWith(SUB, 1.0);
    });

    it('scans with a cutoff roughly cutoffMinutes in the past', async () => {
      mockDb.scanHeldHolds.mockResolvedValue([]);
      const before = Date.now();
      await service.reconcileStaleHolds(30);
      const cutoffIso = mockDb.scanHeldHolds.mock.calls[0][0] as string;
      const deltaMs = before - Date.parse(cutoffIso);
      expect(deltaMs).toBeGreaterThanOrEqual(30 * 60_000 - 1000);
      expect(deltaMs).toBeLessThanOrEqual(30 * 60_000 + 5000);
    });
  });
});
