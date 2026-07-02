import { resolveBranchModel, priceFor, providerNameFor, supportsWebSearch } from './models';

describe('models', () => {
  describe('resolveBranchModel', () => {
    it('maps Claude aliases to concrete ids', () => {
      expect(resolveBranchModel('haiku')).toBe('claude-haiku-4-5-20251001');
      expect(resolveBranchModel('sonnet')).toBe('claude-sonnet-4-6');
      expect(resolveBranchModel('opus')).toBe('claude-opus-4-8');
    });

    it('maps Gemini aliases to concrete ids', () => {
      expect(resolveBranchModel('gemini-pro')).toBe('gemini-2.5-pro');
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
      expect(resolveBranchModel('opus', true)).toBe('claude-sonnet-4-6');
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
      expect(providerNameFor('gemini-2.5-pro')).toBe('gemini');
      expect(providerNameFor('deepseek-v4-flash')).toBe('deepseek');
      expect(providerNameFor('glm-5.2')).toBe('glm');
      expect(providerNameFor('glm-4.5-air')).toBe('glm');
      expect(providerNameFor('claude-opus-4-8')).toBe('anthropic');
    });
  });

  describe('priceFor', () => {
    const offPeak = new Date('2026-07-15T12:00:00Z'); // noon UTC — outside both DeepSeek peak windows

    it('returns per-model rates across providers', () => {
      expect(priceFor('claude-opus-4-8', offPeak)).toEqual({ input: 15, output: 75 });
      expect(priceFor('gemini-2.5-flash-lite', offPeak)).toEqual({ input: 0.10, output: 0.40 });
      expect(priceFor('deepseek-v4-flash', offPeak)).toEqual({ input: 0.14, output: 0.28 });
      expect(priceFor('glm-5.2', offPeak)).toEqual({ input: 1.4, output: 4.4 });
    });

    it('falls back to Sonnet rates for an unknown id', () => {
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
      expect(priceFor('claude-opus-4-8', new Date('2026-07-15T02:00:00Z'))).toEqual({ input: 15, output: 75 });
    });
  });

  describe('supportsWebSearch', () => {
    it('is false for DeepSeek, true for Claude/Gemini/GLM', () => {
      expect(supportsWebSearch('deepseek-v4-pro')).toBe(false);
      expect(supportsWebSearch('claude-sonnet-4-6')).toBe(true);
      expect(supportsWebSearch('gemini-2.5-flash')).toBe(true);
      expect(supportsWebSearch('glm-5.2')).toBe(true);
    });
  });
});
