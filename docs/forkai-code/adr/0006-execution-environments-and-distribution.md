# ADR-0006: Execution environments & distribution strategy

**Status:** Accepted — web+Fly implemented (Phase A); Electron desktop planned (Phase B)
**Date:** 2026-07-13

## Context

ADR-0001 decided the runtime shape (`AgentRunner`, sandboxed execution, Fly Machines as the vendor) and ADR-0002 decided the GitHub credential model. Neither answers two product-level questions this ADR closes: **who picks the execution environment for a given run**, and **how does forkai-code reach a user's machine at all** — as a pure web product, or also as an installable app with real local execution. Both were decided together because the answer to the second question (Electron, BYO Claude login, ingestion API) reuses the exact runner seam the first question's registry exposes.

## Decision 1 — per-request execution environment, server-arbitrated

Execution environment is a per-request choice, not a server-wide setting. `RunnerRegistry` (`apps/code-api/src/agent/runner-registry.ts`) builds every runner this server has configured once at boot (mock always; cloud iff `FLY_API_TOKEN`+`FLY_SANDBOX_IMAGE`; local iff `AGENT_RUNNER=local` and non-production) and resolves a request's `environment` field against it:

```ts
resolve(environment?: string): AgentRunner
```

No `environment` given ⇒ the server's own default (`AGENT_RUNNER` env, unchanged from ADR-0001). An explicit environment that isn't configured **400s — it never silently falls back to another runner**. A user who asked for `cloud` must not get a `mock` commit; a demo/free-tier server that hasn't enabled cloud must say so, not quietly downgrade.

`CreateCodeNodeDto.environment?: 'cloud' | 'mock'` — **`'local'` is deliberately excluded from the dto.** It is reachable only as the server's own env-flag default (dev machines), never as a value a client can request over this route. Local execution as a *product* feature is Decision 2's ingestion API, a different route entirely — conflating the two would let any web client ask the API server to run an agent "locally" on infrastructure it doesn't own.

Resolution happens **before any node is persisted** (`nodes.service.ts`, `createCodeNodeStreaming`) — an invalid/unconfigured environment fails clean, no orphaned `agentStatus: 'running'` node left behind.

Frontend: `Tweaks.environment: 'cloud' | 'demo'` (`'demo'` maps to `'mock'` on the wire — clearer product language than exposing the internal runner name), a "Coding agent" section in `TweaksPanel.tsx`. `TWEAK_DEFAULTS.environment` stays `'demo'` until cloud is enabled in production (flip is part of the deploy checklist, `docs/forkai-code/deploy-cloud-runner.md`).

## Decision 2 — distribution: web+Fly ships first, Electron BYO-local second

Two ways to put a real execution environment in front of a user were evaluated:

| Dimension | Web + Fly (cloud sandbox) | Electron desktop (BYO local) |
|---|---|---|
| Install friction | Zero — any browser, incl. mobile | Download + the user must already have `claude` installed and logged in |
| LLM cost bearer | forkai (billed via existing token credits) | The user's own Claude subscription — **$0 to forkai** |
| Revenue per run | Token billing (the only path that monetizes) | None, structurally |
| Repo access | Public today; private via ADR-0002's App slice | Anything the user's machine can reach, including local-only repos |
| Where the commit lands | Sandbox (v1) → GitHub branch once push-back ships | The user's own repo, immediately, no push needed |
| Isolation / blast radius | Disposable single-use VM | The user's own machine |
| Time to ship | Implemented this iteration | Requires an ingestion API that doesn't exist yet + code signing/notarization lead time |

**Web+Fly is the product; Electron is the retention/power tier, and web ships first.** Reasoning: only cloud runs generate revenue through the existing credit system — BYO is structurally free to run and therefore can't be the primary funnel. The acquisition moment (type an instruction, watch a real sandbox VS Code inside 80 seconds, in-browser, no install) is the wow moment worth optimizing time-to-ship for. Building web-first loses no Electron time either: the Electron shell is a **remote-shell** (an `Electron BrowserWindow` loading the live `code.forkai.in`, the same pattern the Capacitor mobile shell already proves — ADR-0008 in the fork.ai side of this repo), and its local execution engine is the already-verified `LocalAgentRunner` (`apps/code-api/src/agent/local/`), not new code. Only two things are genuinely Electron-specific and not yet built: the ingestion API (below) and the shell/signing/distribution work.

