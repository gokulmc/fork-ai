# Branch answers use a tiered Output Budget, capped by the non-streaming ceiling

## Context

Branch calls (`DEEPER`/`ASK`) ran with a fixed `max_tokens: 2048`. Verbose answers overran it, the JSON was truncated mid-string, `parseJson` threw, and the user saw a misleading "unreadable answer" error — independent of model, because the 2048 cap is model-independent. We wanted authenticated users to get effectively-unlimited answers while keeping Guests/Trials bounded (their branches spend the owner's / House Account's Credit).

## Decision

Replace the flat cap with a server-side **Output Budget** tiered by authentication and answer style: authed Verbose 8192, authed Sectioned 4096, Guest/Trial 2048 (unchanged). Detect a length-limit stop (`stop_reason: "max_tokens"` / Gemini `MAX_TOKENS`) and report it as a distinct **Cut-Off** ("hit the length limit") rather than "unreadable". On a Cut-Off, an authed user may Retry at double the budget (clamped to 16384); a Guest cannot Retry a Cut-Off.

We deliberately **keep the branch path non-streaming**. `provider.complete()` exposes only a non-streaming call, and the Anthropic SDK risks HTTP timeouts above ~16K `max_tokens` non-streamed — so 16384 is the hard ceiling here. True per-model maximums (Opus 128K, Sonnet/Haiku 64K) are unreachable without adding a streaming path to all three providers, an architecture change we judged not worth it: a verbose deep-dive is a few thousand tokens, and 8K already gives 4× headroom over the symptom.

## Consequences

- Root queries (`QUERY`, always Sonnet, already streaming) are out of scope and unchanged.
- If verbose answers ever genuinely need >16K output, this must be revisited by streaming the branch path — the ceiling is a property of the non-streaming `complete()` abstraction, not the models.
