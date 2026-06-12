# fork.ai — E2E suite (Playwright)

> See root `CLAUDE.md` for the data model and app architecture, and `e2e/README.md` for the human-facing run guide + issues.md regression mapping. This file is the working context for editing the suite.

## Architecture: everything is mocked except the web app

```
Playwright (chromium)
    │
    ▼
Next.js dev server :3001          ← the ONLY real process (webServer boots it)
    │
    ├── /api/auth/session          ← intercepted (fixtures/auth.ts) — next-auth never runs
    ├── /api/auth/csrf, /signout   ← intercepted; signOut() flips mock state to logged-out
    └── http://localhost:3000/*    ← intercepted (fixtures/mock-api.ts) — NestJS never runs
```

No DynamoDB, Cognito, Anthropic key, or running API. Every test is deterministic; an **unmatched API call is answered with status 599** and an `e2e: unmocked …` body so missing mocks fail loudly instead of hanging.

**Never add a test that talks to the real API or real Cognito.** Backend behaviour (Dynamoose operators, `saveUnknown`, billing) belongs in `apps/api` tests — this suite only proves frontend behaviour against the API *contract*.

## The fixtures (use them, don't re-implement)

| Fixture | What it owns |
|---|---|
| `mock-api.ts` → `MockApi` | Route-level API mock. `api.on('GET /sessions/:id', payloadOrStatusOrFn)` — later registrations override earlier ones. Records every call (`api.calls`, `api.callsTo(spec)`) for payload assertions. Handles CORS preflight automatically. |
| `mock-api.ts` → `fulfillSse(route, events)` | SSE bodies for `/sessions/stream` and `/share`. The whole body is delivered atomically — fine, because the client parses events sequentially; you assert final state, not progressive paint. To simulate an interrupted stream, **omit the `done` event** (see root-query mid-stream-refresh test). |
| `mock-api.ts` → `deferred()` | Hold a mocked request in-flight: `api.on('POST …', async () => { await gate.promise; return node; })`. This is how loading/optimistic UI is observed. |
| `auth.ts` → `mockAuth(page, { authed, error, admin })` | Stateful session mock + fake JWT. `admin: true` issues a JWT with `cognito:groups: ['admins']` (admin dashboard gate). `signIn('cognito-token')` is mocked at `/api/auth/callback/*` → flips state authed. Returns `{ state, signOutCalls }` — assert `signOutCalls.length === 0` in guest tests (the 401-bounce regression guard). Install **before** `page.goto`. |
| `cognito.ts` → `mockCognito(page, { userExists, password, verifyCode })` | Mocks the same-origin `/api/cognito/*` routes the custom LoginPage calls. Error bodies mirror real Cognito codes (`UserNotFoundException`, `NotAuthorizedException`, `CodeMismatchException`). A successful login/verify/reset returns shape-only tokens → the LoginPage plays its graph animation → "arrived" screen → auto-`onEnter` after 1.5s → Landing. |
| `app.ts` → `primeStorage` | Seeds `fork.ai.consent` (cookie banner steals clicks otherwise) and `fork.ai.visited` (decides LoginPage vs Landing for logged-out users) before any page script runs. |
| `app.ts` → `gotoWorkspace` | Boots logged-in with a session restored via localStorage. Returns once `.ws-title` is visible. |
| `app.ts` → `selectSectionText` | Programmatic Range + `mouseup` — the exact signal App.tsx's selection effect listens for. **Never use mouse-drag selection**; it breaks on font/wrap changes. |

API mock matching is **host-agnostic** (regex on the first path segment: `sessions|share|users|notion|…`), so it works whatever `NEXT_PUBLIC_API_BASE_URL` the bundle was built with. If the backend grows a new top-level controller, add its segment to `API_PATH_RE` in `mock-api.ts` or its calls will silently bypass the mock.

## Hard-won constraints (each of these broke the suite once)

