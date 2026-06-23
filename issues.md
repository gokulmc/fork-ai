# Issues & Bug-Fix Log

A running log of bugs found and fixed in fork.ai, newest first. Each entry records the **symptom**, the **root cause**, and the **fix** so a regression is recognisable later.

> **Required step:** update this file in the **same commit** as any bug fix. See [CLAUDE.md → "Issue log (issues.md)"](CLAUDE.md). Format: one `###` entry per fix — Symptom / Cause / Fix, plus the commit SHA once committed.

---

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
