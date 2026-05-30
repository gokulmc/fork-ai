// Single source of truth for which Anthropic models fork.ai uses, how the
// client-facing aliases map to concrete model ids, and their per-MTok prices.
// The client only ever sends an alias — never a raw model id — and the server
// validates it here. See CONTEXT.md → "Model" and ADR-0004.

export type ModelAlias = 'haiku' | 'sonnet' | 'opus';

// Root queries (kind QUERY) are always Sonnet and not user-selectable.
export const ROOT_MODEL = 'claude-sonnet-4-6';

const ALIAS_TO_ID: Record<ModelAlias, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
};

// Default branch model when the client sends nothing / something invalid.
export const BRANCH_DEFAULT_MODEL = ALIAS_TO_ID.haiku;

// Anthropic list prices, USD per 1M tokens.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-8': { input: 15, output: 75 },
};

function isAlias(v: string | undefined): v is ModelAlias {
  return v === 'haiku' || v === 'sonnet' || v === 'opus';
}

// Resolve a client-supplied branch-model alias to a concrete model id.
// Guests are clamped to Sonnet — an Opus request downgrades — because guest
// branches spend the session owner's Credit (ADR-0004).
export function resolveBranchModel(alias: string | undefined, isGuest = false): string {
  let a: ModelAlias = isAlias(alias) ? alias : 'haiku';
  if (isGuest && a === 'opus') a = 'sonnet';
  return ALIAS_TO_ID[a];
}

// Per-MTok rates for a concrete model id; falls back to Sonnet if unknown so a
// stale model id can never bill at zero.
export function priceFor(modelId: string): { input: number; output: number } {
  return MODEL_PRICING[modelId] ?? MODEL_PRICING[ROOT_MODEL];
}
