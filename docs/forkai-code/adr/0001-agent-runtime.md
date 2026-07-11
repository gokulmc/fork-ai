# ADR-0001: Agent runtime — server-side sandbox, mock-first

**Status:** Proposed (deferred until post-MVP)
**Date:** 2026-07-11

## Context

A `code` node is one agent run: it must read a real repo, edit files, run the toolchain (installs, tests, linters), and produce a real git commit. This is categorically different from fork.ai's LLM-only branches — it needs actual code execution, not just a structured JSON answer.

The MVP ships `AgentRunner.run(context) → AsyncIterable<AgentEvent>` with a **mocked** implementation: one LLM call generates a fake transcript (tool calls, file diffs, a closing commit message), replayed to the client with pacing to simulate a live run. Each `AgentEvent` is streamed over SSE the same way fork.ai streams a root-query answer, and the full event sequence is persisted per-node as an `AgentRun` item so a page refresh mid-run can restore progress instead of losing it. No real runtime exists yet. This ADR records the target runtime now, before more product surface (map lanes, commit pills, run persistence) gets built on assumptions the real runtime can't satisfy.

## Decision

Four runtimes were compared:

| Criterion | (a) Server sandbox + Claude Agent SDK headless | (b) Local companion CLI/daemon | (c) In-browser WebContainers | (d) LLM-only GitHub-API diffs |
|---|---|---|---|---|
| Capability | Full — tests, toolchains, real git | Full | Node-only | No execution, can't run anything |
| Infra cost | High — per-run container (E2B/Fly Machines class) | ~Zero | Low | ~Zero |
| Security | Isolated per-run; server holds tokens | User's machine, user's risk; local token custody | Weakest for secrets | Minimal surface |
| Mobile/browser reach | Full via SSE relay (matches existing architecture) | Requires daemon install; no mobile | Desktop browser only | Full |
| Time-to-build | Weeks (orchestration, image, relay) | Medium (CLI + pairing) | Medium, dead-ends on non-Node repos | Days |
| Billing fit | Needs mid-run budget enforcement (see ADR-0004 in this doc set) | Same | Same | Fits today's single-shot billing model |

**(a) is the target.** A per-run isolated container running the Claude Agent SDK headless is the only option with full toolchain capability, server-held token custody, and reach to mobile/browser clients over the SSE relay this product already needs. (b) is rejected — no mobile story, and it moves token custody onto the user's machine, which fork.ai's server-side architecture has never done. (c) is rejected — WebContainers only run Node.js, and forkai-code cannot promise every imported repo is a Node project. (d) is the **acceptable stopgap**: if runway forces something billable before the sandbox is built, an LLM that reads repo state via the GitHub API and proposes diffs (no execution, no tests) ships a weaker but real product, and it is the only option that fits the current single-shot billing model without changes.

Concrete sandbox vendor (E2B, Fly Machines, or a hand-rolled Firecracker/gVisor pool) is explicitly **not** decided here — that's an implementation detail of (a), not an architecture decision, and should be picked against real cost/latency numbers once (a) is greenlit rather than speculated now.

## Consequences

- The MVP's `AgentRunner` interface, its `AgentEvent` vocabulary, and the per-node `AgentRun` persistence shape **are the relay contract**. Building the mock to this contract means swapping in the sandbox implementation later requires no UI change — only a new `AgentRunner` implementation behind the same interface.
- Any `AgentEvent` type added to satisfy the mock (e.g. a fake "tool call" event) must be one a real sandboxed run can actually emit — tool-call start/end, file diff, stdout/stderr chunk, exit code, final commit SHA. Do not add mock-only event shapes that have no real-runtime equivalent.
- Choosing (d) as a stopgap, if it happens, still runs through the same `AgentRunner` interface with a degraded event set (no tool-call/stdout events) — it is a different implementation, not a different product surface.
- (a) reopens the billing question fork.ai never had to answer: a run inside a sandbox has real per-second infra cost on top of LLM token cost, and can run far longer than any fork.ai branch call. This is deliberately factored out into its own record — see the multi-turn billing ADR in this doc set.
