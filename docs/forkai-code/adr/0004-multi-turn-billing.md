# ADR-0004: Billing for agentic runs

**Status:** Proposed (deferred until ADR-0001's real runtime lands — the MVP's mocked run is a single LLM call and bills like any other node)
**Date:** 2026-07-11

## Context

fork.ai's billing model — fork.ai ADR-0004 (`docs/adr/0004-credit-billing-model.md`) and fork.ai ADR-0009 (`docs/adr/0009-branch-output-budget-non-streaming-ceiling.md`) — was built for one short, single-shot LLM call per node: check credit `> 0` before the call (no pre-auth), deduct post-hoc from the returned token usage, and cap output at a fixed non-streaming ceiling (16K tokens). None of this holds for a `code` node once it's a real multi-turn agent run: a run can span dozens of turns, each with its own tool calls, over minutes, and a single pre-run credit check gives no protection against a run that burns through the user's entire balance mid-flight.

## Decision

For when a real runtime (ADR-0001) lands:

1. **Per-turn billing, not per-run.** Each agent turn writes its own `billUsage` row (same shape as today's Usage Event), all sharing a new `runId` field that ties every turn back to the same `AgentRun`. This replaces "bill once at the end" with "bill continuously as the run progresses."
2. **A per-run budget ceiling, checked between turns.** Before starting the next turn, the runner checks accumulated spend on `runId` against a configured ceiling. Exceeding it aborts the run (no further turns started) rather than blocking retroactively — a run cannot be billed past its ceiling by more than one turn's worth of overshoot.
3. **A pre-auth credit hold at run start.** Unlike fork.ai ADR-0004's "check `> 0`, deduct after," a multi-turn run reserves an estimated amount off the user's credit balance before the first turn, released/reconciled against actual per-turn spend as the run completes or aborts. This bounds worst-case exposure from a single run in a way a post-hoc-only model cannot.
4. **Running cost surfaced live.** The agent-log header (the streaming SSE view of a run) shows accumulated spend so far, updated per turn — the multi-turn equivalent of fork.ai's post-call cost display, but visible *during* the run instead of only after.
5. **Hold reconciliation on run end.** Whether a run completes, is aborted by the ceiling, or errors out, the pre-auth hold is reconciled against the sum of its per-turn `billUsage` rows: unused hold is released back to the balance, and any turn-level shortfall (a turn costing more than the remaining hold covered) is deducted directly, mirroring how fork.ai ADR-0004 already tolerates a small over-draft window rather than adding conditional-write locking.

This is deliberately scoped to `kind: CODE` only — `learn`, `plan`, and `branch` nodes remain single-shot LLM calls and keep billing exactly as fork.ai ADR-0004 describes today; nothing here changes their path.

## Alternatives considered

- **Keep post-hoc-only billing, just bill once at run end:** simplest, no new fields. Rejected — this is exactly the unbounded-overshoot problem in the Context; a long run could exhaust a user's balance many times over before the first (and only) bill lands.
- **Hard pre-auth for the full estimated run cost, no per-turn billing:** simpler settlement, but agent run length is inherently unpredictable (unlike a single structured-JSON call), so any fixed pre-auth estimate is either too conservative (blocks runs that would've finished cheaply) or too loose (defeats the point). Rejected in favor of the hold-plus-per-turn-reconciliation combination.
- **No budget ceiling, rely on pre-auth hold alone:** simpler, but a hold sized for "worst case" would need to be very large to avoid false-blocking; a between-turn ceiling check catches runaway runs without requiring an oversized hold.

## Consequences

- This **partially supersedes fork.ai ADR-0004** for `kind: CODE` runs only — the credit-balance-as-source-of-truth model, the Usage Event log shape, and the Credit Multiplier all carry over unchanged; only the "check once, bill once" cadence changes for agent runs.
- fork.ai ADR-0009's non-streaming 16K ceiling does not apply to agent turns the same way — each turn is itself a bounded call, but a run's *total* output is unbounded by turn count, which is exactly what the per-run budget ceiling in point 2 exists to bound instead.
- `UsageEvent` gains an optional `runId` field. Per the `saveUnknown: false` gotcha (see root CLAUDE.md), this field must be declared on the schema before any code sets it, or it silently drops on write.
- The budget ceiling (point 2) and the sandbox infra cost noted in the runtime ADR are two independent costs of the same run — a ceiling tuned only to LLM token spend would under-protect against a run that is cheap on tokens but expensive on wall-clock sandbox time. The ceiling check should account for both once real per-second infra pricing is known.
