// Single source of truth for which models fork.ai uses across providers, how the
// client-facing aliases map to concrete model ids, their per-MTok prices, and
// which provider serves each. The client only ever sends an alias — never a raw
// model id — and the server validates it here. See CONTEXT.md → "Model" and ADR-0004.

// Claude tiers keep their real names; Gemini/DeepSeek tiers use the provider's real names.
export type ModelAlias =
  | 'haiku' | 'sonnet' | 'opus'
  | 'gemini-pro' | 'gemini-flash' | 'gemini-flash-lite'
  | 'deepseek-pro' | 'deepseek-flash'
  | 'glm' | 'glm-air';

export type ProviderName = 'anthropic' | 'gemini' | 'deepseek' | 'glm';

// Root queries (kind QUERY) are always Claude Sonnet and not user-selectable.
export const ROOT_MODEL = 'claude-sonnet-4-6';

const ALIAS_TO_ID: Record<ModelAlias, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
  'gemini-pro': 'gemini-2.5-pro',
  'gemini-flash': 'gemini-2.5-flash',
  'gemini-flash-lite': 'gemini-2.5-flash-lite',
  'deepseek-pro': 'deepseek-v4-pro',
  'deepseek-flash': 'deepseek-v4-flash',
  glm: 'glm-5.2',
  'glm-air': 'glm-4.5-air',
};

// Default branch model when the client sends nothing / something invalid (cheapest Claude tier).
export const BRANCH_DEFAULT_MODEL = ALIAS_TO_ID.haiku;

// Hard output-token ceiling for branch calls. The branch path is non-streaming
// (provider.complete), and the Anthropic SDK risks HTTP timeouts above ~16K
// max_tokens non-streamed — so this is the most we can ever ask for here, and
// the clamp for a doubled retry. See ADR-0009.
export const NON_STREAMING_MAX_TOKENS = 16384;

// Output-token budget for a branch call (DEEPER/ASK), tiered by the caller's
// authentication and answer style. Guests/Trials stay small because their
// branches spend the session owner's Credit; an authenticated caller gets more
// room, most of it for Verbose. See ADR-0009.
export function outputBudget(authed: boolean, verbose: boolean): number {
  if (!authed) return 2048;
  return verbose ? 8192 : 4096;
}

// List prices, USD per 1M tokens. Gemini rates are the ≤200k-prompt tier; branch
// prompts are <5k tokens so always the low tier. (Gemini 2.5 Pro has a >200k tier
// of 2.50/15.00 that is intentionally omitted because it is unreachable here.)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-8': { input: 15, output: 75 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
  // DeepSeek V4, standard cache-miss rates (conservative; re-verify after the v4-pro promo window).
  'deepseek-v4-pro': { input: 1.74, output: 3.48 },
  'deepseek-v4-flash': { input: 0.14, output: 0.28 },
  // Z.ai GLM, list prices per docs.z.ai/guides/overview/pricing.
  'glm-5.2': { input: 1.4, output: 4.4 },
  'glm-4.5-air': { input: 0.2, output: 1.1 },
};

// Guest cost-ceiling clamp: top tier downgrades to mid tier, within the same
// provider, because guest branches spend the session owner's Credit (ADR-0004).
const GUEST_CLAMP: Partial<Record<ModelAlias, ModelAlias>> = {
  opus: 'sonnet',
  'gemini-pro': 'gemini-flash',
  'deepseek-pro': 'deepseek-flash',
  glm: 'glm-air',
};

const ALL_ALIASES: ModelAlias[] = [
  'haiku', 'sonnet', 'opus',
  'gemini-pro', 'gemini-flash', 'gemini-flash-lite',
  'deepseek-pro', 'deepseek-flash',
  'glm', 'glm-air',
];

function isAlias(v: string | undefined): v is ModelAlias {
  return !!v && (ALL_ALIASES as string[]).includes(v);
}

// Which provider serves a concrete model id (callJson dispatches on this).
export function providerNameFor(modelId: string): ProviderName {
  if (modelId.startsWith('gemini')) return 'gemini';
  if (modelId.startsWith('deepseek')) return 'deepseek';
  if (modelId.startsWith('glm')) return 'glm';
  return 'anthropic';
}

// Whether a model's provider supports the web-search tool/grounding. DeepSeek has
// no native web search, so its branch calls never get the web-search prompt/citations.
export function supportsWebSearch(modelId: string): boolean {
  return providerNameFor(modelId) !== 'deepseek';
}

// Resolve a client-supplied branch-model alias to a concrete model id, applying
// the guest clamp. Falls back to the default (Haiku) for missing/invalid input.
export function resolveBranchModel(alias: string | undefined, isGuest = false): string {
  let a: ModelAlias = isAlias(alias) ? alias : 'haiku';
  if (isGuest && GUEST_CLAMP[a]) a = GUEST_CLAMP[a]!;
  return ALIAS_TO_ID[a];
}

// Per-MTok rates for a concrete model id; falls back to Sonnet if unknown so a
// stale model id can never bill at zero.
export function priceFor(modelId: string): { input: number; output: number } {
  return MODEL_PRICING[modelId] ?? MODEL_PRICING[ROOT_MODEL];
}
