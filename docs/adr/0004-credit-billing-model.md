# ADR-0004: Credit-based billing model

**Status:** Accepted  
**Date:** 2026-05-25

## Context

fork.ai makes Anthropic API calls on behalf of users for every LLM operation (root query, Go Deeper, Ask AI). These calls have a real cost. The system needs a way to meter usage and prevent runaway spend without requiring a full payment gateway at launch.

## Decision

1. **Credit stored on UserMetaItem.** `creditUsd` (Number) is added to the existing `USER#{sub} / METADATA` DynamoDB item. No separate billing table. Credit balance is the authoritative source of truth.

2. **Configurable one-time signup credit.** Amount is set via `SIGNUP_CREDIT_USD` env var (default `5.00`). Awarded in `UsersService.upsert()` when the UserMetaItem row is first created. Not awarded on subsequent logins. Shown to the user during the email verification step in `LoginPage.tsx`.

3. **Hard block at zero.** `LlmService` reads the caller's `creditUsd` before every LLM call. If `creditUsd <= 0`, it throws a `PaymentRequiredException` (HTTP 402) before touching Anthropic. The frontend surfaces this as a distinct "out of credit" error state.

4. **Deduct after call, not before.** Cost is calculated from `usage.input_tokens` and `usage.output_tokens` returned by the Anthropic SDK after the call completes. For the streaming path, `stream.finalMessage()` is awaited after the stream ends. Deduction uses DynamoDB `ADD creditUsd -:deduction` — no conditional expression, so concurrent calls may briefly over-draft by one call's worth.

5. **Guest calls billed to session owner.** When a Guest creates a Node via `POST /share/:token/nodes`, the ShareToken record is used to resolve the session owner's `sub`. The owner's Credit is checked and deducted. If the owner has no Credit, the guest branch is blocked with 402.

6. **Usage Events as append-only log.** Every completed LLM call writes a `USAGE#{ulid}` item under `USER#{sub}` capturing tokens, cost, kind, sessionId, and nodeId. These are never modified. They power the usage history in the Billing overlay.

7. **Credit Multiplier configured via `CREDIT_MULTIPLIER` env var (default `1.5`).** Raw Anthropic cost (`inputTokens × $3/1M + outputTokens × $15/1M`) is multiplied by the configured value before deduction. Server-side only — not stored per-user or per-call. Can be adjusted at deploy time without a code change.

8. **Recharge is a stub (no payment gateway).** The "Recharge" button in the Billing overlay opens a mailto link to the support address. No Stripe, no webhook, no self-serve top-up. `creditUsd` can only be increased by an admin via the DynamoDB console. Self-serve payments are deferred to a later sprint.

## Alternatives considered

- **Stripe Checkout:** Accurate self-serve top-up but requires a payment gateway, webhook handling, and customer objects in Stripe. Deferred — the credit check/deduction logic is the v1 value.
- **Stripe metered billing:** Accurate but requires a payment gateway, webhook handling, and customer objects in Stripe. Too much for v1.
- **Flat per-call charge:** Simpler but disconnects the user-visible cost from actual Anthropic spend, making it harder to adjust pricing later.
- **Conditional DynamoDB write (optimistic lock):** Prevents all over-draft but adds complexity. Rejected because concurrent branch creation is rare and a cent of over-draft is acceptable.
- **Guest calls are free:** Simpler, but lets a viral share link drain the owner's credit invisibly. Rejected in favour of charging the owner with a clear 402 if they run out.

9. **`creditUsd` surfaced via `GET /users/me`.** The balance is added to the `UserMetaItem` response shape — no new endpoint. Usage history is fetched lazily via `GET /users/me/usage` (returns last 50 events, newest first) only when the Billing overlay is opened.

10. **Billing overlay follows the Change Password pattern.** A "Billing" row in the Account popover opens a full-screen overlay identical in structure to Change Password. The popover also shows the raw balance inline (e.g. `$4.12 remaining`). When balance is ≤ 0, the inline line reads "Out of credit".

11. **402 surfaces as an inline error at the query origin.** Root query (Landing input): error replaces the loading state with "Out of credit — open Billing to recharge" and a clickable "Billing" link. Branch nodes (DEEPER/ASK): the loading node on the map shows the error state with the same message.

## Addendum (2026-05-30): per-model pricing + user-selectable branch Model

Point 7 originally fixed the raw-cost formula to Sonnet rates (`$3/1M in, $15/1M out`). With the introduction of a user-selectable **Model** for branch calls (Haiku / Sonnet / Opus — see CONTEXT.md → "Model"), a single hardcoded rate is no longer correct: Opus output is ~5× Sonnet, Haiku ~⅓. The decision evolves:

- **Billing is now model-aware.** `billUsage` takes the concrete model id that served the call and looks up its input/output rates in a server-side `MODEL_PRICING` table (`apps/api/src/llm/models.ts`). The Credit Multiplier still applies on top. The serving model is recorded on each Usage Event (`model` field).
- **Root queries (`QUERY`) remain Sonnet** and are not user-selectable — first-impression quality. Only `DEEPER` and `ASK` honour the Model tweak; default **Haiku** (cost reduction was the motivating goal).
- **Clients never set the price.** The request carries a short alias (`haiku`/`sonnet`/`opus`); the server validates it against a fixed allowlist and maps to a model id, falling back to Haiku. An unknown/stale model id prices at Sonnet, never zero.
- **Guests are clamped to Sonnet.** Because guest branches spend the **owner's** Credit (point 5), the `/share/:token/*` surface downgrades any Opus request to Sonnet — a shared link cannot drain the owner's balance at Opus rates.

### Alternatives considered (addendum)
- **Keep flat Sonnet-rate billing:** simplest, but loses money on every Opus call (~3× under-charge) and over-charges Haiku. Rejected once the spread became real.
- **Flat per-model multiplier bump (e.g. Opus = ×5):** cheaper to implement than a rate table but disconnects deduction from actual token mix. Rejected — the rate table is ~15 lines and exact.
- **Let guests pick any model:** simpler, but exposes the owner to Opus-priced guest spend they never opted into. Rejected in favour of the Sonnet clamp.

## Consequences

- Adding payments later requires only a new endpoint to top up `creditUsd` — the rest of the billing logic is already in place.
- Usage history is queryable with a single `Query PK=USER#{sub}, SK begins_with USAGE#` — no GSI needed.
- The over-draft window is bounded to one concurrent call's cost (~$0.03 max at 1.5×). Acceptable for a free-credit launch.
