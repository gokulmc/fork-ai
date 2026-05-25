# test-plan.md — Share feature

Manual test plan for the session-sharing work. Covers every scenario the share PRs introduce or change. Each scenario lists preconditions, steps, and the expected result. Bugs landed in `version2` are called out under "Regressions to guard against."

Setup for every test below:
- API running on `:3000` (`npm run dev:api`)
- Web running on `:3001` (`npm run dev:web`)
- DynamoDB Local or AWS reachable with table `forkai-main`
- Two distinct browsers / profiles available for host/guest scenarios (e.g. Chrome + Safari, or normal + incognito). Same browser will not work — next-auth cookies collide.

---

## 1. Share lifecycle (host side)

### 1.1 Generate share token (first time)
**Pre:** Host logged in. A session with ≥1 node is open. Share button shows `Share`.
**Steps:** Click `Share`.
**Expect:**
- Network: `POST /sessions/:sessionId/share` → 201 with `{ token: "..." }`.
- Button momentarily shows `Copied!`, then settles on `Shared` with an adjacent `LinkOff` icon.
- Clipboard contains a URL of the form `http://localhost:3001/?sk=<token>`.
- DynamoDB: `SessionMeta` item has `shareToken` set; new item exists with `PK = SHARE#<token>`.

### 1.2 Copy existing link
**Pre:** Token already generated; button shows `Shared`.
**Steps:** Click `Shared`.
**Expect:**
- No network call (no new token minted).
- Button flips to `Copied!` for ~1.5s, then back to `Shared`.
- Clipboard contains the same URL as 1.1.

### 1.3 Revoke share
**Pre:** Token active; button shows `Shared` with `LinkOff` icon.
**Steps:** Click the `LinkOff` icon.
**Expect:**
- Network: `DELETE /sessions/:sessionId/share` → **204** (NOT 500).
- Button reverts to `Share` (`Link` icon only); `LinkOff` icon disappears.
- DynamoDB: `SessionMeta.shareToken` is absent; `SHARE#<token>` item is deleted.
- **Regression guard:** verify API logs do NOT contain `TypeMismatch: Expected shareToken to be of type string, instead found type null` — the `null` → `$REMOVE` translation must hold.

### 1.4 Share status survives reload
**Pre:** Token active.
**Steps:** Hard-reload the host's workspace.
**Expect:**
- On mount, `GET /sessions/:sessionId/share` is called.
- Response is `{ active: true, token: "..." }`.
- Share button initialises directly to `Shared` state (no flicker through `Share`).

### 1.5 Regenerate token (revoke + create)
**Pre:** Token T1 is active.
**Steps:** Revoke. Then click `Share` again.
**Expect:**
- A new token T2 is minted, T2 ≠ T1.
- DynamoDB: `SHARE#T1` deleted, `SHARE#T2` created, `SessionMeta.shareToken = T2`.
- Guest opening the old URL with `?sk=T1` is rejected (see 5.5).

### 1.6 Multiple sessions, independent tokens
**Pre:** Host has Sessions A and B. Token generated for A only.
**Steps:** Open Session B; verify Share button shows `Share` (not `Shared`). Generate a token for B.
**Expect:** A and B each have distinct, independent share tokens. Revoking one does not affect the other.

---

## 2. Guest loads a shared session

### 2.1 Cold open (incognito / second browser)
**Pre:** Host generated a token; clipboard URL = `?sk=<token>`.
**Steps:** Paste the URL into a fresh incognito window, hit Enter.
**Expect:**
- **No login page is shown.** Guest goes directly to the shared session workspace.
- Network: `GET /share/:token` → 200 with the full session payload (nodes, annotations, highlights, notionPageUrl).
- All nodes from the host's tree are visible in the mind map and workspace.
- **The `?sk=` token remains in the URL** — by design, the token is the share link, so keeping it visible is not a leak.
- **Regression guard:** In dev mode (React StrictMode → double-mount), confirm that the token survives the second mount. Symptom of regression: first mount shows workspace, second mount kicks to login page. Must NOT happen.

### 2.2 Refresh while in guest session
**Pre:** Guest is in 2.1 state; URL still has `?sk=<token>`.
**Steps:** Hard-reload the page.
**Expect:** Guest stays in the session — the URL still carries the token, so `guestToken` re-initialises correctly and the session reloads via `GET /share/:token`. The login gate must NOT fire. (This is the regression behaviour that was reported and fixed — earlier code stripped `?sk=` on mount, causing refresh to bounce to login.)

