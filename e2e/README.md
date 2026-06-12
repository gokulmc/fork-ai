# fork.ai — E2E test suite (Playwright)

End-to-end tests for the web app. The NestJS API is **fully mocked at the
network layer** (`fixtures/mock-api.ts`), and next-auth is mocked by
intercepting `/api/auth/session` (`fixtures/auth.ts`) — so the suite needs **no
DynamoDB, Cognito, Anthropic key, or running API**. Only the Next.js dev server
is started (automatically, via Playwright's `webServer`).

## Run

```bash
# from the repo root
npm run test:e2e                          # full suite — desktop (Chromium) + mobile (WebKit/iPhone 13)
npm run test:e2e -- --project=chromium    # desktop only
npm run test:e2e -- --project=mobile      # mobile only (mobile.spec.ts)
npm run test:e2e -- --ui                  # interactive UI mode
npx playwright test -c e2e tests/branching.spec.ts   # one file
```

First run needs browsers: `npx playwright install chromium webkit` (mobile emulates iPhone 13 on the WebKit engine).

> ⚠️ If you already have `npm run dev:web` running, Playwright reuses it. That
> is only safe if it was started with `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000`
> — after LAN phone testing, `apps/web/.env.local` may point at a LAN IP, which
> changes nothing for the mocks (they're host-agnostic) but does change CORS
> behaviour for real requests. When in doubt, stop your dev server and let
> Playwright start its own (it forces the localhost values).

## Layout

```
e2e/
├── playwright.config.ts     # webServer bootstraps apps/web on :3001
├── fixtures/
│   ├── mock-api.ts          # MockApi: route-level NestJS mock + SSE/CORS/deferred helpers
│   ├── auth.ts              # next-auth session/signout interception, fake Cognito JWT
│   ├── data.ts              # canned sessions/nodes/stream events
│   └── app.ts               # primeStorage, gotoWorkspace, text-selection helpers
└── tests/
    ├── landing.spec.ts          # hero vs login gate (visited flag), query box, all 4 topic chips
    ├── login.spec.ts            # correct/wrong password, signup→verify, forgot-password reset
    ├── root-query-stream.spec.ts# SSE happy path, persist-first refresh, 402, long query, markdown
    ├── branching.spec.ts        # Go deeper, Ask AI, error states, long Ask query, Notion invalidation
    ├── llm-providers.spec.ts    # branch via Claude / Gemini / DeepSeek + ✳ model pill
    ├── session-restore.spec.ts  # localStorage restore + self-healing
    ├── guest-share.spec.ts      # ?sk= guest mode, trial mode, claim, invalid links
    ├── share-button.spec.ts     # share token lifecycle (host side)
    ├── auth-gate.spec.ts        # 401 sign-out, RefreshTokenExpired, 5xx tolerance
    ├── tweaks.spec.ts           # model selection, DeepSeek web-search gating, theme
    ├── highlights.spec.ts       # CSS Custom Highlight persistence, colours, fg, last-colour reuse, callouts, drawer
    ├── selection.spec.ts        # double / triple / quadruple-click selection + citation boundary
    ├── admin.spec.ts            # signed-out / non-admin gates, overview KPIs, users, payments, Bearer
    └── mobile.spec.ts           # [mobile project] pill/map, breadcrumb collapse, tap-select, follow-up, pinch-suppression
```

## Regression coverage (mapped to `issues.md`)

| issues.md entry | Test |
|---|---|
| Refresh mid root-query stream dropped to Landing (`e3b2c91`, persist-first `init`) | `root-query-stream.spec.ts` › *refresh mid-stream restores the session* |
| Ask AI panel blanked when loading node opened mid-request (`1c647ae`) | `branching.spec.ts` › *opening the Ask-AI node while loading…* |
| Ask AI failed for questions > 500 chars (`178c411`) | `branching.spec.ts` › *questions longer than 500 chars are sent in full* |
| Stale localStorage session needed manual cache-clear (`defeb77`) | `session-restore.spec.ts` › *stale stored session id self-heals* + *logged-out visitor does not hang* |
| Model change in Tweaks didn't apply to next branch (`44515f2`) | `tweaks.spec.ts` › *model change applies to the very next branch* |
| Guest bounced to login on an authed 401 (`&& idToken` gate) | `guest-share.spec.ts` › sign-out-call guards on every guest test |
| Users silently logged out hourly → `RefreshTokenExpired` handling | `auth-gate.spec.ts` › *RefreshTokenExpired forces sign-out* |
| Stale `fork.ai.trial` → invalid-link → login bounce loop | `guest-share.spec.ts` › *invalid share link* |
| Notion export staleness on new branches | `branching.spec.ts` › *branching invalidates a stale Notion export* |
| Out-of-credit (402) on root query / branch | `root-query-stream.spec.ts` + `branching.spec.ts` 402 tests |
| Trial 5-node lock & claim-on-login | `guest-share.spec.ts` trial + claim tests |
| Root query > 500 chars truncation (`6d50b05`) | `root-query-stream.spec.ts` › *long root query is sent in full* |
| Mobile single-tap fused two sentences with web search on (`Section.tsx`) | `selection.spec.ts` › *citation boundary* + `mobile.spec.ts` › *single tap* |

Backend-only regressions (Dynamoose `$ADD` casing, `saveUnknown` stripping,
SES/Cognito infra, Notion block splitting) are **not** reproducible from the
browser and belong in `apps/api` integration tests, not here.

## Conventions

- **Mock everything you touch.** Unmatched API calls are answered with status
  `599` and an explicit `e2e: unmocked …` body so missing mocks fail loudly.
- Later `api.on(...)` registrations override earlier ones — `baseApi()` gives
  the defaults every authed boot needs (`/users/me`, `/sessions`, share status).
- Use `deferred()` to hold a mocked request in-flight when a test needs to
  observe optimistic/loading UI.
- Text selection goes through `selectSectionText()` (programmatic Range +
  `mouseup`), not mouse drags — identical to what App.tsx listens for, and
  stable across fonts and line wrapping.
