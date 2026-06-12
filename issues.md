# Issues & Bug-Fix Log

A running log of bugs found and fixed in fork.ai, newest first. Each entry records the **symptom**, the **root cause**, and the **fix** so a regression is recognisable later.

> **Required step:** update this file in the **same commit** as any bug fix. See [CLAUDE.md → "Issue log (issues.md)"](CLAUDE.md). Format: one `###` entry per fix — Symptom / Cause / Fix, plus the commit SHA once committed.

---

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
