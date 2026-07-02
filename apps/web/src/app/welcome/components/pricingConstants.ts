// Snapshot of backend pricing for the /welcome marketing calculator ONLY.
// This is a hand-copied illustrative snapshot, not read from the API — if
// backend pricing changes this file will silently drift. Same pattern as
// apps/web/src/components/TweaksPanel.tsx's MODEL_OPTIONS.cost field.
// Source of truth: apps/api/src/llm/models.ts (MODEL_PRICING) and
// apps/api/src/config/configuration.ts (SIGNUP_CREDIT_USD, CREDIT_MULTIPLIER).

export const CREDIT_MULTIPLIER = 1.5;
export const SIGNUP_CREDIT_USD = 5.0;

// USD per 1,000,000 tokens, mirrors apps/api/src/llm/models.ts MODEL_PRICING.
export const MODEL_PRICE_PER_MTOK = {
  haiku: { input: 1, output: 5 },
  sonnet: { input: 3, output: 15 },
  opus: { input: 15, output: 75 },
} as const;

export type PricingTier = keyof typeof MODEL_PRICE_PER_MTOK;

export const TIER_LABELS: Record<PricingTier, { label: string; sub: string }> = {
  haiku: { label: 'Fast', sub: 'Claude Haiku tier' },
  sonnet: { label: 'Balanced', sub: 'Claude Sonnet tier' },
  opus: { label: 'Deep', sub: 'Claude Opus tier' },
};

// Assumed token profile for one typical branch answer (a 4-section default
// answer). This is a UI approximation, not measured telemetry — always shown
// next to the disclaimer in PricingCalculator.tsx.
export const ASSUMED_INPUT_TOKENS_PER_QUERY = 1500;
export const ASSUMED_OUTPUT_TOKENS_PER_QUERY = 2800;

export function estimateQueryCostUsd(tier: PricingTier): number {
  const { input, output } = MODEL_PRICE_PER_MTOK[tier];
  const raw =
    (ASSUMED_INPUT_TOKENS_PER_QUERY / 1_000_000) * input +
    (ASSUMED_OUTPUT_TOKENS_PER_QUERY / 1_000_000) * output;
  return raw * CREDIT_MULTIPLIER;
}
