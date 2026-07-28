import { resolveBranchModel, priceFor, providerNameFor, supportsWebSearch, machineSecondsCostUsd, machineSplitCostUsd } from './models';

describe('models', () => {
  describe('resolveBranchModel', () => {
    it('maps Claude aliases to concrete ids', () => {
      expect(resolveBranchModel('haiku')).toBe('claude-haiku-4-5-20251001');
      expect(resolveBranchModel('sonnet')).toBe('claude-sonnet-5');
      expect(resolveBranchModel('opus')).toBe('claude-opus-5');
    });

    it('maps Gemini aliases to concrete ids', () => {
      expect(resolveBranchModel('gemini-pro')).toBe('gemini-3.1-pro-preview');
      expect(resolveBranchModel('gemini-flash')).toBe('gemini-2.5-flash');
      expect(resolveBranchModel('gemini-flash-lite')).toBe('gemini-2.5-flash-lite');
    });

    it('maps DeepSeek aliases to concrete ids', () => {
      expect(resolveBranchModel('deepseek-flash')).toBe('deepseek-v4-flash');
      expect(resolveBranchModel('deepseek-pro')).toBe('deepseek-v4-pro');
    });

    it('maps GLM aliases to concrete ids', () => {
      expect(resolveBranchModel('glm')).toBe('glm-5.2');
      expect(resolveBranchModel('glm-air')).toBe('glm-4.5-air');
    });

    it('falls back to Haiku on missing/invalid alias', () => {
      expect(resolveBranchModel(undefined)).toBe('claude-haiku-4-5-20251001');
      expect(resolveBranchModel('bogus')).toBe('claude-haiku-4-5-20251001');
    });

    it('clamps the top tier to mid tier per provider for guests', () => {
      expect(resolveBranchModel('opus', true)).toBe('claude-sonnet-5');
      expect(resolveBranchModel('gemini-pro', true)).toBe('gemini-2.5-flash');
      expect(resolveBranchModel('deepseek-pro', true)).toBe('deepseek-v4-flash');
      expect(resolveBranchModel('glm', true)).toBe('glm-4.5-air');
    });

    it('does not clamp non-top tiers for guests', () => {
      expect(resolveBranchModel('gemini-flash', true)).toBe('gemini-2.5-flash');
      expect(resolveBranchModel('haiku', true)).toBe('claude-haiku-4-5-20251001');
    });
  });

  describe('providerNameFor', () => {
    it('dispatches by model id prefix', () => {
      expect(providerNameFor('gemini-3.1-pro-preview')).toBe('gemini');
      expect(providerNameFor('deepseek-v4-flash')).toBe('deepseek');
      expect(providerNameFor('glm-5.2')).toBe('glm');
      expect(providerNameFor('glm-4.5-air')).toBe('glm');
      expect(providerNameFor('claude-opus-5')).toBe('anthropic');
    });
  });

  describe('priceFor', () => {
    const offPeak = new Date('2026-07-15T12:00:00Z'); // noon UTC — outside both DeepSeek peak windows

    it('returns per-model rates across providers', () => {
      expect(priceFor('claude-opus-5', offPeak)).toEqual({ input: 15, output: 75 });
      expect(priceFor('gemini-2.5-flash-lite', offPeak)).toEqual({ input: 0.10, output: 0.40 });
      expect(priceFor('deepseek-v4-flash', offPeak)).toEqual({ input: 0.14, output: 0.28 });
      expect(priceFor('glm-5.2', offPeak)).toEqual({ input: 1.4, output: 4.4 });
    });

    it('falls back to ROOT_MODEL rates for an unknown id', () => {
      // ROOT_MODEL is Claude Sonnet (see models.ts) — fallback tracks whatever it's set to.
      expect(priceFor('made-up-model', offPeak)).toEqual({ input: 3, output: 15 });
    });

    it('doubles DeepSeek rates during both peak windows (1-4am and 6-10am UTC)', () => {
      expect(priceFor('deepseek-v4-flash', new Date('2026-07-15T02:00:00Z')))
        .toEqual({ input: 0.28, output: 0.56 });
      expect(priceFor('deepseek-v4-pro', new Date('2026-07-15T08:00:00Z')))
        .toEqual({ input: 3.48, output: 6.96 });
    });

    it('treats peak windows as [start, end) — boundary hours are off-peak', () => {
      expect(priceFor('deepseek-v4-flash', new Date('2026-07-15T04:00:00Z')))
        .toEqual({ input: 0.14, output: 0.28 });
      expect(priceFor('deepseek-v4-flash', new Date('2026-07-15T10:00:00Z')))
        .toEqual({ input: 0.14, output: 0.28 });
    });

    it('does not apply the DeepSeek peak multiplier to other providers', () => {
      expect(priceFor('glm-5.2', new Date('2026-07-15T08:00:00Z'))).toEqual({ input: 1.4, output: 4.4 });
      expect(priceFor('claude-opus-5', new Date('2026-07-15T02:00:00Z'))).toEqual({ input: 15, output: 75 });
    });
  });

  describe('supportsWebSearch', () => {
    it('is false for DeepSeek, true for Claude/Gemini/GLM', () => {
      expect(supportsWebSearch('deepseek-v4-pro')).toBe(false);
      expect(supportsWebSearch('claude-sonnet-5')).toBe(true);
      expect(supportsWebSearch('gemini-2.5-flash')).toBe(true);
      expect(supportsWebSearch('glm-5.2')).toBe(true);
    });
  });

  describe('machineSecondsCostUsd', () => {
    it('converts seconds to minutes, applies rate and multiplier, rounds to 6dp', () => {
      // 600s = 10min * $0.0009/min * 1.5 = $0.0135
      expect(machineSecondsCostUsd(600, 0.0009, 1.5)).toBe(0.0135);
    });

    it('clamps negative seconds to zero', () => {
      expect(machineSecondsCostUsd(-100, 0.0009, 1.5)).toBe(0);
    });

    it('returns zero for zero seconds', () => {
      expect(machineSecondsCostUsd(0, 0.0009, 1.5)).toBe(0);
    });

    it('rounds to 6 decimal places', () => {
      // 1s → (1/60)*0.0009*1.5 ≈ 0.0000225 → rounds to 6dp (float noise lands
      // this a hair under the .5 boundary, rounding down to 0.000022).
      expect(machineSecondsCostUsd(1, 0.0009, 1.5)).toBe(0.000022);
      // 90s = 1.5min * $0.001/min * 1 = 0.0015
      expect(machineSecondsCostUsd(90, 0.001, 1)).toBe(0.0015);
    });
  });

  describe('machineSplitCostUsd', () => {
    // active per-minute rate, idle per-GB-second rate.
    const ACTIVE = 0.0028;
    const IDLE = 0.0000000772;
    const MEM = 4; // GB
    const MULT = 1.5;

    it('bills active minutes and idle GB-seconds separately', () => {
      // active = (90/60)*0.0028 = 0.0042 ; idle = 600 * 7.72e-8 * 4 = 0.00018528
      // total = (0.0042 + 0.00018528) * 1.5 = 0.00657792 → 0.006578 at 6dp
      expect(machineSplitCostUsd(90, 600, ACTIVE, IDLE, MEM, MULT)).toBeCloseTo(0.006578, 6);
    });

    it('idle standby is near-zero — a long idle window barely moves the bill', () => {
      const activeOnly = machineSplitCostUsd(90, 0, ACTIVE, IDLE, MEM, MULT);
      const withHourIdle = machineSplitCostUsd(90, 3600, ACTIVE, IDLE, MEM, MULT);
      expect(withHourIdle - activeOnly).toBeLessThan(0.002); // an hour of standby < $0.002
    });

    it('all-active (no idle) matches active-only cost — the error/no-result path', () => {
      expect(machineSplitCostUsd(120, 0, ACTIVE, IDLE, MEM, MULT)).toBe(
        Math.round((2 * ACTIVE) * MULT * 1_000_000) / 1_000_000,
      );
    });

    it('clamps negative windows to zero', () => {
      expect(machineSplitCostUsd(-10, -10, ACTIVE, IDLE, MEM, MULT)).toBe(0);
    });
  });
});