**Not building, and why:** a VS Code fork (Cursor's approach — months of ongoing editor-treadmill maintenance neither product needs); a bundled-UI Electron app (`code-web` is SSR/next-auth with build-time-baked secrets; a static-export rework buys nothing over the remote-shell); an embedded editor pane in the web app v1 (the sandbox's own `openvscode-server`, opened in a new tab, already gives this — see ADR-0001's amendment on the `SameSite` cookie blocking cross-site iframes; that's a same-site-domain project, not this one); Windows/Linux Electron v1; billing BYO local runs (there is nothing to bill).

## Consequences

- **The ingestion API is new backend surface Decision 2 requires and does not yet have.** Today the only way a CODE node's commit/diff/events land in a session is server-side execution (`POST /sessions/:id/nodes/code/stream`). A desktop app executing locally needs a way to *report* a client-run result into the user's own session: `POST .../nodes/code/local` (create, server stays lane-truth — grammar, auto-branch, lane resolution unchanged from the streaming path), `POST .../agent-events` (batched append), `POST .../complete` (real commit/diff, **no `billUsage`** — BYO runs are unbilled by design), `POST .../fail`. This is Phase B work, not yet built. Two integrity properties are non-negotiable when it is built, both surfaced by adversarial review of this plan and neither present in the streaming path's simpler single-writer assumption: (a) event-batch appends must be atomic (`DynamoDB list_append` or a conditional retry) — a single-writer read-modify-write silently drops events under a second concurrent writer (a second browser tab, a retry); (b) `complete` must be state-conditional (`running → done`, reject a second `complete`) and treat client-supplied `commitSha`/`diffSummary` as display-only — never a checkout base — until push-back gives the server something to verify against.
- **Auto-branch race, already latent, becomes reachable once a second writer exists.** `createCodeNodeStreaming`'s auto-branch dedupes a new branch name against an in-request snapshot of `session.nodes`, not a uniqueness constraint. Two near-simultaneous submissions on the same finished CODE parent (two tabs today; web + desktop once Decision 2's ingestion API ships) can mint the same `branchName`, which breaks lane resolution (`walkLaneTipNode`/`findLaneChainTipNode` key lanes by `branchName`). The ingestion API's `prepareCodeRun` extraction must add a conditional-put uniqueness check here — it is called out explicitly so it isn't lost in the extraction.
- **Local execution's security model is client-machine-shaped, not sandbox-shaped.** The BYO local runner has the same filesystem/process access as the user running it — this is why it is dev-only in `code-api` today (env-flag, non-production guard) and why Electron's local mode explicitly runs in a **git worktree inside the user's own repo** (a real, disposable branch, no push, their credentials never touched by forkai) rather than trying to replicate the sandbox's isolation model on a machine forkai doesn't control.
- **BYO auth is unverified CLI/SDK behavior, gated before any shell code is built.** The Claude Agent SDK's `ApiKeySource` type includes `'oauth'`, and an `env` with `ANTHROPIC_API_KEY` omitted is documented to inherit the parent process's environment — but whether a `claude` CLI login (rather than an explicit key) is actually usable this way, end to end, is untested. Phase B's first step (`B0`) is a 30-minute smoke test of exactly this, asserting `system/init.apiKeySource === 'oauth'`, before any Electron shell work starts. If it fails, Decision 2's "$0 LLM cost" premise needs rethinking before more code is written on top of it.
- **Cloud's own follow-ups** (GitHub push-back, per-run-scoped LLM keys ahead of GA, same-site sandbox domains for iframe embedding, the sandbox sweep's TTL reconciliation) are ADR-0001's amendment's list, not repeated here — Decision 1's registry is what lets any of them ship as a runner-internal change with no dto/UI impact, which is the whole point of resolving the environment through one seam.
- **ADR-0004 (multi-turn billing)** still describes a mock-only billing model. Cloud infra cost (~$0.0007/run machine, ~$0.01/run once TTL'd workspaces are counted) is currently absorbed into the existing token margin rather than billed separately — revisit ADR-0004 once multi-turn runs make that absorption dishonest at volume.