1. **A `#sessionId` hash does NOT survive to the restore effect.** App.tsx's `view` effect rewrites the URL to the bare pathname on the first commit, before auth settles. Real restores ride `fork.ai.session` / `fork.ai.node` in localStorage — that's what `gotoWorkspace` primes. Don't write tests that boot via `page.goto('/#sid')` and expect a restore; there's a `test.fixme` in `session-restore.spec.ts` documenting this product gap.
2. **`<Section>` and `<MindMap>` are code-split** (`next/dynamic`, `ssr: false`). `.ws-title` paints before `.section-body` exists. Anything touching section DOM must wait for `.section-body[data-section-id=…]` first — `selectSectionText` does this; don't bypass it.
3. **React StrictMode (dev) double-mounts**, and mount-guard *refs* reset with it — e.g. `POST /share/:token/claim` legitimately fires twice. Assert `>= 1` for effect-driven calls, never exactly 1, unless the guard is state/server-side.
4. **Fulfilled cross-origin responses still pass through browser CORS.** Every fulfilment must carry `access-control-allow-origin` and OPTIONS preflights must be answered — `MockApi`/`fulfillJson` do this; if you fulfil a route by hand (e.g. a 204 DELETE), include the header yourself.
5. **TweakRadio has no per-option onClick** — selection is computed from pointer-X on the track. Clicking the option *button* works because of its position; `selectOption` does not (only `TweakSelect` is a real `<select>`).
6. **Saved highlights paint on cold load via the `sectionReady` dependency** (App.tsx). The highlight layout effect first runs before the code-split `<Section>` chunk mounts (so `querySelector` finds no `.section-body`); `sectionReady` flips when the chunk loads and re-runs the effect after the section DOM is committed. Was a `test.fixme`; now a live test in `highlights.spec.ts`. If you ever change the dynamic import or the effect deps, re-verify that cold-load test.
7. **`webServer.env` forces `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000` / `NEXTAUTH_URL=http://localhost:3001`**, overriding `apps/web/.env.local` (which may hold LAN-IP values from phone testing — real process env beats .env files in Next.js). `reuseExistingServer` is on outside CI: a dev server started by hand with LAN values can behave differently.
8. **`/topics` is fetched server-side by the Next server (RSC)** — `page.route` cannot intercept it. With no API running it falls back to `FALLBACK_TOPICS`; don't assert specific chip text, assert `.chip` presence/behaviour.
9. **The brand logo is invisible in trace-viewer/UI-mode snapshots — that is not a bug.** Snapshots are re-rendered DOM (not screenshots), and the viewer's resource rewriting doesn't handle the CSS `image-set()` the logo uses (`.brand-logo` in globals.css), which overrides the plain-`url()` fallback. A real `page.screenshot()` shows the logo fine. Don't write assertions against it, and don't "fix" the CSS for the viewer's sake.
10. **Service workers are blocked (`serviceWorkers: 'block'` in config) — do not remove it.** The app registers `public/sw.js`. Once active it proxies fetches, and **WebKit does not surface SW-initiated requests to `page.route`** (Chromium does), so API mocks intermittently leaked to the real network — POSTs even hit a stray server on :3000. Blocking SW registration keeps every fetch in the page context on all engines. This was the single nastiest flake in the suite; it presented as "the mock works for GET but not POST, only on mobile, sometimes."
11. **Mobile runs WebKit and needs `npx playwright install webkit`.** The `mobile` project uses `devices['iPhone 13']` (WebKit engine, 390×664, `hasTouch`, `isMobile`). `clipboard-*` permissions are Chromium-only and are set per-project on `chromium` (WebKit throws `Unknown permission`). Use `.tap()` not `.click()` in mobile specs. The two projects split by filename: `mobile.spec.ts` ⇒ mobile project; everything else ⇒ chromium (`testIgnore`/`testMatch` in config).
12. **`primeStorage` also suppresses the PWA install sheet** (`sessionStorage['fork.ai.installDismissed']`). On iOS/WebKit the "Add to home screen" sheet (`InstallPrompt`) overlays the workspace and intercepts taps. Any test that bypasses `primeStorage` on mobile must set this itself.
13. **The custom login flow is animation-heavy (~1.5s arrived screen + signIn round-trip).** Tests wait up to 20s for `arrived` → Landing. Under high parallelism on one dev server this occasionally exceeds timeouts, so local `retries` is 1 (CI 2). Don't shorten the arrived-screen waits.

## Selector conventions

The app has almost no `data-testid`s — selectors come from real class names/labels in `apps/web/src/components` (`.ws-title`, `.mm-node`, `.deeper-btn`, `.hl-menu--visible`, `.twk-trigger`, `.session-card`, placeholder texts). **When a component changes markup, fix the selector here in the same commit.** Before inventing a selector, read the component — don't guess from memory.

## Adding tests

- Start from `baseApi()` (mocks `/users/me`, `/sessions`, share status — everything an authed boot calls), then `.on(...)` your specifics. Overrides go *after*, registration order is the precedence.
- One regression = one test, named `REGRESSION (<commit/issue>)`, with a comment stating the pre-fix failure mode. Keep the issues.md mapping table in `e2e/README.md` up to date when you add one.
- A test that documents a *known unfixed* product gap is a `test.fixme` with a comment explaining the mechanism — never a deleted test, never a permanently failing one.
- Suspected flake? Reproduce with `--repeat-each=2` before touching timeouts. Every flake so far was a missing wait on code-split UI, not slowness.

## Run

```bash
npm run test:e2e                              # from repo root; boots :3001 itself (chromium + mobile)
npm run test:e2e -- --project=chromium        # desktop only
npm run test:e2e -- --project=mobile          # mobile (WebKit/iPhone 13) only
npx playwright test -c e2e tests/foo.spec.ts  # one file
npx playwright test -c e2e --ui               # interactive
npx tsc -p e2e --noEmit                       # type-check the suite
npx playwright install chromium webkit        # first-time browser download
```
