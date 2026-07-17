# Issues & Bug-Fix Log

A running log of bugs found and fixed in fork.ai, newest first. Each entry records the **symptom**, the **root cause**, and the **fix** so a regression is recognisable later.

> **Required step:** update this file in the **same commit** as any bug fix. See [CLAUDE.md → "Issue log (issues.md)"](CLAUDE.md). Format: one `###` entry per fix — Symptom / Cause / Fix, plus the commit SHA once committed.

### forkai-code: the highlight menu's colour palette popped open on every text selection
- **Symptom:** Selecting any passage opened the full highlight colour palette (5 backgrounds + 4 text colours) automatically — noisy versus the original fork.ai, which showed just Ask AI / highlight / Callout until you asked for colours.
- **Cause:** The fork dropped the original's `showColors` state + expand chevron, so the `.hl-color-pop` was rendered unconditionally instead of behind a toggle.
- **Fix:** Restored the original behaviour — the palette stays collapsed until the user clicks the expand chevron (`.hl-expand-btn ▾`), and resets closed when the menu hides.

### forkai-code: deleting a project on the history page did nothing in Safari/WebKit
- **Symptom:** On the Projects/History page, confirming a project delete did nothing in Safari — no request fired, the card stayed. Worked in Chrome.
- **Cause:** WebKit doesn't focus a `<button>` on click. The confirm group disarms via `onBlur` (`setConfirmingId(null)`), and the Cancel button is `autoFocus`ed. Clicking "confirm" in Safari blurred Cancel with `relatedTarget=null` (the clicked button never took focus) → the group's onBlur disarmed and unmounted the confirm button **before** its `onClick` ran, so `onDeleteSession` never fired. Chrome focuses the clicked button, keeping `relatedTarget` inside the group.
- **Fix:** `onMouseDown={e => e.preventDefault()}` on the confirm Yes/No buttons so the click doesn't move focus — no premature blur, and the onClick fires. Verified delete now sends `204` and persists in both WebKit and Chromium.

### forkai-code: composer model selector felt "not working" — only a tiny strip was clickable
- **Symptom:** Clicking the 🤖 model pill in the code composer often did nothing — the dropdown wouldn't open.
- **Cause:** The native `<select>` was content-sized and wedged between the hardcoded 🤖 emoji and a separate ▾ caret span. Only a direct click on that narrow middle strip opened it; clicking the emoji or the caret (which look like part of the control) missed.
- **Fix:** Make the `<select>` a transparent overlay filling the whole pill (`position:absolute; inset:0`) so a click anywhere opens it, with the visible face (emoji + current model label + caret) on top at `pointer-events:none`. Matches TweaksPanel's full-width TweakSelect behavior.

### forkai-code: WebKit/Safari piled every mind-map card's text in the top-left corner
- **Symptom:** In Safari/WebKit, all node card text (titles, badges, OKR chips) rendered stacked at the SVG origin (top-left of the map) instead of at each node's position. Chrome/Firefox were fine.
- **Cause:** The corner-letter badge added `position: relative` to `.mm-card`. WebKit paints a positioned descendant of a `<foreignObject>` (inside a transformed `<g>`) relative to the SVG viewport origin, not the foreignObject — so every positioned card collapsed to the top-left (the same class of bug as the animation note in root CLAUDE.md).
- **Fix:** Drop `position: relative` from `.mm-card` and render the corner letter + run-failed dot as native SVG (`<text>`/`<circle>` siblings of the foreignObject) instead of an absolutely-positioned HTML span. Verified identical in WebKit and Chromium (letter top-right, text in place).

### forkai-code: map render crashed ("reading 'x'") when a learn node hung off a plan-CODE
- **Symptom:** A Next.js runtime error — `Cannot read properties of undefined (reading 'x')` in `layoutGitGraph` — after asking a follow-up (Go deeper / Ask) off a CODE node that was itself built from a PLAN. Took down the whole mind-map render.
- **Cause:** A CODE built from a PLAN is positioned in a post-pass (step 4.5) that runs AFTER the shared learn-hang sweep (step 4). If that CODE already had a learn child, the step-4 sweep called `placeHangingSubtreeV` with the CODE as anchor before its `pos` existed → `anchor.x` on `undefined`.
- **Fix:** `placeHangingSubtreeV` bails when the anchor has no `pos` yet; the post-pass, after positioning the plan-CODE, re-runs `placeHangs` for it so its learn subtree is placed with a valid anchor. Also hardened `laneRails` to skip any column member without a `pos`.

### forkai-code: building a CODE from a PLAN before the plan finished ran an empty query
- **Symptom:** Building the implementation ("implement the plan") right after creating a PLAN produced a failed/empty run — the CODE node showed "Sandbox Failed To Start". The plan-derived build in the demo hit this every time.
- **Cause:** The Build action on a PLAN node was only gated on `codeSubmitLoading`, not on the PLAN still streaming. `planDocOf()` builds the agent's plan context from `planNode.sections`; a PLAN that hasn't finished ("Planning…") has no sections yet, so the agent got an empty plan — an empty query — which the mock run then failed on.
- **Fix:** Frontend — disable Build while the active node is still loading (`buildDisabled = codeSubmitLoading || active.loading`), so you can't build off an unfinished plan (this also makes Playwright's `.click()` wait for the plan to be ready). Backend backstop — `createCodeNodeStreaming` rejects a CODE build whose parent is a PLAN with no sections (`BadRequestException`, "plan is still being generated").

### forkai-code: CODE-from-PLAN drifted to under the PLAN / orphan strip and its edge broke
- **Symptom:** The CODE node built from a PLAN was supposed to sit directly under the BRANCH it was planned in, linked from the PLAN. Instead it kept reverting — after a run/re-render it slid back under the PLAN, and in some states landed in the orphan fallback strip (x=0) with a broken/absent connecting edge.
- **Cause:** A post-pass anchored the CODE to the PLAN's own column (`colOf[planId]`). But a mixer-spawned PLAN hangs off a LEARN node and is laid out by the hang machinery, which never assigns a column — so `colOf[planId]` is `undefined`, the post-pass bailed, and the CODE fell through to `placeOrphans`. Separately, MindMap's lane/bézier edge test keyed off `colOf` (`colOf[pid] === undefined → sameCol → lane`), so a PLAN→CODE edge became a vertical lane at the PLAN's x that didn't reach a CODE placed elsewhere.
- **Fix:** Anchor the CODE to its nearest BRANCH ancestor's column instead (a branch is always placed by `placeRail`, so its column is defined and final) — deterministic, so the position no longer drifts across renders. Base MindMap's lane-vs-bézier decision on the actual node x's (`Math.abs(a.x - b.x) < 1`) rather than `colOf`, so a cross-column PLAN→CODE always routes as a bézier from the PLAN. Verified stable at t=3/11/23s and the edge originates at the PLAN's bottom-centre.

### forkai-code: mock agent run boot-failed ("Sandbox Failed To Start") when built from a PLAN
- **Symptom:** In demo/mock mode, a CODE run built from a PLAN sometimes errored with zero events → the workspace showed the boot-failure header ("Sandbox Failed To Start"), even though an earlier scaffold run on the same session succeeded. The E2E demo hit this on the plan-derived build step.
- **Cause:** `MockAgentService.generate` asks the LLM for a 20–35 event transcript. The plan-build prompt also injects the full PLAN doc (`ctx.planDoc`), so the model emits a longer transcript that can exceed `NON_STREAMING_MAX_TOKENS` (16384) → `generateAgentTranscript` throws `OUTPUT_TRUNCATED`. That call sits *outside* the retry try-block (truncation is deterministic, so retrying the same request is pointless), so it propagated straight to a run error with no events.
- **Fix:** Reduced the requested transcript to 14–22 concise events so a plan-context run stays comfortably under the output limit (the real lever), and bumped the parse-retry to 3 attempts as cheap insurance against a one-off malformed-JSON response. The truncation-not-retried design is preserved (the LLM call stays outside the try). Updated `mock-agent.service.spec.ts` (3 attempts).