### 2.3 Invalid token
**Pre:** Open `?sk=garbage-not-a-real-token`.
**Expect:**
- `GET /share/:token` → 403.
- The catch path sets `guestToken = null`. With no `?sk=` and no auth, the login gate fires — guest sees login page.

### 2.4 Revoked token
**Pre:** Host generated a token, then revoked. Guest opens the old URL.
**Expect:** Same as 2.3 — 403, then login page.

### 2.5 Already-logged-in user opens a share URL
**Pre:** User is logged in in this browser. Opens `?sk=<token>` for a session owned by someone else.
**Expect:**
- `POST /share/:token/claim` fires (NOT `GET /share/:token`).
- A SessionMeta item is created under the logged-in user's `sub`, pointing at the same session content.
- The user lands in the workspace via the **authenticated** path (`loadSession`), not guest mode.
- `guestToken` is cleared; URL is cleaned.
- The session appears in the user's History.

---

## 3. Guest interactions inside a shared session

### 3.1 Highlight text
**Pre:** Guest workspace open.
**Steps:** Select text inside a section; pick a colour from the highlight menu.
**Expect:**
- Network: `POST /share/:token/highlights` → 201.
- Highlight renders immediately (optimistic UI).
- DynamoDB: new `HL#<id>` item under the host's session.
- Host sees the same highlight on their next session reload.

### 3.2 Change highlight colour
**Steps:** Click an existing highlight, pick a different colour.
**Expect:** `PATCH /share/:token/highlights/:hlId` → 204. Colour updates in place.

### 3.3 Delete highlight
**Steps:** Trigger highlight delete from the menu / drawer.
**Expect:** `DELETE /share/:token/highlights/:hlId` → 204. Highlight disappears.

### 3.4 "Go Deeper" branch (Guest)
**Pre:** Guest workspace open. **This was blocked entirely before the fix — verify it now works.**
**Steps:** Click "Go deeper" on a section.
**Expect:**
- Optimistic loading node added immediately.
- Network: `POST /share/:token/nodes` with `kind: 'DEEPER'`, parent + section context.
- 200 with the new node payload.
- Loading node is replaced with the real node; guest's mind map shows the new branch.
- **No redirect to login.**
- Host's history shows the same new node (refresh the host's workspace to confirm).

### 3.5 "Ask AI" branch (Guest)
**Pre:** Guest highlights text; the Follow-Up popup appears with a question input.
**Steps:** Type a question; submit.
**Expect:**
- Optimistic loading node added.
- Network: `POST /share/:token/nodes` with `kind: 'ASK'`, highlightText, query.
- 200 with the new node; loading node replaced.
- **No redirect to login.** (This is the explicit bug fixed in the latest PR.)
- Host's history shows the new node.

### 3.6 Notion-export invalidation (cross-cutting)
**Pre:** Host has previously pushed the session to Notion (`SessionMeta.notionPageUrl` is set).
**Steps:** Guest creates a new node via 3.4 or 3.5.
**Expect:**
- Backend automatically clears `SessionMeta.notionPageUrl` inside `NodesService.createNode` (works for both `/sessions/:id/nodes` and `/share/:token/nodes` paths).
- On the host's next session reload, the "Open in Notion ↗" button is gone.
- **Regression guard:** verify API logs do NOT contain `TypeMismatch: Expected notionPageUrl to be of type string, instead found type null`.

### 3.7 Notion picker prompts login for guests
**Pre:** Guest workspace open. The mind-map's "Save to Notion" button is visible.
**Steps:** Click "Save to Notion".
**Expect:**
- LoginPage renders immediately (via `forceLogin` flag).
- `guestToken` is preserved in state and URL.
- After successful sign-in, the claim effect runs, `guestToken` is cleared, the session reloads under the new authed identity, and the user can then use Save to Notion normally.

### 3.8 "Login to Save" button (guest-only) + History hidden
**Pre:** Guest workspace open.
**Expect (UI state):**
- `History` button is **NOT** rendered (gated on `idToken`).
- `Login to Save` button is rendered in the top toolbar where History would normally appear (gated on `guestToken && !idToken`).
- `ShareButton` is NOT rendered (sharing is host-only — gated on `sessionId && idToken`).
**Steps:** Click "Login to Save".
**Expect:**
- LoginPage renders (same `forceLogin` mechanism as 3.7).
- After sign-in completes (1500ms animation), workspace renders with the now-claimed session in the authed user's History.
- The button disappears; History (and ShareButton) appear in its place.

