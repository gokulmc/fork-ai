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

// Exported so call sites that need a specific tier outright (e.g. nodes.service.ts's
// generateCodeMeta, always haiku regardless of dto.model) can reference it directly
// instead of going through resolveBranchModel's alias-or-default logic.
export const ALIAS_TO_ID: Record<ModelAlias, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5',
  'gemini-pro': 'gemini-3.1-pro-preview',
  'gemini-flash': 'gemini-2.5-flash',
  'gemini-flash-lite': 'gemini-2.5-flash-lite',
  'deepseek-pro': 'deepseek-v4-pro',
  'deepseek-flash': 'deepseek-v4-flash',
  glm: 'glm-5.2',
  'glm-air': 'glm-4.5-air',
};

// The model for root queries (kind QUERY) — not user-selectable. Everything
// root-related keys off this single constant (the streaming path dispatches on
// providerNameFor(ROOT_MODEL)), so swapping it to another alias's id is enough to
// move the whole root flow — including streaming — to that provider (#213: root
// queries moved to Claude Sonnet for answer-quality parity with the rest of the app).
export const ROOT_MODEL = ALIAS_TO_ID.sonnet;

// Default branch model when the client sends nothing / something invalid (cheapest Claude tier).
export const BRANCH_DEFAULT_MODEL = ALIAS_TO_ID.haiku;

// The Claude 5 family runs adaptive thinking by default when the `thinking`
// param is omitted — thinking tokens count against max_tokens, which would eat
// this app's tight JSON output budgets. Callers use this to send an explicit
// `thinking: { type: 'disabled' }` (pre-5 Claude models keep omitting the param).
export function isClaude5(modelId: string): boolean {
  return modelId === 'claude-sonnet-5' || modelId === 'claude-opus-5';
}

// Cloud CODE runs always use Sonnet (product decision: opus plans, sonnet
// implements) — resolved once here so the sandbox's `claude --model` flag
// and the hold/usage-event bookkeeping always agree. Previously the API
// billed against dto.model while the sandbox ran whatever claude defaulted
// to, so the two silently disagreed (see nodes.service.ts). Passed to the
// CLI both as ctx.model and verified directly against `claude --model
// claude-sonnet-5` — the full id resolves the same as the 'sonnet' alias.
export const CLOUD_CODE_MODEL_ID = ALIAS_TO_ID.sonnet;

// PLAN nodes always synthesize with Opus — the reasoning-heavy half of the
// same "opus plans, sonnet implements" product decision. Not user-overridable
// (a plan is where model quality matters most); the cheaper resolveBranchModel
// default still governs plain MIX and learn nodes.
export const PLAN_MODEL_ID = ALIAS_TO_ID.opus;

// Cheap, fast model for the share OG hook generation (not user-selectable).
export const SHARE_HOOK_MODEL = ALIAS_TO_ID['gemini-flash-lite'];

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
// prompts are <5k tokens so always the low tier. (Gemini 3.1 Pro has a >200k tier
// of 4/18 that is intentionally omitted because it is unreachable here.)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-opus-5': { input: 15, output: 75 },
  'gemini-3.1-pro-preview': { input: 2, output: 12 },
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

// DeepSeek peak-valley pricing, effective mid-July 2026: peak-hour rates are 2x
// list price, applied to all billing items (input + output). Peak windows are
// 1:00-4:00 and 6:00-10:00 UTC; everything else is off-peak at list price.
function isDeepseekPeakHour(now: Date): boolean {
  const h = now.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

// Per-MTok rates for a concrete model id; falls back to Sonnet if unknown so a
// stale model id can never bill at zero. `now` defaults to the real clock —
// tests pass an explicit Date to hit/avoid DeepSeek's peak window deterministically.
export function priceFor(modelId: string, now: Date = new Date()): { input: number; output: number } {
  const rate = MODEL_PRICING[modelId] ?? MODEL_PRICING[ROOT_MODEL];
  if (providerNameFor(modelId) === 'deepseek' && isDeepseekPeakHour(now)) {
    return { input: rate.input * 2, output: rate.output * 2 };
  }
  return rate;
}

// Machine wall-clock cost, mirrors billUsage's 6-dp rounding.
export function machineSecondsCostUsd(seconds: number, ratePerMinuteUsd: number, multiplier: number): number {
  const raw = (Math.max(0, seconds) / 60) * ratePerMinuteUsd;
  return Math.round(raw * multiplier * 1_000_000) / 1_000_000;
}

// Split active/idle machine cost for standby-billed providers (Blaxel): active
// compute per minute, idle standby per GB-second. Same 6-dp rounding as above.
// A run that never reached its active boundary passes activeSeconds === total
// (all active, no idle) — see billBlaxelMachineUsage's error path.
export function machineSplitCostUsd(
  activeSeconds: number,
  idleSeconds: number,
  activeRatePerMinuteUsd: number,
  idleRatePerGbSecondUsd: number,
  memoryGb: number,
  multiplier: number,
): number {
  const active = (Math.max(0, activeSeconds) / 60) * activeRatePerMinuteUsd;
  const idle = Math.max(0, idleSeconds) * idleRatePerGbSecondUsd * memoryGb;
  return Math.round((active + idle) * multiplier * 1_000_000) / 1_000_000;
}