### forkai-code: a CODE node built from a mixer PLAN landed in the root column, not under its branch
- **Symptom:** Building a CODE node from a PLAN (the PLAN synthesized from a branch's research directions) placed the CODE in the root/main column (x=0), far from — and visually disconnected from — the branch it was planned in. The WS-4 "re-home under the branch" fix appeared to do nothing.
- **Cause:** The mixer spawns a PLAN with `parentId = activeId`, a **learn node** that hangs beneath a BRANCH. `layoutGitGraph`'s rail DFS (`findRailEntryPoints` → `placeRail`) only recurses through *rail* children, never a rail node's learn subtree — so the PLAN (and its CODE child, a rail node with a rail PLAN parent) was reached by neither `placeRail` nor `placeHangs`, and fell through to `placeOrphans`' fallback strip at x=0. `placeRail`'s `nearestBranchCol` re-home branch (the WS-4 fix) therefore never ran for exactly this topology.
- **Fix:** Added a post-pass in `layoutGitGraph` after step 4 (all columns/positions final) that re-homes any orphaned CODE-with-PLAN-parent (`colOf` still unset) into its nearest BRANCH ancestor's column, stacking its y below the PLAN. Only the CODE's location moves — `parentId` is untouched, so with the columns now differing the edge routes as the cross-column PLAN→CODE bézier (MindMap's `sameCol` check). Guarded on `colOf[id] === undefined` so a CODE already placed by `placeRail` (rail PLAN parent) isn't double-moved.

### forkai-code: branch OKR save failed with "Could not save — try again"
- **Symptom:** Setting an Objective + Key Results on a BRANCH node's OKR editor always failed with the red "Could not save — try again"; the objective/KRs never persisted. The PATCH `/sessions/:id/nodes/:nodeId` returned 500.
- **Cause:** NOT a missing DTO field / schema Map (all correctly declared). class-validator's `@Type(() => OkrDto)` on `UpdateNodeDto.okr` deserialises the incoming JSON into an **OkrDto class instance**, not a plain object. Dynamoose's Object-type checker does a strict `constructor.name === 'Object'` check on nested Object-typed attributes and threw `TypeMismatch: Expected okr to be of type object, instead found type OkrDto` inside `DynamoRepository.updateNode`'s raw `nodeModel.update(key, updates)`.
- **Fix:** In `dynamo.repository.ts` `updateNode`, strip the DTO prototype with a `JSON.parse(JSON.stringify(updates))` round-trip and set via an explicit uppercase `$SET` (mirroring `updateSessionMeta`). Added `dynamo.repository.spec.ts` tests for the `$SET` shape + the OkrDto-instance regression.

### forkai-code: composer textarea padding uneven (#228)
- **Symptom:** Textarea padding was `7px 6px 3px` — top 7px, bottom 3px, sides 6px — making the input text visibly off-center vertically.
- **Cause:** Asymmetric padding shorthand, probably a leftover from earlier composer tweaks.
- **Fix:** Evened to `8px 8px`.

### forkai-code: mind-map card title overflow past foreignObject clip (#230)
- **Symptom:** 2-line titles pushed past the fixed card height (NODE_H=58) and were clipped by the foreignObject, hiding the second line entirely. Optimistic QUERY nodes showed empty titles before the stream delivered the real one.
- **Cause:** Round 2's grey-theme refactor pulled `.mm-label` out of `.mm-card-main`'s flex into a direct child of `.mm-card`, adding a separate row height that overflowed the fixed box.
- **Fix:** Re-wrapped kicker+label inside `.mm-card-text` (flex column, min-width:0) so `-webkit-line-clamp` is bounded by the card height. Optimistic QUERY node titles now truncate `query.slice(0,60)` instead of `''`.

---

### forkai-code: a single transient Fly API network blip killed an entire cloud agent run
- **Symptom:** Live testing of CloudAgentRunner twice saw a whole run fail with the generic "The AI provider took too long to respond" — even though an immediate retry of the same Fly API call succeeded.
- **Cause:** `FlyProvider.flyFetch` called `fetch()` with no retry; a one-off `ETIMEDOUT`/socket-hang-up reaching `api.machines.dev` threw immediately and propagated out of the whole run via `friendlyLlmError`'s network-error regex, masking that nothing was actually wrong with the LLM call.
- **Fix:** `fetchWithRetry` retries once, after a 500ms backoff, but only when `fetch()` itself rejects (DNS/connect/socket failure) — an HTTP-status error like 422 `insufficient_capacity` already has `fetch()` resolve, so it's thrown by `flyFetch`'s `!res.ok` check and never hits the retry path; region fallback (`createMachineWithRegionFallback`) is unaffected either way. (commit: 68f2ff4)

### forkai-code: History page and 404 still carried the research product's brand ("FORK AI · V0.1 · BRANCHING RESEARCH")
- **Symptom:** Landing said "FORKAI CODE · V0.2 · PLAN-FIRST CODING" while the 404 page and both History footers claimed a different product and version.
- **Cause:** Four hardcoded copies of the tagline drifted independently.
- **Fix:** Single `BRAND_TAGLINE` constant in `lib/brand.ts` consumed by Landing, LandingHero, not-found, and HistoryPage (LoginPage's "FORK · NODE NETWORK" ritual intentionally untouched). (commit: 44e8270)

### forkai-code: agent log rendered raw serialized tool JSON; diff summary buried below it
- **Symptom:** The run log showed lines like `{"path":"src/cli.ts","content":"import …\n…"}` — escaped file bodies the user had to mentally deserialize — and the DIFF SUMMARY (the review artifact) rendered below the full log. Also: no timestamps on History cards, a single lonely topic bubble dominated History for new users, plain mouse-wheel over the map zoomed 80→38% in one gesture, and highlight→Ask AI had no discoverability hint.
- **Cause:** tool_call/file_edit/terminal payloads rendered verbatim; pane order put the log first; wheel handler had no modifier gate; no hint existed.
- **Fix:** Humanized tool lines ("→ Wrote src/routes/health.ts") with the raw JSON behind a `<details>` disclosure — covering live tool_call events AND persisted file_edit/terminal replays; DIFF SUMMARY moved above AGENT LOG; relative timestamps on session cards; Topics bubbles hidden under 2 real topics; plain wheel pans / ctrl-or-cmd+wheel (trackpad pinch) zooms; one muted "Select any passage to ask about it" hint under the first section; LoginPage decoy input's phantom 8×6px box zeroed. (commit: 44e8270)

### forkai-code: reopening a project could hide all its work behind an empty "What are we building?" screen
- **Symptom:** Opening a project from History sometimes landed on the ProjectStart interstitial with an empty prompt even though the project held a full map of commits — and sometimes went straight to the workspace. Which one you got depended on invisible timing.
- **Cause:** The gate keyed on `LEARN_KINDS` membership plus the async `getProject` fetch settling, so sessions holding only CODE/BRANCH nodes always re-showed ProjectStart, and `projectStartDismissed` reset on every sessionId change.
- **Fix:** ProjectStart shows only for an *effectively empty* session (`isProjectSessionEmpty`: no nodes, or a single unfilled non-loading seeded root), computed purely from `nodes`; dismissal persists per-session in `localStorage['forkai-code.projectStartDismissed']`. Recorded trade-off: imported-repo projects open the workspace directly. (commit: 97ef6ac)

### forkai-code: mind map silently dropped nodes whose parent chain didn't reach the root
- **Symptom:** The reading pane could show a node (e.g. a branch created during an error flow) that didn't exist anywhere on the map — the map's count badge and canvas disagreed with the pane.
- **Cause:** `layoutGitGraph`/`layoutTree` only positioned nodes reachable from `rootId` via `childMap`; MindMap skips nodes without positions.
- **Fix:** `placeOrphans` lays out unplaced nodes in a fallback row below the graph bounds (and stamps their depth), on all three layout exit paths; edge drawing already guarded missing endpoints. (commit: 97ef6ac)

### forkai-code: node kinds had two vocabularies — map said COMMIT/BRANCH where the pane said Code/Follow-up
- **Symptom:** The same node was labeled "BRANCH" on the map and "Follow-up" in the reading pane; code runs were "COMMIT" on the map and "Code" in the pane. "Branch" ambiguously covered git branches AND conversational follow-ups.
- **Cause:** Three independent inline label ternaries (MindMap kicker, App pane pill, AgentLogPane pill).
- **Fix:** Single `kindLabel()` map in `lib/kindLabels.ts` consumed by all three; ASK→Follow-up everywhere, CODE→Commit everywhere, Branch reserved for kind BRANCH. (commit: 97ef6ac)

### forkai-code: derived commit titles kept trailing punctuation ("feat: Scaffold CLI with Commander,")
- **Symptom:** Node cards, breadcrumbs, and the pane title showed the first-5-words commit-message cut with a dangling comma.
- **Cause:** `commitMessage.split(/\s+/).slice(0, 5).join(' ')` cuts mid-clause.
- **Fix:** Trim trailing `,;:.` after the cut (nodes.service.ts) + regression spec. (commit: 74bc714)

### forkai-code: mobile bottom bar pile-up made the composer untappable
- **Symptom:** At 390px the "Mindmap" pill sat on top of the composer input (clipping the placeholder and intercepting taps); the ⚙ trigger and status chips crowded the same band.
- **Cause:** `.mm-pill` fixed at bottom+16px, `.twk-trigger` at bottom 24px with no mobile reposition, both inside the composer's band (composer top ≈ bottom+94px on mobile).
- **Fix:** Mobile-only offsets: pill and trigger at `safe-area + 106px`, status chips at `+150px` — measured against the composer's real height with clearance. Mixer-mode hiding preserved. (commit: d4f750d)

### forkai-code: dark-mode selects rendered as garbled zigzag glyph rows
- **Symptom:** With the Dark theme active, the Tweaks panel's Font-pairing and Model selects displayed as rows of repeated triangles — unreadable.
- **Cause:** `[data-theme="dark"] .twk-field` used the `background:` shorthand (resets `background-repeat`/`position`, outranks `select.twk-field`'s no-repeat rule); the dark select rule then re-added only `background-image`, so the dropdown-arrow SVG tiled across the control.
- **Fix:** Dark rules use `background-color` only, leaving image/repeat/position to the select-specific rules. The Theme toggle itself is removed until a full dark theme ships (`useTweaks` coerces stored dark→light; ThemeScript forces light). (commit: d4f750d)

### forkai-code: zoom disabled globally + sub-AA contrast + invisible focus + phantom tab stops
- **Symptom:** Pinch-zoom was blocked on every page (`user-scalable=no`); the landing tagline/footer used #999 (~2.85:1) text; the composer and auth inputs had no visible keyboard focus; closed NotesDrawer/HighlightMenu buttons stayed in the tab order.
- **Cause:** Viewport export set `maximumScale:1, userScalable:false`; `--ink-3` token too light; `outline: none`/inline outline suppression without `:focus-visible` replacements; `aria-hidden` containers without `inert`.
- **Fix:** Zoom unlocked (WCAG 1.4.4); `--ink-3` #999999→#767674 (≥4.5:1, light theme); `.twk-status-off` drops the opacity fade; global `:focus-visible` outline + explicit rules for the composer textarea and auth input; `inert` on closed drawer/highlight menu. (commit: d4f750d)

### forkai-code: primary CTAs looked permanently disabled; wordmark overlapped the breadcrumb; Account menu ignored Escape
- **Symptom:** "Begin"/"Create" rendered near-identical grey whether actionable or not; the fixed "forkai code" wordmark overlapped the first crumb on desktop (topbar and History topbar); the Account menu didn't close on Escape or outside click and its lingering state swallowed clicks.
- **Cause:** `:disabled` was only an opacity fade; `.topbar` reserved 140px for a ~185px-wide brand; AccountButton had no dismissal listeners.
- **Fix:** Distinct muted disabled fill (`var(--line)` bg); topbar/history-topbar left padding 140→190px; Escape + outside-pointerdown dismissal on the account popover. (commit: d4f750d)

### forkai-code: page refresh during an agent run lost all run awareness — static "Starting…" forever
- **Symptom:** Reloading the tab while a CODE run was in progress landed the pane on an unrelated node; the running commit sat on the map with sha "–" and no status. Even when the run completed server-side, the UI never found out (AgentLogPane showed the "Starting…" shimmer indefinitely for a node restored with `agentStatus: 'running'`).
- **Cause:** AgentLogPane only fetched the persisted AgentRun for `done|error` nodes — nothing polled a `running` one. And `loadSession` kept the cache-painted active node (the root) over the running node, so the running node's pane (the only place polling could live) never even mounted.
- **Fix:** AgentLogPane polls `getAgentRun` every 2.5s while `kind==='CODE' && agentStatus==='running' && !hasLiveLog`, streaming persisted events into the log and calling `onRunResolved` when the run lands (App patches sha/branch/message/diffSummary/title). `loadSession` prefers a node with `agentStatus==='running'` as the active target — including over the cache-kept previous node, which loadSession itself had just set. Gate is strictly `=== 'running'` (merge commits omit `agentStatus` by design). (commit: 8fd2f9e)

### forkai-code: failed CODE runs showed an empty grey log with no message; Retry no-oped for commit-anchored asks
- **Symptom:** When a code-run stream failed, the pane showed "● Error" and an empty AGENT LOG box — no reason, no recovery. Separately, asking about a commit that failed server-side showed the error banner but its Retry button silently did nothing.
- **Cause:** CODE nodes are excluded from the generic `ws-error` banner and AgentLogPane had no error rendering; `askAboutCommit`'s catch never registered a `retryInfoRef` entry (no `RetryInfo` variant existed for commit-anchored ASKs), so `retryNode` returned early.
- **Fix:** AgentLogPane renders `node.error` + Retry for `agentStatus==='error'` (retry re-runs the code stream in place via `submitCodeNode`'s new `reuseNodeId`); new `RetryInfo` variant `ASK_COMMIT` registered in `askAboutCommit`'s catch and dispatched in `retryNode`. The "Ask about this commit" row is also gated off while a run is in progress. (commit: 8fd2f9e)

### forkai-code: stream error payloads leaked raw into the UI — "Sorry — data: {json}"
- **Symptom:** A failed streaming request showed the serialized SSE frame (`Sorry — data: {"type":"error","message":...,"status":400}`) instead of the message.
- **Cause:** `extractError` (lib/api.ts) only tried bare-JSON parsing; an SSE-framed error body (`data: {...}` lines) fell through to the raw-text branch.
- **Fix:** `extractError` now extracts and parses the last `data: {...}` line first, returning its `message`/`code`; falls through unchanged otherwise. (commit: 8fd2f9e)

### forkai-code: agent runs were silent for ~18s — a frozen "Starting…" until the first real event
- **Symptom:** After submitting an instruction, the agent log showed a static "Starting…" for the entire LLM transcript-generation latency (~18s of a ~42s run) — indistinguishable from a hang, inviting refreshes/resubmits.
- **Cause:** `createCodeNodeStreaming` emitted nothing between `init` and the first `agent-event`; the default MockAgentRunner awaits one non-streaming LLM call for the full transcript before yielding anything.
- **Fix:** The service emits a synthetic heartbeat `agent-event` (kind `text`, rotating "Agent is working…" copy) every 3s between `init` and the first real yield. Heartbeats use negative `seq`s (can't collide with real events, which start at 0) and are SSE-only — never pushed into the persisted AgentRun events. Cleared on first real yield and in a `finally` backstop. (commit: 022c3a5)

### forkai-code: deleting a project was instant — no confirmation, no undo, invisible on touch/keyboard
- **Symptom:** One click on the hover-revealed trash icon permanently deleted an entire project. The icon was also unreachable on touch devices (no hover) and invisible to keyboard users.
- **Cause:** `.session-card-delete` fired `onDeleteSession` directly; reveal was `:hover`-only.
- **Fix:** Two-step inline confirm ("Delete?" ✓/✕; Escape/blur/✕ disarm), reveal on `:focus-within`, and always-visible at reduced opacity under `@media (hover: none)`. (commit: 8fd2f9e)

### forkai-code: first question in every new-repo project failed with 400 "Cannot create a QUERY node under a BRANCH parent"
- **Symptom:** Creating a from-scratch project and asking its opening question (via ProjectStart or after reopening) always returned HTTP 400 with the raw payload rendered in the error banner. The core ask→answer loop was dead for every new project.
- **Cause:** The Dynamoose null-stripping quirk (see the null-handling entry in CLAUDE.md) on the **read** path: the seeded BRANCH root is written with `parentId: null`, which Dynamo stores as attribute-absence, so nodes read back with `parentId: undefined`. `createRootNodeStreaming`'s fill-root gate did a strict `find(n => n.parentId === null)`, missed the root, fell through to the seeded-question path, and `assertKindAllowed('BRANCH', 'QUERY')` threw. Regression tell: any strict `=== null` comparison against an optional Dynamo attribute.
- **Fix:** `DynamoRepository` now normalizes `parentId: item.parentId ?? null` in the node read path (`toNode`/`toNodeArray` used by `getNode`/`queryNodes`), plus belt-and-suspenders `(n.parentId ?? null) === null` at the three strict finds (`sessions.service.ts` fill-root gate + anchor lookup, `nodes.service.ts` `findMainChainTip`). Regression specs: repository round-trip (missing `parentId` → `null`) and a fill-root test whose mocked root omits the `parentId` key. (commit: 549a379)

### forkai-code: modal/landing project brief silently discarded — ProjectStart re-asked "What are we building?"
- **Symptom:** Typing the project brief in the New-project modal (or submitting a query from the authed Landing) created the project but never streamed the answer; the user landed on ProjectStart with an empty "What are we building?" input — the brief they had just typed was gone.
- **Cause:** `handleCreateProject` fired `void submitFillRoot(...)`, which read the root node id from `rootIdRef.current` — a ref that `openProject`→`loadSession` populates via React state settling. The `void` call raced that settle and silently early-returned on `!nodeId`. A second landmine sat behind it: once fill-root works, its stream events carry the EXISTING root's id, and ProjectStart's `submitProjectQuery` path would have had `consumeRootStream`'s done-swap overwrite that root with an optimistic QUERY child's fields (parentId = its own id), sending `buildChildMap` into infinite recursion.
- **Fix:** `loadSession` returns the loaded root id, `openProject` forwards it, and `submitFillRoot(sid, query, rootNodeId)` takes it explicitly (ref is fallback only). ProjectStart's submit now routes to `submitFillRoot` when the root is an empty BRANCH (else `submitProjectQuery` as before), and `consumeRootStream`'s done handler merges streamed content into an already-existing node instead of overwriting it. (commit: e5ec074)

### forkai-code: query typed on Landing while logged out was destroyed by the login gate
- **Symptom:** A logged-out visitor typed a task on the Landing page and pressed Enter/Begin; they were sent to the login screen and their typed query no longer existed anywhere — after logging in they landed on an empty Landing.
- **Cause:** The Landing submit path called `submitRootQuery`, whose first line is `if (!idToken) { setForceLogin(true); return; }` — nothing stashed the typed text.
- **Fix:** The unauthenticated Landing submit now stashes `{query, plugins}` to `localStorage['forkai-code.pendingQuery']` before forcing login; a StrictMode-guarded effect replays it via `submitLandingProject` once `status === 'authenticated' && idToken` settles (placed after `submitLandingProject`'s declaration per the hook-ordering caveat). Mirrors the sibling app's `fork.ai.pending` pattern. (commit: e5ec074)

### forkai-code: buildspec.yml and Dockerfile would have deployed apps/api into forkai-api's production environment
- **Symptom:** Discovered while wiring up production infra for `code.forkai.in`/`code-api.forkai.in` — no user-visible symptom yet, since no CodeBuild project had ever pointed at `apps/code-api/buildspec.yml`.
- **Cause:** Both files were unedited copies from the `apps/api` scaffold. `buildspec.yml` still set `IMAGE_REPO_NAME`/`EB_APP_NAME`/`EB_ENV_NAME` to `forkai-api`/`forkai-api-prod` and built `apps/api/Dockerfile`; the Dockerfile itself still `COPY`'d and compiled `apps/api/`. Had a CodeBuild project been created pointing at this buildspec before the fix, its first build would have pushed the wrong image straight into the main app's production Elastic Beanstalk environment.
- **Fix:** Retargeted both files to `apps/code-api`/`forkai-code-api`/`forkai-code-api-prod`, and gave the S3 artifact upload a `code-api/` key prefix (the buildspec's `IMAGE_TAG` is the git commit SHA, shared with `apps/api`'s build since both live in the same repo — an unprefixed key would let the two buildspecs clobber each other's `app-bundle.zip` on the same commit). (commit: pending)

### forkai-code: code-web landing page fetched a `/topics` endpoint that no longer exists on code-api
- **Symptom:** Every SSR render of `apps/code-web`'s `/` route made a failing `fetch(`${API_BASE}/topics`)` call (404), silently swallowed by the existing try/catch fallback — no user-visible breakage, but a guaranteed-failing request on every page load.
- **Cause:** `page.tsx` was still carrying `apps/web`'s research-topics fetch (`GET /topics`), an endpoint that was never implemented on `code-api` (this fork has no topic-suggestion feature) — leftover from the original scaffold-by-copy.
- **Fix:** Removed `fetchTopics`/`FALLBACK_TOPICS` entirely; `page.tsx` now passes a small static list of code-flavored example prompts (`EXAMPLE_TOPICS`) as `initialTopics` — same prop signature, no network call. (commit: dc01e54)

### forkai-code: "Failed to create project" on every attempt — Dynamoose rejected the nested DTO instance
- **Symptom:** In `apps/code-web`, creating a project always failed with the modal's generic "Failed to create project — please try again", regardless of the selected mock repo. code-api logged 500s: `TypeMismatch: Expected repoRef to be of type object, instead found type RepoRefDto`.
- **Cause:** `ProjectsService.create` passed `dto.repoRef` straight into the `ProjectItem` for `putProject`. Nest's `ValidationPipe` (with `transform: true` + `@Type(() => RepoRefDto)`) materialises nested bodies as **class instances**, and Dynamoose v4's type checker rejects any nested `Object`-typed field whose value isn't a plain object (it inspects the constructor). Same footgun family as the documented null-handling/`saveUnknown` Dynamoose quirks — but on the write path for class instances.
- **Fix:** Spread into plain literals before persisting: `repoRef: { ...dto.repoRef }`, `plugins: [...dto.plugins]` (`apps/code-api/src/projects/projects.service.ts`). Regression tell: any repository write that passes a `class-validator`/`class-transformer` DTO (or a nested DTO field) directly into a Dynamoose model instead of a plain-object copy. (commit: d0da073)

### "Save to Notion" showed "Failed to save — try again" with no console error and no server request
- **Symptom:** A user's Notion export repeatedly failed with the generic "Failed to save — try again". Nothing appeared in the browser console, and the backend logs showed no `/notion/push` request at all (not even the CORS preflight) — making it look like a server issue with no trace anywhere.
- **Root cause:** `stripCiteRefs(body)` in `apps/web/src/lib/notion-clipboard.ts` did `body.replace(...)` with no nullish guard, and is called on `section.body` and `node.lede`. A node held only in **client state** — a streamed or mixed node that finished loading (so it's not filtered as `loading`) but never received body text — has `section.body === undefined`, so `stripCiteRefs` threw `TypeError: Cannot read properties of undefined (reading 'replace')`. This was invisible for two compounding reasons: (1) the throw happened inside `buildNotionClipboard` **before** `pushToNotion`, so no `/notion/push` request (not even the CORS preflight) ever reached the server — the prod EB logs showed the user opening the picker (`/notion/status` + `/notion/pages` 200) but zero pushes; (2) `doNotionPush`'s `catch` set the "try again" message with **no `console.error`**, so the browser console stayed empty. The user's *saved* DB data all had bodies (a repro against it succeeded) — only the live in-browser state had the undefined field. Diagnosed by pausing on caught exceptions on the live site: `Cannot read properties of undefined (reading 'replace') at N` (minified `stripCiteRefs`).
- **Fix:** `stripCiteRefs` now returns `''` for nullish input (covers all `section.body`/`node.lede` call sites); the two other raw `section.body` consumers (`marked.parse` and the plain-text template) default to `''` too. Separately hardened the error handling in `doNotionPush`: the client-side build runs in its own `try` with a distinct message ("Couldn't build the Notion page from this session"), and both the build and push `catch`es now `console.error` + emit a `notion_export_error` breadcrumb (`stage: 'build'` / `'push'`) so any future build crash is diagnosable instead of silent. Regression tell: any unguarded `.replace`/`.parse` on `section.body`/`node.lede` in the exporter, or a Notion-save `catch` that sets an error message without logging it. (commit: pending)

### Mixer overlay unusable on phones — buried under the floating Read pill, tweaks chips, gear, and account button
- **Symptom:** Activating the Mixer on a phone left its panel unusable: the floating "Read" pill sat on top of the shortcut hint, the tweaks status chips and gear overlapped the question row and "Mix & Spawn" button, and the account button overlapped the input's left edge. The `⌘ + ⏎ to mix · Esc to cancel` hint also rendered on touch devices where it's meaningless.
- **Cause:** The mixer overlay is `position: absolute; bottom: 14px; z-index: 10` inside the map pane, while the mobile floating chrome uses near-max z-indexes (`.mm-pill` 2147483646, `.twk-status`/`.twk-trigger` 2147483645, account button z 60 fixed) and stays visible during mixer mode — on a phone they all share the same bottom strip.
- **Fix:** Mobile-only (`@media (max-width: 768px)` in `globals.css`): `body:has(.mixer-overlay)` hides `.mm-pill`, `.twk-status`, `.twk-trigger`, and `button[aria-label="Account"]` while the mixer is open (same `body:has` pattern as the `.app-brand` hide); the desktop shortcut hint is `display: none`; the overlay gets the `env(safe-area-inset-bottom)` offset per the mobile safe-area rule. Cancel remains available via the map toolbar's red × mixer toggle. (commit: 4eb7a0e)

### Android app crashed to "Something went wrong" on every launch (first build with @capacitor/app)
- **Symptom:** The v4 (1.0.3) Android app showed the SSR landing for a moment, then the root error-boundary page ("Something went wrong.") on every cold start and every reload — a permanent crash loop. Website and older app builds were unaffected.
- **Cause:** `NativeShell.tsx` called `app.addListener('backButton', …).then(…)` against the **raw injected bridge** (`window.Capacitor.Plugins.App`). The injected runtime returns the `PluginListenerHandle` **synchronously** — only `@capacitor/app`'s npm wrapper promisifies `addListener` — so `.then` threw `TypeError: n.addListener(...).then is not a function` inside the mount effect, unmounting the entire app into `global-error.tsx`. Latent since the listener shipped: it only executes when the shell build actually contains the App plugin, so the first v3/v4 install detonated it. Playwright repros missed it because the bridge mock was written to match the *typed* interface (Promise), not the real runtime. Diagnosed by making `global-error.tsx` print the error text on-screen (Sentry has no prod DSN; boundary-caught errors never reach `window.onerror`, so PostHog exception autocapture couldn't see it either).
- **Fix:** Wrap the call in `Promise.resolve(app.addListener(...))` (accepts both shapes) with defensive `h?.remove?.()`, and the `CapacitorAppPlugin` typing now declares `PluginListenerHandle | Promise<PluginListenerHandle>` so future callers are forced to normalize. Regression tell: any direct `.then`/`await`-free chaining on a raw-bridge `addListener` result. (commit: pending)

### Hardware back always minimized (or on old builds, closed) the Android app — never navigated in-app
- **Symptom:** In the Android app, pressing the hardware back button from anywhere (a session, the History page) minimized the app instead of returning to the previous in-app screen, even though the user had clearly navigated multiple steps deep.
- **Cause:** `App.tsx` only ever used `history.replaceState` for the session hash and `?view=history` — never `pushState` — so browser history depth stayed at 1 for the whole visit. `NativeShell`'s `backButton` handler checks Capacitor's `canGoBack`, which was therefore always `false`, so it could only ever call `minimizeApp()`. Also affected mobile browsers (back exited the site entirely from a session).
- **Fix:** `pushState` on real entry transitions — landing → session (and cold-restore-from-localStorage/History-open, since those also start from an empty hash) and landing/session → History view (only when `?view=history` isn't already the current URL) — while every other case (reload-with-hash, within-session node navigation, leaving a view) keeps the existing `replaceState`. A new `popstate` handler (`apps/web/src/components/App.tsx`) reconstructs state from the URL on back/forward: loads the target session by id, or resets to landing/History when the hash empties out. Guest (`?sk=`) sessions are left alone on an empty-hash pop — their share-load effect only ever fetches once, so resetting state would strand them on a permanent spinner instead. (commit: 258cb69)

### Download image and Export to PDF did nothing in the Android app
- **Symptom:** Tapping "Download image" (Share button) or "Export to PDF" in the Android app produced no visible result — no file, no share sheet, no error.
- **Cause:** Android's Capacitor WebView has no Web Share API (`navigator.share`/`canShare` are undefined, so the iOS branch added in `f792e62` never ran) and drops `<a download>`/blob-URL downloads entirely (no `DownloadListener` registered in the shell), so both `ShareButton.tsx`'s `handleDownloadImage` and `sessionPdf.ts`'s `exportNodePdf` silently no-op'd there.
- **Fix:** Added `nativeDownload()` (`apps/web/src/lib/native.ts`) — writes the blob via the injected `Capacitor.Plugins.Filesystem` and hands it to `Capacitor.Plugins.Share` for the native share sheet. Both call sites try it first and fall back to their existing web paths when it returns `false` (browser, or an app build before the plugin ships). Inert until the next Android build adds `@capacitor/filesystem` + `@capacitor/share` — no `@capacitor/*` dependency was added to `apps/web` itself, the bridge is typed by hand against `window.Capacitor`. (commit: 258cb69)

### "Download image" on iPhone opened a file-preview page instead of saving the image
- **Symptom:** Tapping the Share button's "Download image" on an iPhone didn't save the PNG — Safari/WKWebView navigated to a QuickLook-style file-preview screen ("Effective-Weight-Loss-Strategies.png · Open in Preview / More…"), leaving the user to figure out what to do with the file. In the Android Capacitor app the button silently did nothing (WebView has no download listener).
- **Cause:** `handleDownloadImage` (`ShareButton.tsx`) only ever fired a programmatic `<a download>` click on `/api/og/share/:token?scale=2`. iOS has no "download a file to disk" path for the `download` attribute — it opens the preview page instead — and the Capacitor Android WebView drops downloads entirely.
- **Fix:** On touch devices (iPhone/iPad/Android UA) that support Web Share Level 2, fetch the PNG, wrap it in a `File`, and call `navigator.share({ files })` — the native share sheet offers "Save Image" straight to Photos. Desktop keeps the plain `<a download>`, which is also the fallback if `canShare` is unavailable or the fetch/share throws; a dismissed share sheet (`AbortError`) is treated as done, not a failure. (commit: f792e62)

### Android launch screen showed a stretched, ugly logo for the 2–3 s cold-start load
- **Symptom:** Cold-starting the Android app showed the fork mark distorted/blurry in the centre of the launch screen for the 2–3 seconds the remote forkai.in page takes to load. Warm resume was unaffected.
- **Cause:** The launch theme (`AppTheme.NoActionBarLaunch` in `apps/mobile/android/.../values/styles.xml`) set `android:background="@drawable/splash"` — a 480×320 opaque PNG. A theme-level `android:background` is scaled to fill the window (and leaks onto child views), so the small landscape bitmap was stretched to the full portrait screen.
- **Fix:** Replaced it with `windowSplashScreenBackground=@color/splash_background` (white, new `values/colors.xml`) + `android:windowBackground=@drawable/splash_layered` — a new layer-list (white + `@mipmap/ic_launcher_foreground` at a fixed 192dp, `gravity="center"`), so the mark renders at its natural size and matches the Android 12+ system-splash icon for a continuous handoff. Deleted the 11 obsolete `splash.png` density variants. Regression tell: any reappearance of `android:background` (not `windowBackground`) in the launch theme re-breaks it. (commit: 7791eee) **Hardened for API 31+** after a device showed a white icon-circle on a non-white background: `values-v31/styles.xml` now sets the framework attrs directly (`android:windowSplashScreenBackground` white, `android:windowSplashScreenAnimatedIcon` = the transparent-glyph `ic_launcher_foreground`) so the system splash can't render the white adaptive-icon chip on a tinted background regardless of OEM handling of Theme.SplashScreen's `?attr` indirection. (commit: 75ab9de)

### Android back gesture exited the app from /welcome instead of returning to Landing
- **Symptom:** In the Android app (Capacitor shell), navigating Landing → "How it works" → `/welcome` and then using the hardware back gesture/button exited (backgrounded) the app instead of going back to Landing. `/welcome` itself had no nav chrome either — the only way back was the "Try fork ai free" link at the very bottom of the story.
- **Cause:** The shell had no `@capacitor/app` plugin and no `backButton` listener, so back events fell through to the activity default (finish/minimize) rather than navigating WebView history. On the web side, the `/welcome` StoryPage rendered no header/back affordance at all.
- **Fix:** Added `@capacitor/app` to `apps/mobile` (registered via `cap sync`) and a `NativeShell` client component mounted in the root layout (`apps/web/src/components/NativeShell.tsx`) that listens for `backButton`: `canGoBack → history.back()`, else `minimizeApp()` — typed against the injected `window.Capacitor` bridge, no `@capacitor/*` dep in apps/web, inert on the website and in old shell builds. Also added a fixed top nav to `/welcome` (`WelcomeNav.tsx` + `.wp-nav` in `welcome.css`) with the brand and a "Try fork ai" CTA linking to `/`, offset by `env(safe-area-inset-top)` per the mobile safe-area rule. (commit: 7f25b0a)

### Fork.ai logo and nav overlapped Android status bar on Landing/History pages
- **Symptom:** On Android (Capacitor WebView, edge-to-edge mode), the fork.ai logo and History button on the Landing page, and the logo on the History page, rendered inside/behind the system status bar rather than below it. The session workspace was unaffected.
- **Cause:** `.app-brand` (`position: fixed; top: 14px`) and `.landing-nav` (`position: absolute; top: 16px` inside `.landing { position: fixed; inset: 0 }`) used hardcoded `top` values with no `env(safe-area-inset-top)` offset. On the session page `.app-brand` is hidden via `body:has(.app) .app-brand { display: none }` so the issue didn't appear there. The status bar on Android 15+ is ~30px in CSS pixels, so `top: 14–16px` placed both elements inside it.
- **Fix:** Added `top: calc(14px + env(safe-area-inset-top))` / `top: calc(16px + env(safe-area-inset-top))` for `.app-brand` / `.landing-nav` in `@media (max-width: 768px)`, and added `padding-top: calc(72px + env(safe-area-inset-top))` to `.landing-inner` so landing content doesn't overlap the repositioned nav. Also applied the env offset to the `@media (max-width: 400px)` small-phone `.landing-inner` padding. (commit: 3e6f8a3)

### Share button's "Download image" dropdown was unreachable on hover
- **Symptom:** Hovering the "Shared" button revealed the "Download image" dropdown, but moving the cursor down toward it made the dropdown disappear before it could be clicked — the option was effectively unreachable.
- **Cause:** `.share-dl-dropdown` (`globals.css`) was positioned `top: 100%` with a `margin-top: 4px` gap below `.share-hover-target`, the `:hover`-tracked wrapper. That 4px gap sits outside the wrapper's hoverable box, so moving the pointer from the button toward the dropdown crossed a dead zone where neither element was hovered — `:hover` dropped and `display: none` re-applied to the dropdown an instant before the cursor arrived.
- **Fix:** Added `padding-bottom: 8px` to `.share-hover-target` (extending its real, hoverable box down through the visual gap) offset by `margin-bottom: -8px` so the extra height doesn't push the surrounding topbar row taller. The dropdown now sits flush against the end of that padded box, so the hover state stays continuous from the button all the way into the dropdown. Verified with a Playwright test that moves the pointer along the actual path a user's cursor takes (not a teleporting hover) and confirms the click registers. (commit: pending)

### Share button required two clicks to copy the link on the first-ever share
- **Symptom:** Clicking "Share" on a session that had never been shared before minted a token and flipped the UI to "Copied!", but the link was not actually on the clipboard — the user had to click the button a second time for the copy to work.
- **Cause:** `handleShare` (`ShareButton.tsx`) called `await shareApi.generateShareToken(...)` (a network round-trip) before `await navigator.clipboard.writeText(url)`. Browsers only allow clipboard writes within the "user activation" window of the triggering click; that window is revoked the instant an `await` yields back to the event loop, so the write silently failed (swallowed by `.catch(() => {})`) while the UI optimistically showed "Copied!" anyway. The second click worked because it hit the already-`active` fast path, calling `writeText` with no preceding network `await`.
- **Fix:** For the "mint a new token" path, call `navigator.clipboard.write()` synchronously inside the click handler with a `ClipboardItem` whose value is a `Promise<Blob>` — the token-minting fetch now happens inside that promise instead of before the clipboard call, which keeps the write inside the browser's activation window. Falls back to the old sequential `writeText` for browsers without `ClipboardItem`. If the clipboard write fails but the token was minted, the button still lands on the working "Shared" state instead of resetting to "idle" and losing the token. (commit: pending)

### PDF upload broken on every Safari — "undefined is not a function (near '...t of e...')"
- **Symptom:** Uploading any PDF on forkai.in from Safari (macOS and iOS, **all versions** incl. Safari 26) failed instantly with `undefined is not a function (near '...t of e...')` shown as the file error. Chrome/Firefox worked; image (OCR) and text uploads worked. Broken since the feature shipped (`cccbb91`, pdfjs-dist ^6.0.227 from day one). Dev testing in Chrome and the Chromium-only Playwright project never hit it.
- **Cause:** From pdfjs-dist 5.5, `PDFPageProxy.getTextContent()` internally iterates its text stream with `for await (const value of readableStream)`. No released Safari supports async iteration of `ReadableStream` (`ReadableStream.prototype[Symbol.asyncIterator]` — caniuse `mdn-api_readablestream_--asynciterator`; Chrome 124+/Firefox 110+ only). JavaScriptCore reports the failed iterator lookup as the cryptic minified error above. `extractPdf` (`apps/web/src/lib/extractDocument.ts`) calls `getTextContent()` per page, so every PDF failed. pdf.js v6 modern build additionally uses `Promise.try`, `Uint8Array.toHex` (Safari 18.2+) and `Map.prototype.getOrInsertComputed` (no released Safari) unpolyfilled — and the latest 6.1.200 still ships the same `for await`, so upgrading is not a fix.
- **Fix:** Pin `pdfjs-dist` to **exactly 5.4.624** (last version before the `for await` refactor; no `^` — any 5.5+/6.x resolve re-breaks it). Verified with a Node harness that deletes `ReadableStream.prototype[Symbol.asyncIterator]` to simulate Safari and runs the real extraction path against a fixture PDF: 6.0.227 throws at `getTextContent`, 5.4.624 extracts text. Floor is now Safari 18.2+ (5.4.624 still uses `Promise.try` on the load path). No regression-test seam exists yet: apps/web has no unit runner and Playwright's WebKit is too new to reproduce the missing API. (commit: cf5e4ae)

### Mixer shake/pulse/pop animated the wrong spot in Safari — node snapped near the SVG origin
- **Symptom:** During "Mixer" synthesis, the base node's shake animation (and the pulse/pop on new nodes) rendered near the top-left of the mind map's SVG canvas instead of shaking in place at the node's actual position. Chrome/Firefox were unaffected.
- **Cause:** `spawnMix` (`App.tsx`) added `mixer-shaking`/`mixer-pulse`/`mixer-pop` to `.mm-card` — an HTML `<div>` rendered inside a `<foreignObject>`, itself nested inside SVG `<g>` elements positioned via the "transform" **attribute** (`translate(${p.x} ${p.y})`). Safari/WebKit doesn't compose a CSS `transform` *animation* on `foreignObject`-nested HTML content with an ancestor `<g>`'s attribute-based transform, so the animated card painted relative to the SVG's own origin instead of the node's translated position.
- **Fix:** Wrapped the node's pill/foreignObject in a new inner `<g className="mm-node-anim">` (`MindMap.tsx`) — a native SVG group, which composes correctly with the ancestor `<g>`'s transform attribute (same class of fix as the login-graph animation below). `spawnMix` now targets `.mm-node-anim` instead of `.mm-card` for all three classes. Added `transform-box: fill-box; transform-origin: center` on `.mm-node-anim` so `mixer-pulse`/`mixer-pop`'s `scale()` still anchors on the node's own centre rather than the SVG viewport, and swapped `.mixer-shaking`'s `box-shadow` (invalid on SVG elements) for an equivalent `filter: drop-shadow(...)`. (commit: pending)

### Login graph animation incomplete in Safari — rings/particles/node blow-out never moved
- **Symptom:** The post-login graph animation played fully in Chrome but was "not complete" in Safari/WebKit (and the installed PWA): the breakthrough rings didn't expand, the particle burst didn't fly out, and the blow-out nodes didn't move — only the opacity fades happened.
- **Cause:** The animation drove **SVG geometry attributes** (`r`, `cx`, `cy`) as Web Animations API keyframes. Blink (Chrome) registers these as animatable CSS properties; **WebKit does not**, so those keyframes were silently ignored. `opacity`/`stroke-width` are real CSS properties so the fades still ran — hence "partially" complete.
- **Fix:** In `breakthrough()` and `blowOut()` (`apps/web/src/components/LoginPage.tsx`), replaced every geometry-attribute keyframe with a CSS `transform`: rings now `scale()` about their own centre (`transform-box: fill-box; transform-origin: center`, plus `vector-effect: non-scaling-stroke` on the stroked ring to preserve the thinning), and particles + nodes now `translate(...px)` instead of animating `cx`/`cy` (explicit `px` units — Safari rejects unitless translate). `opacity`/`stroke-width` keyframes and the rAF trace head are unchanged. (commit: pending)

### MindMap root node showing `\claude` (or escape sequences) instead of emoji
- **Symptom:** Root node emoji slot in the mind map sometimes shows `\claude` or a raw JSON escape sequence (e.g. `🌿`) as literal text instead of the intended emoji character.
- **Cause 1:** `extractMeta` in `llm.service.ts` uses a regex to extract `title`/`emoji`/`lede` from the partially-streamed JSON. The regex captures the raw JSON-encoded string content verbatim (e.g. `\uXXXX` unicode escapes, `\\` backslash sequences) without JSON-decoding. `title` and `lede` had a minimal `replace(/\\"/g, '"')` fix but `emoji` was returned raw. When Gemini emits a surrogate-pair encoded emoji or an unexpected backslash-prefixed token, the literal escape sequence appeared in the node card.
- **Cause 2:** No emoji validation on the display side — any truthy string in `n.emoji` was rendered directly in `<span className="mm-emoji">`.
- **Fix:** Added `jsonDecodeCapture()` in `llm.service.ts` that wraps the regex capture in `JSON.parse` to decode all JSON escape sequences; applied it to `title`, `emoji`, and `lede` in `extractMeta`. Added `/\p{Emoji}/u` guard in `MindMap.tsx` (and the breadcrumb in `App.tsx`) so non-emoji strings fall back to the `<NodeIcon>`. (commit: pending)

### PDF export: sections blank, words cut at page boundaries, no top margin
- **Symptom 1:** Multi-page PDFs were mostly blank — sections rendered at `opacity: 0` — with only sources/lede visible at the bottom of the last page.
- **Symptom 2:** Words were cut in half at page boundaries (equal-strip slicing with no awareness of content positions).
- **Symptom 3:** Content flushed against the top edge of every page with no margin.
- **Cause 1:** The original fix removed the `.appear` CSS class and set `style.opacity = '1'`. But CSS animations sit above inline styles in the cascade — `animation-fill-mode: both` freezing sections at `opacity: 0` overrides the inline `opacity: 1`. Class removal was also subject to lazy style recalculation in the html2canvas iframe.
- **Cause 2:** Multi-page slicing divided the canvas into equal strips with no regard for content boundaries.
- **Fix:** In `onclone`, set `style.animation = 'none'` first (kills the animation at the cascade level before `opacity: 1` is applied). For page breaks, measure block-level element tops from the DOM after layout mutations (`getBoundingClientRect` relative to workspace-inner), scale to canvas coords, and snap each page cut to the last safe break candidate ≤ the page boundary. Each page rendered with `y = MARGIN_TOP_PT` (40 pt) so content never flushes to the top edge. `apps/web/src/lib/sessionPdf.ts`. (commit: pending)

### Forced logout during Lambda deploy — refresh endpoint unavailable triggered signOut
- **Symptom:** Logged out 1–3 minutes after a new Amplify deployment, even with a valid session and working Cognito refresh token.
- **Cause:** During the Amplify Lambda switchover a 401 fires (stale id_token). `apiFetch` calls `sessionRefresher()` → `getSession()` → `/api/auth/session`, but that endpoint is momentarily unreachable (cold start / in-flight switchover) → `.catch(() => null)` → `fresh = null`. The code fell through to `unauthorizedHandler()` → `signOut()`, treating "refresh endpoint down" the same as "token genuinely dead".
- **Fix:** Track `refreshFailed = true` when `fresh === null` and skip `unauthorizedHandler()` in that case. `signOut()` is now only called when the refresh endpoint was reachable but returned the same expired token (genuine expiry). `apps/web/src/lib/api.ts`. (commit: pending)

### Forced logout mid-use — a single stale-token 401 hard-signed-out instead of refreshing
- **Symptom:** Logged out while **actively** using the app (not after sitting idle). Persisted even after the transient-refresh fix, and left **no `auth_refresh` telemetry** — because this logout path never touches the jwt-callback refresh.
- **Cause:** `apiFetch` called `unauthorizedHandler()` → `signOut()` on the **first** 401 that carried a token. The client's `id_token` comes from `useSession()`, which only updates on a session refetch; during active use an API call can fire in the brief window where the in-memory token has just expired (before the refetch swaps in the refreshed one). NestJS rejects it 401 → instant logout, with no refresh and no retry. Active users hit it more than idle ones (more API calls across the expiry boundary), so it felt like "kicked mid-use".
- **Fix:** On a 401 with a token, `apiFetch` now calls a registered session refresher — `getSession()`, which forces a `/api/auth/session` fetch → the jwt callback refreshes an expired token → returns the fresh one — and retries the request **once** with the new token. Only a still-401 retry, or no fresh token (genuine expiry), falls through to `signOut()`. Emits an `auth_401` PostHog event (`{ path, recovered }`) so the recovery rate is visible in admin. `apps/web/src/lib/api.ts`, `apps/web/src/components/App.tsx`; regression test in `e2e/tests/auth-gate.spec.ts`. (commit: pending)

### Mermaid flowcharts with unquoted parens in node labels / subgraph titles fell back to code instead of rendering
- **Symptom:** LLM-generated `graph`/`flowchart` diagrams whose node labels — e.g. `J{Issue Persists (2nd Time)?}` or `P[Knowledge Base Update (Wiki, Graphify, Mem Palace)]` — or subgraph titles — e.g. `subgraph Knowledge Base (Human & LLM)` — contained parentheses or other punctuation showed the raw code block instead of a rendered graph. Mindmaps with the same problem already had a rescue; flowcharts did not.
- **Cause:** In mermaid flowchart grammar `(` opens a node shape, so unquoted parens inside a `[...]`/`{...}` label (or a bare `subgraph` title) are a parse error (`Parse error … got 'PS'`). `renderMermaidSvg` only ran a sanitize-and-retry for `mindmap` sources, so flowcharts fell straight through to the `null` (code-block) fallback.
- **Fix:** Added `sanitizeFlowchart()` — a failure-gated retry that quotes the interior of each node shape (`[...]`, `(...)`, `{...}` and the double-delimiter variants) so punctuation is literal; a `\w` lookbehind restricts it to shapes attached to a node id, leaving edge labels (`-- Yes (1st Time) -->`) untouched. Bare `subgraph` titles with risky punctuation are wrapped in quotes too (`subgraph "Knowledge Base (Human & LLM)"`). It also **drops dangling/truncated edges** the LLM left mid-thought — `MR --> |Label|` with no target node, `MR --> |...`, or a bare trailing arrow — which are an unrecoverable parse error and can't be drawn anyway, so the rest of the diagram still renders (those edges are silently omitted). Wired into `renderMermaidSvg` for `graph`/`flowchart` sources, parallel to the mindmap path. Only runs after a real render failure, so valid diagrams are never rewritten; structurally-invalid diagrams (e.g. a hallucinated `sankey-beta`/flowchart hybrid) still fall back to code. `apps/web/src/components/Section.tsx`; regression: `e2e/tests/mermaid.spec.ts`. (commit: pending)

### Mind map node text from one card bled into an adjacent sibling card
- **Symptom:** A mind map node card showed two overlapping text strings — the correct title for that node and a partial title ("eamlined" / "ntext") from the adjacent sibling node bleeding in from the left.
- **Cause:** SVG `foreignObject` defaults to `overflow: hidden` per spec, but Safari/WebKit does not reliably honour this. The sibling node's label text (`.mm-label` with `word-break: break-word`) could overflow the declared 192×58 `foreignObject` bounds and paint into the 18px gap between siblings and into the next node's card area. Neither `.mm-fo` nor `.mm-card` had explicit `overflow: hidden` in CSS.
- **Fix:** Added `overflow: hidden` to `.mm-fo` in CSS and `overflow="hidden"` as an SVG attribute on the `<foreignObject>` element (belt-and-suspenders for WebKit); also added `overflow: hidden; width: 100%` to `.mm-card` so the HTML flex container is guaranteed to stay within its foreignObject bounds. `apps/web/src/app/globals.css`, `apps/web/src/components/MindMap.tsx`. (commit: pending)

### Mermaid syntax errors showed a bomb/error SVG instead of falling back to code block
- **Symptom:** Sections containing mermaid diagrams that the LLM generated with invalid syntax showed three bomb icons ("Syntax error in text — mermaid version 11.15.0") instead of gracefully falling back to the raw code block.
- **Cause:** mermaid v11 changed `render()` to resolve with an error SVG rather than rejecting on parse errors. The try/catch in `renderMermaidSvg` never fired, so the error SVG was injected into the DOM as if it were a valid diagram.
- **Fix:** Validate with `mermaid.parse(text)` before calling `render()`. `parse()` still throws on syntax errors in v11, so failures now correctly fall through to the sanitize-mindmap retry and then to `null` (code block fallback). `apps/web/src/components/Section.tsx`. (commit: pending)

### Admin LLM Spend defaulted to 30-day window instead of today
- **Symptom:** Opening the admin dashboard showed the LLM Spend chart pre-filtered to "30 days" — too broad to see today's cost at a glance.
- **Cause:** `useState('30d')` initial value in `AdminDashboard.tsx`; the fallback `RANGES[2]` also pointed at the 30-day entry.
- **Fix:** Changed initial state to `'today'` and fallback to `RANGES[0]`. `apps/web/src/components/admin/AdminDashboard.tsx`. (commit: pending)

### Section headings rendered with literal markdown `##`
- **Symptom:** Some section headings displayed their markdown hashes — e.g. `## Light reactions` instead of `Light reactions` (sometimes `###`, or a trailing ` ##`). The same leaked into "Go deeper" node titles on the mind map and into Notion exports.
- **Cause:** The LLM occasionally returns a heading with its ATX hashes intact in `section.heading`; the value was rendered verbatim in the `<h2>` and reused as-is for derived titles/queries and the Notion block/HTML/markdown export builders.
- **Fix:** `cleanHeading()` in `apps/web/src/lib/utils.ts` strips leading (`#`–`######`) and ATX-closing hashes while preserving legitimate internal/trailing `#` (`C#`, `F#`, `#hashtag`); applied at every display surface — `Section.tsx` `<h2>` + `sectionHeading`, `App.tsx` Go-deeper title/query/fromText, and the three `notion-clipboard.ts` export builders. Regression: `e2e/tests/heading-hashes.spec.ts`. (commit: pending)

### Intermittent forced login after ~1 hour (transient refresh failure logged users out)
- **Symptom:** Users were occasionally bounced to the login page ~1 hour after signing in. Not every time — it "just happened sometimes". 1h = the Cognito `IdTokenValidity` (60 min).
- **Cause:** `refreshIdToken` in `apps/web/src/auth.ts` swallowed **every** failure into `null`, and the `jwt` callback mapped `null` → `error: 'RefreshTokenExpired'`, which `App.tsx` turns into an immediate `signOut()`. So any *transient* failure at the refresh boundary (network blip, Cognito `TooManyRequestsException` from a refresh stampede across tabs/requests, Lambda cold-start timeout) nuked a session whose 30-day refresh token was still perfectly valid — there was no retry and no distinction between "refresh token genuinely dead" vs "momentary blip". A latent companion bug: the callback never persisted a rotated refresh token, so if the pool ever enables rotation the *next* refresh would reuse an invalidated token.
- **Fix:** `refreshIdToken` now returns a discriminated result (`ok` / `expired` / `transient`): only `NotAuthorizedException` / `InvalidParameterException` / `UserNotFoundException` are fatal → `RefreshTokenExpired`; everything else is transient and retried in-function (3 attempts, 200/400ms backoff — the id_token is still valid since refresh fires 60s early). On an exhausted-transient outcome the session is kept (no error) so the next refetch retries instead of logging out. A rotated refresh token is now persisted if Cognito returns one. `SessionProvider` gained `refetchInterval={4*60}` so the retry is proactive even if the tab never refocuses. Regression test runs the real `jwt` callback against a black-holed Cognito endpoint: `apps/web/src/auth.ts`, `apps/web/src/components/Providers.tsx`, `e2e/tests/auth-refresh.spec.ts` (+ `e2e/playwright.auth-refresh.config.ts`). (commit: pending)

### Web-search branch crashed ("object is not iterable") when a search errored → node never saved
- **Symptom:** Creating a branch with Web search on failed with "The AI request failed", and the node never appeared after refresh — it was never persisted. Looked like a vanishing/missing node (and sent us down pagination/viewport rabbit holes) but was actually a hard server-side crash on create. Intermittent — only when a web search itself errored.
- **Cause:** On a failed search, Anthropic returns the `web_search_tool_result` block with `content` as an **error object** (`{ type: 'web_search_tool_result_error', error_code: '…' }`), not the usual results array. `extractAnthropicSources` did `for (const item of (block.content ?? []))` — the `?? []` only guards null/undefined, so it iterated the error object and threw `object is not iterable (Symbol.iterator)`. That propagated out of `provider.complete()`, failed both attempts, and `friendlyLlmError` mapped the non-matching message to the generic "The AI request failed". The node was never created (`createNode` throws before `putNode`) — not a read/pagination/viewport issue.
- **Fix:** Skip any `web_search_tool_result` whose `content` is not an array (`if (!Array.isArray(block.content)) continue;`) so a failed search yields no sources instead of crashing the branch. `apps/api/src/llm/citations.ts`; regression test in `apps/api/src/llm/llm.service.spec.ts`.

### Nodes rendered after creation but vanished on refresh (unpaginated 1MB DynamoDB read)
- **Symptom:** A newly created branch (esp. a large Verbose / web-search answer) showed correctly right after creation, then disappeared after a page refresh. Worse on heavier sessions.
- **Cause:** `DynamoRepository.queryNodes` (and `queryAnnotations`/`queryHighlights`/`listSessionMeta`) called Dynamoose `.query(...).exec()` without `.all()`. A DynamoDB Query returns at most **1MB per call** and Dynamoose's `.exec()` does NOT auto-paginate — it returns only the first page. `createNode` persists via `putNode` before returning (so the POST shows the node), but once a session's `NODE#` items exceed 1MB the load query silently drops the tail. With ascending ULID sort keys, the newest node is in the dropped tail → vanishes on refresh. Latent for ages; surfaced once the LB/nginx timeout fix let large Opus+Verbose+Web answers actually complete and push sessions over 1MB.
- **Fix:** Add `.all()` (the repo's existing pagination idiom, already used for the admin scans) to `queryNodes`, `queryAnnotations`, `queryHighlights`, and `listSessionMeta` so all pages are fetched. `listUsageEvents` is intentionally `.limit()`-bounded and left as-is. Regression test asserts `queryNodes` calls `.all()`. `apps/api/src/dynamo/dynamo.repository.ts`, `dynamo.repository.spec.ts`.

### Slow web-search branches (Opus + Verbose + Web) timed out at 60s → blank/504
- **Symptom:** After the pause_turn fix, a heavy web-search branch (Opus + Verbose + Web) no longer showed "unreadable" but instead hung and came back blank / errored. The same call without web search worked.
- **Cause:** Branch calls are non-streaming (ADR-0009), so the client holds one idle HTTP connection for the whole LLM call. Two 60s walls sat in front of the API: the Classic LB **idle timeout (60s)** and the EB nginx **`proxy_read_timeout` (60s default on AL2023 Docker)**. Pre-fix, a long web search failed instantly via pause_turn (< 60s); post-fix the now-complete multi-round-trip flow runs past 60s, so the proxy/LB severs the connection. Compounded by the deploy shipping only a bare `Dockerrun.aws.json` source bundle — which silently ignores `.platform/` nginx hooks — so the proxy timeout couldn't be raised from the repo.
- **Fix:** Raise the Classic LB idle timeout 60→300s (`elb modify-load-balancer-attributes`); add `apps/api/.platform/nginx/conf.d/timeouts.conf` (`proxy_read_timeout`/`proxy_send_timeout` 300s); and change `buildspec.yml` to ship a **zip** source bundle (`Dockerrun.aws.json` + `.platform/`) so EB actually applies the nginx hook. 300s matches the answer-length ceiling. `apps/api/.platform/nginx/conf.d/timeouts.conf`, `apps/api/buildspec.yml`, LB attribute.

### Web-search branches failed with "The AI returned an unreadable answer" (Anthropic pause_turn)
- **Symptom:** A branch with **Web search on** (e.g. Verbose + Opus + Web) failed with the red "Sorry — The AI returned an unreadable answer", and Retry re-failed identically. The same query without web search worked. Distinct from the earlier truncation bug — this showed "unreadable", not the "cut off" message.
- **Cause:** When a web search runs long, Anthropic returns `stop_reason: 'pause_turn'` with only the *partial* assistant turn (the `server_tool_use` / `web_search_tool_result` blocks, no final JSON answer) and expects the partial content fed back to continue the turn. `AnthropicProvider.complete` made a **single** `messages.create` call and never handled `pause_turn`: `truncated` was false (stop_reason ≠ `max_tokens`), `rawText` held no JSON, `parseJson` threw a `JSON.parse` error, and `friendlyLlmError`'s `/json|parse/` branch mapped it to "unreadable answer". Deterministic, so Retry failed the same way.
- **Fix:** Loop in `AnthropicProvider.complete` while `stop_reason === 'pause_turn'` — append the returned assistant content to `messages` and call again (keeping `tools`), accumulating text blocks, sources, and token usage, capped at `MAX_TURNS = 5`. Non-web-search calls are unaffected (the loop runs once). `apps/api/src/llm/providers/anthropic.provider.ts`; regression test in `apps/api/src/llm/llm.service.spec.ts`.

### Notion export failed on large pages (e.g. "Context engineering for LLMs")
- **Symptom:** "Save to Notion" produced no working link for large sessions — the push failed and the button showed the error state. Small pages exported fine.
- **Cause:** Notion rejects any `rich_text` element whose `text.content` exceeds **2000 chars**. `notion-clipboard.ts` never chunked content: `mdToBlocks` joins consecutive lines into one paragraph (`paraLines.join(' ')`), code blocks pass the whole fenced body as one rich-text, and the Mermaid diagram for a big map is one long string. Large pages overran 2000 on at least one block, Notion 400'd `pages.create`/`append`, `pushPage` threw `BadGatewayException`, and no URL was returned.
- **Fix:** Add `capLongText` — a recursive pass (run on every block before `splitBlocks`) that splits any over-2000-char rich-text content into multiple rich-text elements (seamless in Notion), covering paragraphs, code, quotes, list items, headings, table cells, and toggle children. `apps/web/src/lib/notion-clipboard.ts`.

### Large/Verbose branch answers failed with "The AI returned an unreadable answer"
- **Symptom:** A "Go Deeper"/"Ask AI" branch — especially with **Verbose** style (and worse with Web search) — failed with the red "Sorry — The AI returned an unreadable answer", and Retry failed identically. Reproduced across different models (Opus, etc.), so it looked model-agnostic.
- **Cause:** Branch calls ran with a fixed `max_tokens: 2048` (the *output* cap). A thorough verbose answer wrapped in JSON overran 2048, the response was truncated mid-string, `parseJson` threw, and `friendlyLlmError` mapped the `/json|parse/` failure to "unreadable answer". The 2048 cap is model-independent, hence the "two different models both failed" symptom. The internal retry re-ran at the same 2048 cap → deterministic re-failure.
- **Fix:** Introduce a tiered **Output Budget** for branch calls (`outputBudget` in `models.ts`): authed Verbose 8192 / authed Sectioned 4096 / Guest-Trial 2048; 16384 is the non-streaming ceiling. Providers now report `truncated` (`stop_reason: 'max_tokens'` / Gemini `MAX_TOKENS`); a Cut-Off surfaces as a distinct `422 { code: 'OUTPUT_TRUNCATED' }` ("the answer was cut off — it hit the length limit") instead of "unreadable", and is **not** retried internally. Frontend: an authed user can Retry a Cut-Off, which re-runs with the budget doubled (`boost`, clamped to 16384); a Guest gets the clear message but no Retry (same-budget retry would only truncate again). Branch path stays non-streaming (ADR-0009). `apps/api/src/llm/{models.ts,llm.service.ts,providers/*}`, `nodes.service.ts`, `create-node.dto.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/components/App.tsx`, `apps/web/src/lib/types.ts`.

### Anonymous trial endpoint accepted unbounded `sectionCount` (cost hole) and had no rate limiting
- **Symptom:** `POST /share` (public, no auth) fired a Sonnet stream billed to the house account with whatever `sectionCount` the body carried — `{ query, sectionCount: 1000 }` in a loop could drain real money. No per-IP limit existed on any endpoint.
- **Cause:** `CreateSessionDto.sectionCount` had `@IsOptional()` but no range validation (the branch DTO was clamped 4–8; the root DTO was missed). No ThrottlerModule or custom guard was ever configured.
- **Fix:** Clamp `sectionCount` (`@IsInt @Min(1) @Max(8)`) in `create-session.dto.ts`; add `@nestjs/throttler` (global 100/min/IP; `POST /share` 5/hour, `POST /share/:token/nodes` 30/hour, `GET /topics` 10/min); add a cross-instance daily trial budget — a `TRIAL#<yyyy-mm-dd>` DynamoDB counter incremented in `billUsage(isTrial)` and checked via `UsersService.checkTrialBudget()` (429 once `TRIAL_DAILY_BUDGET_USD`, default $5, is spent). The budget is the backstop the per-instance throttler can't provide against distributed bots.

### Error banner was a dead end: doubled "Try again.. Try again.", no retry, generic message
- **Symptom:** A failed branch/root LLM call showed "Sorry — Failed to load. Try again.. Try again." — static text, nothing clickable; the only recovery was re-invoking the action from the parent. A failed root query silently dumped the user back to Landing. Real failure reasons (model overloaded, rate-limited) never reached the UI; SSE `error` events were parsed but ignored entirely (node stuck loading).
- **Cause:** The banner rendered `Sorry — {active.error}. Try again.` while the catch blocks already set `error = 'Failed to load. Try again.'` (hence the doubling). No retry context was kept. `createSessionStream`/`createTrialSessionStream` forwarded `{type:'error'}` to a handler that had no case for it. Backend threw `LLM call failed: <raw provider message>` (leak) and SSE catch blocks sent raw `err.message`.
- **Fix:** Backend maps provider failures through `friendlyLlmError()` (llm.service.ts) and both SSE catch blocks send `{ message, status }` sanitized. Frontend: `extractErrorMessage` pulls the NestJS `message` into `ApiError`; the shared `readSseStream` throws `ApiError` on in-band `error` events; catch blocks store `RetryInfo` keyed by the failed node id and the banner renders a working **Retry** button (`retryNode` re-fires the call reusing the same node id; failed root queries keep the workspace + Retry instead of bouncing to Landing). The hardcoded `. Try again.` suffix is gone. `apps/web/src/components/App.tsx`, `apps/web/src/lib/api.ts`.

### Guests hitting the trial cap saw "Out of credit — open Billing to recharge"
- **Symptom:** A guest branching past the 5-node trial cap (402) was told to open Billing — which guests don't have — and users read the wall as "you can only go one level deep".
- **Cause:** The 402 handler had a single authed-user message for all callers.
- **Fix:** `nodeErrorDisplay()` keys the copy on guest-ness ("Trial limit reached — log in to keep exploring") and the banner shows a **Log in** button (`setForceLogin(true)`) for unauthenticated 402/429 instead of Retry. `apps/web/src/components/App.tsx`.

### Dark mode: white LoginPage, white TweaksPanel dialog inputs, glaring highlight pastels
- **Symptom:** In dark mode the login screen stayed a white flashbang, the How-to/Support dialog inputs were white-on-white, and text highlights kept their solid light pastels.
- **Cause:** LoginPage predates the theme system — `#ffffff`/`#0a0a0a`/`#555555`/`rgba(10,10,10,…)` hardcoded in inline styles and SVG `setAttribute` calls. TweaksPanel overlays hardcoded white surfaces. The dark `::highlight()` override only forced text black, never dimming the pastel backgrounds.
- **Fix:** LoginPage resolves a palette from `data-theme` (`lpPal()`) used by both JSX styles and the SVG graph (the "arrived" overlay intentionally stays white — the mark is dark-on-transparent). TweaksPanel overlays now use `var(--paper)`/`var(--ink)`/`var(--line-strong)` etc. Dark highlights use translucent washes of each pastel (page ink stays readable) with brightened fg variants for colour combos. `apps/web/src/components/LoginPage.tsx`, `TweaksPanel.tsx`, `globals.css`.

### `dynamo.repository.spec.ts` failed to compile its testing module (18 tests)
- **Symptom:** The whole repository suite errored at `createTestingModule().compile()`.
- **Cause:** `BLOG_SUBMISSION_MODEL`/`BLOG_VIEW_MODEL` were added to the repository constructor without updating the spec's providers (pre-existing); `TRIAL_SPEND_MODEL` joined the list with the trial-budget work.
- **Fix:** Provide mocks for all three models in the spec. `apps/api/src/dynamo/dynamo.repository.spec.ts`.

### Saved highlights didn't paint until the first interaction on a cold session load
- **Symptom:** Opening a session that already has highlights showed the prose un-highlighted on first paint; the marks only appeared after the user selected some text or switched nodes. The data was correct — purely a render-timing miss.
- **Cause:** `Section` is code-split (`next/dynamic`, `ssr:false`). The `useLayoutEffect` in `App.tsx` that paints highlights via the CSS Custom Highlight API runs once its deps (`persistentHl`/`activeId`/`hlMenu`) settle, but on a cold load that happens *before* the `Section` chunk has mounted any `.section-body` — so `querySelector` finds nothing and nothing re-runs the effect when the chunk later mounts.
- **Fix:** Add a `sectionReady` state that flips once `import('./Section')` resolves, and include it in the highlight effect's dependency array so the effect re-runs after the section DOM is committed. `apps/web/src/components/App.tsx`. Regression-covered by `e2e/tests/highlights.spec.ts` ("persisted highlights paint on cold load without any interaction").

### Dev: JWTSessionError "no matching decryption secret" on every page load
- **Symptom:** In local dev, the console spammed `[auth][error] JWTSessionError … no matching decryption secret` on each request and the user appeared logged out, even with a valid fork.ai login.
- **Cause:** Cookies on `localhost` are shared across **ports**. Another next-auth v5 app (`p2p-lending-tracker` on `:3001`) writes the default `authjs.session-token` cookie with its own secret; fork.ai (any port) then tries to decrypt that foreign cookie with `NEXTAUTH_SECRET` and fails. Whichever app was logged into last breaks the other.
- **Fix:** Namespace fork.ai's session cookie in dev only — `cookies: { sessionToken: { name: 'forkai.session-token' } }` spread into the NextAuth config under `NODE_ENV !== 'production'`. Prod keeps the default name so live forkai.in sessions aren't invalidated. `apps/web/src/auth.ts`.

### Ask AI node creation failed for long questions (> 500 chars)
- **Symptom:** Asking a question longer than 500 characters in the Ask AI popup left the branch node stuck in an error state ("Failed to load. Try again.").
- **Cause:** `CreateNodeDto.query` carried `@MaxLength(500)` — the same constraint that was removed from the root-query DTO in commit `6d50b05`. NestJS returned a 400 and the frontend error handler could only show a generic message.
- **Fix:** Remove `@MaxLength(500)` from `CreateNodeDto.query`. The node title is generated by the LLM (not derived from `query`), so no truncation helper is needed. `apps/api/src/nodes/dto/create-node.dto.ts`.

### History (and login/research) broken on www.forkai.in
- **Symptom:** On `www.forkai.in` the History page showed nothing and login/research/blog actions silently failed, while `forkai.in` worked fine.
- **Cause:** Both the apex (`forkai.in`) and `www.forkai.in` resolve to the same Amplify CloudFront distribution and serve the app, but the API's `CORS_ORIGIN` on Elastic Beanstalk only allows `https://forkai.in`. From a www page the browser sends `Origin: https://www.forkai.in`; the API returns no matching `Access-Control-Allow-Origin`, so every client-side call (`GET /sessions`, etc.) is blocked. Static pages still render (server-side fetch, no CORS), so the site looked "up".
- **Fix:** Canonicalise to the apex — a host-based 308 redirect in `next.config.ts` (`redirects()` with `has: host == www.forkai.in` → `https://forkai.in/:path*`). www requests bounce to the apex where CORS is satisfied; also removes the duplicate-URL/SEO concern. `apps/web/next.config.ts`.

### Ask AI panel went blank when the loading node was opened mid-request
- **Symptom:** After "Ask AI", clicking the new node chip *while it was still loading* left the right-side section panel white once the LLM response landed — only a second click on the node filled it in.
- **Cause:** `askFromHighlight` adds an optimistic node under a temp id (`tempId`) and, on response, swaps it for the real backend node (`delete next[tempId]; next[realNode.id] = realNode`). Unlike "Go deeper" it deliberately doesn't auto-select the new node, so it never repointed `activeId`. If the user had manually opened the loading node, `activeId` was still `tempId`; after the swap `active = nodes[activeId]` became `undefined` → the `{active && (…)}` panel rendered nothing.
- **Fix:** After the id swap, follow it only when the user was on the loading node: `setActiveId(prev => (prev === tempId ? realNode.id : prev))`. Preserves the intended "stay on the current node" behaviour otherwise. `apps/web/src/components/App.tsx`. Commit `1c647ae`.

### Mobile single-tap selected two sentences when web search was ON
- **Symptom:** On mobile, a single tap (which selects the sentence under the finger) selected two sentences fused together — but only with web search ON.
- **Cause:** Web-search citations render as a `[N]` superscript glued onto the prose with no separating space (`…one.<sup>[1]</sup> two`). `selectSentenceAtPoint` flattens the block with `textContent`, pulling `[1]` into the string (`"one.[1] two"`). The sentence-boundary regex `/[.!?]['"'’”]?\s+/` requires whitespace immediately after the punctuation, so `.[1]` never matched — the boundary was skipped and the tap ran on to the next real boundary. With web search OFF there are no markers, so the period is followed by a space and it worked.
- **Fix:** Boundary regex now captures punctuation separately from the citation+whitespace tail (`/([.!?]['"'’”]?)((?:\[\d+\])*\s+)/`); the sentence end is `m.index + m[1].length`, so the `[N]` marker is detected as a boundary and excluded from the selected text. No-citation behaviour is unchanged. `apps/web/src/components/Section.tsx`.

### History card stuck on placeholder title/emoji when tab closed mid-stream
- **Symptom:** Sessions closed before the root stream finished showed a truncated query and no emoji on the History page, even though opening the session looked correct.
- **Cause:** The History list reads `SessionMetaItem`. During streaming, `title`/`emoji`/`lede` were written to `SessionMeta` via a full-replace `putSessionMeta` **only at `done`**; the in-loop incremental persistence touched the `NodeItem` only. The placeholder (`title = query.slice(0,60)`, empty emoji) from the up-front write was the last thing the History row reliably saw.
- **Fix:** Keep the up-front `putSessionMeta` at session creation (placeholder → session stays accessible if closed mid-stream), and at `done` swap the full-replace for a partial **`updateSessionMeta(sub, sessionId, { title, emoji, lede })`** so only those fields are patched. The server loop runs to completion after a disconnect, so a tab closed mid-stream still gets the correct title/emoji once `done` lands. Extended `updateSessionMeta`'s allowlist with `emoji`/`lede`. `apps/api/src/sessions/sessions.service.ts`, `apps/api/src/dynamo/dynamo.repository.ts`.

### LLM spend & revenue showed $0 on the admin dashboard
- **Symptom:** Admin platform metrics reported `$0` LLM spend and `$0` revenue despite real usage/payments.
- **Cause:** `aggregatePlatformMetrics` scanned the whole table via `userMetaModel`, but Dynamoose `saveUnknown: false` strips fields not declared on the scanning model — `costUsd`/`amountUsd` came back `undefined`. (`creditUsd`, which *is* on the schema, worked, masking the bug.)
- **Fix:** Read each numeric field through the model that declares it — three parallel scans (`userMetaModel`, `usageEventModel`, `paymentModel`). Never read an entity's fields off a scan of another model. Commit `1a48619`.

### Usage events persisted with no `model` → all spend mis-attributed to Claude
- **Symptom:** Every usage row landed model-less; per-provider cost attribution was wrong.
- **Cause:** `billUsage` set `model` and the item type declared it, but `UsageEventSchema` didn't list the field — `saveUnknown: false` dropped it silently on write.
- **Fix:** Declare `model: { type: String, required: false }` on `UsageEventSchema`. Commit `cf96d21`.

### Razorpay top-up never credited the user
- **Symptom:** Successful payments didn't increase the user's credit; webhook retry couldn't rescue it.
- **Cause:** `addCredit` used the lowercase `$add` operator. Dynamoose v4 only recognises uppercase `$ADD`/`$SET`/`$REMOVE`/`$DELETE` — lowercase is silently dropped, so the credit was never written. The sibling `PaymentItem` write still succeeded, marking the payment done in the idempotency log.
- **Fix:** Use `$ADD`; validate Razorpay; sequential awaits. Commit `c88a67a`.

### `POST /sessions/:id/nodes` returned 500 (branch creation broken)
- **Symptom:** Creating any branch node 500'd.
- **Cause:** Same Dynamoose operator-case footgun — `deductCredit` used `$add` → `ValidationException: ExpressionAttributeValues must not be empty`.
- **Fix:** `$add` → `$ADD`. Commit `2a2d1b6`.

### Clearing `shareToken` / `notionPageUrl` 500'd the request
- **Symptom:** Revoking a share token or invalidating a stale Notion export threw `TypeMismatch: Expected <field> to be of type string, instead found type null`.
- **Cause:** Dynamoose v4 rejects `null` for typed `String` fields even when `required: false`.
- **Fix:** `DynamoRepository.updateSessionMeta` translates `null` values into a `$REMOVE` expression so the attribute is dropped. Any future clearable field must rely on this.

### Users silently logged out every hour
- **Symptom:** Login worked, but the session dropped at the 60-minute `id_token` expiry boundary.
- **Cause:** `REFRESH_TOKEN_AUTH` validates `SECRET_HASH` against the canonical UUID username, but the refresh path computed the hash from the email. It failed with `NotAuthorizedException`, which `refreshIdToken` swallowed into `RefreshTokenExpired` → forced sign-out.
- **Fix:** `authorize()` stores `cognito:username` on the JWT; refresh uses `secretHash(token.username)`. The catch now logs the Cognito error. Commit `6919a19`.

### Refreshing during the root-query stream dropped the user to Landing
- **Symptom:** A page refresh *while* the first answer was streaming lost the session.
- **Cause:** The session was written to the DB only at `done`, so a mid-stream refresh had nothing to restore.
- **Fix:** Persist-first — write the loading `NodeItem` + `SessionMetaItem` and emit an `init` SSE event **before** consuming the stream. Commit `e3b2c91`. See CLAUDE.md → "Root-query streaming".

### Stale `localStorage` session needed a manual cache-clear to recover
- **Symptom:** A stale stored session id wedged the app; users had to clear cache.
- **Fix:** Self-heal the stale restore path instead of hanging. Commit `defeb77`.

### Model change in Tweaks didn't apply to the next branch/query
- **Symptom:** Switching the branch model had no effect until reload.
- **Cause:** Branch/query callbacks captured a stale `tweaks` closure.
- **Fix:** Read live tweaks via a ref. Commit `44515f2`.

### Login animation lost after logout → reload → login
- **Cause:** `(showLogin && !loadingRoot)` gate — `loadingRoot` re-initialised `true` from a stored session, unmounting `LoginPage` mid-animation.
- **Fix:** Gate on `showLogin` alone; also fixed a `loadSession` TDZ in the hook order. Commit `200a792`. See CLAUDE.md → "Session persistence" / "Hook ordering caveat".

### Guest accidentally bounced to login on an authed endpoint
- **Cause:** `apiFetch` fired the 401 handler even when no token was sent.
- **Fix:** Gate on `&& idToken` so the handler only fires for *expired* sessions, never missing ones.

### Amplify SSR: server secrets `undefined` in route handlers
- **Symptom:** `process.env.COGNITO_CLIENT_SECRET` was `undefined` inside route handlers despite being set in the Amplify console.
- **Cause:** Amplify WEB_COMPUTE Lambda doesn't forward non-`NEXT_PUBLIC_` branch env vars to the SSR Lambda at runtime.
- **Fix:** Inline server secrets via the `env` block in `next.config.ts` (build-time DefinePlugin). Also `trustHost: true` + explicit `secret` for next-auth v5. Commits `a301c08`, `19ea737`.

### Safari: highlight layer not repainting / stale `temp-hl`
- **Cause:** Safari's CSS Custom Highlight API doesn't schedule a repaint on `CSS.highlights.delete`, and won't repaint a stale layer mutated after a frame is painted.
- **Fix:** Clear `temp-hl` by `set`-ting an empty `Highlight`; clear `hlMenu` on `mousedown` so the layout effect empties `CSS.highlights` before paint. Commits `f90395c`, `0cdbd1f`.

### Notion export rejected toggle-heading children / broke tables & lists
- **Cause:** Notion's `pages.create` rejects inline `children` on toggle headings; tables need rows under `table.children`.
- **Fix:** `splitBlocks` flattens the tree (server depth-first appends), leaving `table.children` inline. Commit `1a608ca`. See `docs/notion-export.md`.

### Startup crash when Razorpay keys absent
- **Fix:** Lazy validation so a missing key never crashes boot; added a health endpoint. Commit `5d926ab`.

### Referral registered before the user existed (race)
- **Fix:** Register the referral after `getMe`. Commit `ff56b7e`.