### 3.9 Login animation survives the claim flow
**Pre:** Guest in session; clicks "Login to Save" or "Save to Notion"; submits credentials.
**Expect:** The 1500ms LoginPage graph animation plays through to completion — the page does NOT unmount the instant `status` flips to `authenticated`. The `forceLogin` flag stays true until `onEnter()` fires. (Regression guard: matches the rule in root `CLAUDE.md` — do not gate on `!loadingRoot` or on `status === 'authenticated'` directly, because both unmount LoginPage mid-animation.)

### 3.10 Annotations create / delete (host-only behaviour)
**Pre:** Guest workspace open.
**Steps:** Try to create a callout / note from a highlight.
**Expect:** Per the glossary (`CONTEXT.md` — Guest), annotations are an authenticated-only capability. Guest UI should not surface the "save as note/callout" action, or should prompt login.

---

## 4. Guest → authenticated transitions

### 4.1 Guest logs in mid-session (claim flow)
**Pre:** Guest in 2.1 state. Click "Login" (or a sign-in link).
**Steps:** Complete Cognito login.
**Expect:**
- On return, `POST /share/:token/claim` fires (with the now-present `idToken`).
- `guestToken` cleared; session reloaded via authenticated `loadSession`.
- Session appears in the user's History.
- All highlights / nodes created during guest mode are preserved (they live on the original session, not on the guest).

### 4.2 Logged-in user re-opens the same shared session
**Pre:** 4.1 just completed. User reopens the same `?sk=<token>` URL later.
**Expect:** `claimSession` is a no-op for an already-claimed session — it returns the existing summary. No duplicate History entry.

### 4.3 Owner opens their own share URL
**Pre:** Host generates a token, copies the URL, opens it in the same logged-in session.
**Expect:** `claimSession` runs but the SessionMeta under the host's `sub` already exists. Returns existing meta. No duplicate.

---

## 5. Auth boundary (defensive layer)

### 5.1 Guest accidentally hits an authed endpoint
**Pre:** Guest workspace open.
**Steps:** Manually trigger any frontend code path that calls `apiFetch` with `idToken = ''` (e.g. via React DevTools mutating state, or by adding a temporary debug button). Easy programmatic check: in the browser console while on the guest workspace, run:
```js
fetch('http://localhost:3000/sessions/' + window.location.hash.slice(1).split('/')[0], { headers: { Authorization: 'Bearer ' } })
```
**Expect:**
- 401 from the API.
- **`signOut()` is NOT called.** Guest stays in the workspace.
- This is enforced by `if (res.status === 401 && idToken) unauthorizedHandler?.()` in `apps/web/src/lib/api.ts` — without the `&& idToken` gate, this would redirect the guest to login.

### 5.2 Authenticated user with expired id_token (existing behaviour preserved)
**Pre:** Logged-in user; manually invalidate `idToken` (overwrite session storage, or wait > 1h with refresh disabled).
**Steps:** Trigger any authed call.
**Expect:**
- 401 from the API.
- Because `idToken` was non-empty, `unauthorizedHandler` fires, `signOut()` runs, user lands on login.
- This validates the gate didn't break the original 401-recovery behaviour.

### 5.3 Refresh token expired (>30 days inactive)
**Pre:** Logged-in user; `RefreshTokenExpired` error on the session.
**Expect:** `App.tsx:166` watcher catches it and calls `signOut()`. User sees login.

---

## 6. URL & state hygiene

### 6.1 `?sk=` stays in the URL for the lifetime of guest mode
**Pre:** Open a valid share URL.
**Expect:** `?sk=<token>` remains in the address bar while the user is a guest. This is intentional: the token IS the share link, so visibility doesn't represent a new leak. Refresh, copy-paste-into-new-tab, and StrictMode double-mount all rely on the URL being the source of truth.

### 6.2 `?sk=` is removed once the session is claimed
**Pre:** Guest signs in. Claim flow runs; `guestToken` is cleared.
**Expect:** The hash becomes `#<sessionId>` (or `#<sessionId>/<nodeId>`). The `?sk=` may remain in the URL after claim (acceptable — the now-authed user has access to the same session via their History). No active code reads it after the claim because `guestToken` is null and the load effect's `hasLoadedShareRef` is true.

### 6.3 Hash-based session restore (logged-in user)
**Pre:** Logged-in user has used the app and has `#<sessionId>` in URL.
**Steps:** Reload.
**Expect:** Session restores from the hash via `loadSession`. (Unrelated to share, but kept in scope because the hash-and-?sk= URL routing interacts.)

