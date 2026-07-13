# ADR-0001: Agent runtime — server-side sandbox, mock-first

**Status:** Accepted — option (a) implemented; vendor: Fly Machines (see Amendment 2026-07-13)
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

## Amendment (2026-07-13)

**The concrete sandbox vendor for (a) is decided: Fly Machines** (user decision, made against real numbers from a live spike rather than speculation, as the original Decision section required). The `AgentRunner` seam now has all three implementations behind the one `agent.module.ts` factory (`AGENT_RUNNER=mock|local|cloud`), confirming the Consequences section's claim: swapping runtimes required no UI change.

**Spike outcome — PASSED live** (`tools/spikes/cloud-sandbox/README.md` has the full findings table): app-per-sandbox on Fly Machines, dedicated IPv4 (GraphQL `allocateIpAddress` works), two public services (runner SSE relay :8080, openvscode-server :10300), real commit landed and streamed back. Headline numbers: 30.3s create→healthz, ~68s to first agent event, ~80s total for a trivial instruction, ~$0.0007/run machine cost. Region note: `bom` had no `shared-cpu-2x` capacity that day (422 `insufficient_capacity`) — `sin` is the working default.

**Local runner** (`apps/code-api/src/agent/local/`, dev-only): verified earlier against real repos — TTFE 3.1–10.5s, ~29–33s total, exact diffs. It is the latency benchmark the cloud runner is measured against, and the planned engine for the desktop (BYO) tier.

**Cloud runner** (`apps/code-api/src/agent/cloud/`, allowed in production): `CloudAgentRunner` provisions a single-use Fly Machine per run, relays the in-machine runner's SSE stream through the existing `translateAgentMessage` vocabulary, returns the real commit SHA + diff + `workspace: { kind: 'cloud', sandboxId, vscodeUrl }`, and destroys the sandbox in `finally` on success and error alike. Verified e2e through the real service path (91.7s / 94.5s total, clean `fly apps list` after). The platform Anthropic key travels in the bearer-authed `POST /run` body, never the machine env — the sandbox's own terminal must not be able to read the shared key (see the spike README's security notes).

**Known gaps → follow-ups** (recorded, deliberately not resolved here):
- **GitHub App for private repos + push-back** — the installation-token clone half shipped (ADR-0002's amendment: App JWT → per-repo installation token → `x-access-token@` clone URL); commits still die with the machine either way until push-back (`Contents:Write`, `git push` in `runner.mjs`) lands — that remains the priority follow-up.
- **Same-site domain for iframe embedding** — openvscode works in a new tab but its `SameSite=Lax` cookie blocks cross-site iframes; needs `*.forkai.in` sandbox domains or an auth rewrite in the runner proxy.
- **Per-project persistent workspaces** — every run pays the full ~80s provision cost; stop/start economics of a longer-lived per-project sandbox are unexplored.
- **Orphan sweep** — destroy-in-`finally` is the only reaper today; `sweepOrphanSandboxes` exists but is unscheduled (a client-crash orphan once billed ~22h). Must reconcile against a TTL marker, not name-prefix alone, before it's automated.
- **Region capacity** — `bom` (the latency-natural region for Indian users) can lack capacity; a region-fallback list rather than a single `FLY_REGION` is the fix.

## Amendment (2026-07-13, second)

**The two-public-service, dedicated-IPv4 scheme the spike proved out is superseded** (commit `6b8a8ea`) by a single-service reverse proxy: `runner.mjs` namespaces its own control-plane under `/__forkai/*` and proxies everything else — including WebSocket upgrades — to `openvscode-server` on `127.0.0.1:3000`, so the sandbox needs only one public Fly service instead of two. `fly-provider.ts` allocates a shared IPv4 + IPv6 instead of a dedicated one, which both removes the per-machine IP-allocation call the spike relied on and kills its unbudgeted cost (~71 IP-hours/day projected at 200 runs/day with a 20-minute TTL — see Adversarial-review amendment 5 in the execution plan). Live-verified end to end: real commit through the proxied path, portless `vscodeUrl`, `/__forkai/healthz` + bearer auth, vscode's redirect/cookie chain, a full WS 101 upgrade, `fly ips list` confirming shared (not dedicated) v4, and `sweepSandboxes` destroying the sandbox after TTL with only `forkai-sbx-base` left in `fly apps list` afterward. The image also moved out of `tools/spikes/cloud-sandbox/image/` into `infra/sandbox-image/` as the canonical build source at the same time — this is what the cloud runner boots in production now, not a spike artifact.