---

## 7. Backend / data-layer

### 7.1 ShareToken record shape
**Steps:** After 1.1, inspect `forkai-main` for the `SHARE#<token>` item.
**Expect:** Fields present: `PK = SHARE#<token>`, `SK = METADATA`, `token`, `sessionId`, `ownerSub`, `createdAt`. No extra fields. (Per ADR 0001.)

### 7.2 Public route surface (per ADR 0002)
**Steps:** Inspect Nest's mapped routes on startup. Confirm the following are `@Public()`:
- `GET /share/:token`
- `POST /share/:token/nodes`
- `POST /share/:token/highlights`
- `PATCH /share/:token/highlights/:hlId`
- `DELETE /share/:token/highlights/:hlId`

`POST /share/:token/claim` must NOT be `@Public()` — it requires a Cognito JWT for the claimant.

### 7.3 `updateSessionMeta` null → $REMOVE
**Steps:** Direct API call via curl with a valid host idToken: `DELETE /sessions/:sessionId/share` for a session with an active token.
**Expect:** 204. No `TypeMismatch` errors in API logs. `SessionMeta.shareToken` attribute removed (not present as null).

### 7.4 Same translation works for `notionPageUrl`
**Steps:** Owner exports to Notion (sets `notionPageUrl`). Owner or guest then creates any new node.
**Expect:** `NodesService.createNode` → `updateSessionMeta({ notionPageUrl: null })` → `$REMOVE`. `notionPageUrl` attribute absent on next read. `toSummary` returns `notionPageUrl: null`.

### 7.5 Concurrent meta writes during node creation
**Steps:** Examine the `Promise.all` in `NodesService.createNode` — it fires `touchUpdatedAt`, `incrementNodeCount`, and the notion-invalidate `updateSessionMeta` in parallel.
**Expect:** Each writes only the field it owns; no last-writer-wins clobbering. (Dynamoose update is field-scoped.) Verify by running a few rapid `createNode` calls and confirming `updatedAt`, `nodeCount`, and `notionPageUrl` all end up correct.

---

## 8. Negative / edge cases

### 8.1 Guest opens share URL while offline
**Expect:** `GET /share/:token` fails network-level. Catch path nulls `guestToken`. User sees login (acceptable for a network error).

### 8.2 Guest tries to revoke / rename / delete via host endpoints
**Steps:** From the guest workspace, send a raw `DELETE /sessions/:sessionId` request (no token).
**Expect:** 401. Guest's UI must not surface these actions in the first place — confirm during UI walk-through.

### 8.3 Token URL pasted into the host's own browser (same `sub`)
**Pre:** Host opens their own share URL while logged in.
**Expect:** Falls into 4.3 — claim is a no-op, lands in workspace via the authed path.

### 8.4 Two guests on the same token simultaneously
**Steps:** Open the same `?sk=<token>` in two incognito windows; both create branches at roughly the same time.
**Expect:** Both branch creations succeed (they write under the same `ownerSub` derived from the share record, no per-guest identity). The host's session ends up with both branches. No 409s, no lost writes.

### 8.5 ShareToken record orphan check
**Steps:** Manually delete a `SessionMeta` item without revoking. Guest tries to load via the now-orphaned `?sk=<token>`.
**Expect:** `getSessionByToken` resolves the token → finds owner sub + sessionId → tries `getSessionMeta(ownerSub, sessionId)` → null → throws 403 ("Invalid or revoked share token"). Not a 500.

---

## 9. Sanity / smoke (run before merging)

| Check | How |
|---|---|
| API typechecks | `cd apps/api && npx tsc -p tsconfig.build.json --noEmit` |
| Web typechecks | `cd apps/web && npx tsc --noEmit` |
| API boots and registers `/share/*` routes | `npm run dev:api`, scan startup log for `Mapped {/share/:token, GET}` etc. |
| API rejects unauthed `/sessions/*` | `curl -i http://localhost:3000/sessions/X/share` → 401 |
| API allows `/share/*` without auth | `curl -i http://localhost:3000/share/invalid` → 403 (not 401) |
| Web boots | `npm run dev:web`, load `/` in browser, no console errors |

---

## Out of scope (do NOT test here)

- Cognito email/password flow itself — covered by the login PR.
- Notion OAuth + push — covered by the Notion PR. (Only the *invalidation hook* triggered by share is in scope.)
- Mind map pan/zoom interactions — UI PR.
- Highlight CSS Custom Highlight API rendering quirks — Safari fix PR.
