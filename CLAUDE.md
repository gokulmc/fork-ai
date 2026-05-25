# fork.ai — Claude Code Context (Root)

## What this project is

**fork.ai** is a branching research workspace. A user types a question, gets a structured answer split into sections, and can explore any section into a child node ("Go deeper"), or highlight any passage and branch from it ("Ask AI"). Every branch becomes a node on a live mind map. Notes and callouts can be saved from highlights.

---

## Repository layout

```
fork-ai/                         ← Nx monorepo root
├── apps/
│   ├── api/                     ← NestJS API server (port 3000)
│   │   └── CLAUDE.md            ← backend-specific context
│   └── web/                     ← Next.js 15 app (port 3001)
│       └── CLAUDE.md            ← frontend-specific context
├── _prototype/                  ← original vanilla prototype (reference only, do not edit)
├── nx.json                      ← Nx task orchestration
├── tsconfig.base.json           ← shared TS base config
└── package.json                 ← npm workspaces + root scripts
```

> `_prototype/` holds the original `.jsx` / `.html` / `.css` files. Reference for UI behaviour and CSS design — **not** part of the production app.

### Running the workspace

```bash
# From repo root:
npm install              # installs all deps via npm workspaces
npm run dev              # starts both api (3000) and web (3001) in parallel
npm run dev:api          # api only
npm run dev:web          # web only
npm run build            # build both apps (Nx-cached)
npm run test             # test both apps (Nx-cached)

# Or use nx directly:
npx nx run @fork-ai/api:dev
npx nx run @fork-ai/web:dev
```

---

## Architecture: how the two apps connect

```
Browser  (Next.js :3001)
    │
    │  Authorization: Bearer <Cognito id_token>
    ▼
NestJS API  (:3000)
    │
    ├── Cognito JWKS  — offline JWT validation (no DB call per request)
    ├── DynamoDB      — sessions, nodes, annotations, highlights, user Notion tokens
    ├── Anthropic API — LLM calls (answerQuery, expandSection, followUpFromHighlight)
    └── Notion API    — OAuth token exchange, page search, block push
```

**The single most important rule:** The Next.js frontend **never calls Anthropic directly**. All LLM work goes through the NestJS backend. Any `src/app/api/llm/*` routes inside `apps/web` are a mistake and must be deleted.

---

## Shared data model

### Node (core unit)

Every piece of research content is a **node** in a flat map `{ [id]: node }`.

```ts
interface ForkNode {
  id: string;                    // ULID from backend (or optimistic uid() in frontend)
  parentId: string | null;       // null = root node
  kind: 'QUERY' | 'DEEPER' | 'ASK';
  title: string;                 // ≤5 words — shown on mind map card
  emoji: string | null;          // single emoji from LLM
  query: string;                 // original question or section heading
  lede: string;                  // one-sentence summary from LLM
  sections: Section[];           // ALL text content lives here
  fromSection: string | null;    // section id in parent that spawned this node
  fromText: string | null;       // source snippet (highlight or section preview)
  createdAt: number;
  loading: boolean;
  error?: string;
}

interface Section {
  id: string;
  heading: string;
  body: string;  // GitHub-flavoured markdown
}
```

**Sections are nested inside nodes — they are never queried independently.**

### Tree reconstruction

No child-pointer arrays are stored. The tree is reconstructed at read time by grouping all nodes by `parentId`. This is how the mind map builds its `childMap` and how breadcrumbs walk upward via `parentId`.

### Highlights

```ts
// keyed by "nodeId::sectionId"
persistentHl: Record<string, Array<{ text: string; start?: number; end?: number; bg: string | null; fg: string | null }>>
```

`start`/`end` are character offsets into the section's rendered plain text (after markdown parsing). Applied via the **CSS Custom Highlight API** (`CSS.highlights`) in a `useEffect` inside `Section.tsx` — no span injection. Per-section named highlights (`hl-{sectionId}`) are styled with rules injected via `adoptedStyleSheets`. Highlights without offsets (legacy) are skipped.

**Safari CSS Custom Highlight API quirks (App.tsx):**
- `CSS.highlights.delete('temp-hl')` does not schedule a repaint in Safari — use `CSS.highlights.set('temp-hl', new Highlight())` (empty Highlight) instead when clearing `temp-hl` to force a style recalc.
- Safari won't repaint a stale highlight layer if `CSS.highlights` is mutated *after* a frame has already been painted. `hlMenu` is cleared in a `mousedown` handler (not deferred to `mouseup + setTimeout`) so that React's `useLayoutEffect` runs and empties `CSS.highlights` *before* the browser paints the first frame following the click.

### Annotations

```ts
interface Annotation {
  id: string;
  kind: 'note' | 'callout';
  text: string;        // selected passage
  fromTitle: string;   // display name of source node
  nodeId: string;
  sectionId: string;
  createdAt: number;
}
```

### Notion export

Sessions can be pushed to Notion as a structured page. The page opens with a Mermaid `graph TD` mind map diagram, followed by collapsible toggle headings for each child branch. The Notion page URL is persisted to DynamoDB (`notionPageUrl` on `SessionMetaItem`) so the "Open in Notion ↗" button survives page reload and history navigation. Adding a new branch clears the URL immediately (both UI and DB) since the export is now stale.

See **[`docs/notion-export.md`](docs/notion-export.md)** for the full technical reference (block mapping, colour scheme, the nested-blocks API problem and its solution, URL persistence, stale-export invalidation, OAuth setup, and error handling).

Key constraints to keep in mind:
- The Notion API rejects **toggle heading** blocks with inline `children` in `pages.create`. The client splits the nested block tree into `{ blocks: FlatBlock[], childrenMap: ChildEntry[] }` before sending; the server depth-first appends each level via `blocks.children.append`.
- **Tables are the exception**: Notion requires rows inside `table.children` (the type-specific sub-object, not the block-level `children`). `splitBlocks` never touches `table.children`, so rows travel inline in `pages.create`.
- The markdown-to-blocks parser (`mdToBlocks` in `notion-clipboard.ts`) is line-by-line. `splitTableRow` splits cells character-by-character to handle `|` inside backtick spans correctly.
- Toggle heading text colour is set on `rich_text[].annotations.color`, NOT on the block-level `color` field (block-level `color` sets the background).
- **Invalidation is server-side.** `NodesService.createNode` calls `db.updateSessionMeta(sub, sessionId, { notionPageUrl: null })` after persisting any new node. The repository translates `null` to a Dynamoose `$REMOVE` (see "Dynamoose null handling" below) so the attribute is dropped from the item entirely. Works for both authed and guest writes — frontend does NOT need to call `PATCH /sessions/:id` to invalidate.

---

## LLM call types (all fired server-side by NestJS)

| Function | Trigger | Sections returned |
|---|---|---|
| `answerQuery(query, sectionCount)` | New root query (`POST /sessions`) | up to `sectionCount` (default 4) |
| `expandSection(ancestors, heading, body, sectionCount)` | "Go deeper" (`POST /sessions/:id/nodes` with `kind: DEEPER`) | up to `sectionCount` (default 4) |
| `followUpFromHighlight(ancestors, highlight, question, sectionCount)` | "Ask AI" (`POST /sessions/:id/nodes` with `kind: ASK`) | up to `sectionCount` (default 4) |

All three return: `{ title, emoji, lede, sections: [{ heading, body }] }`.

---

## Coding conventions (both apps)

- **TypeScript strict** — no `any`
- **No over-engineering** — if a helper is only used once, inline it
- **Comments only for non-obvious WHY** — never what the code does
- **No trailing summaries** in responses — the user can read the diff

---

## Working with Claude Code

**Never make architecture-level changes without explicit confirmation.** This includes:
- Swapping auth libraries (e.g. next-auth ↔ react-oidc-context)
- Changing the database, ORM, or data access layer
- Replacing state management solutions
- Changing the build system or monorepo tooling
- Adding/removing major runtime dependencies

If a user message implies an architectural change, **stop and clarify** before touching any files:
- Explain the trade-offs
- Ask whether they want to proceed
- Only start implementing after explicit confirmation

---

## Workspace layout — pane divider

The workspace is a 3-column CSS grid: `var(--map-width, 36%) 6px 1fr`.

- **`--map-width`** is a CSS custom property set directly on the `.app` DOM node via `appRef.current.style.setProperty(...)` — **not** through React state — to avoid triggering re-renders (and therefore MindMap jitter) on every pointer-move event during drag. React state (`splitPct`) is only touched once on pointer-up to persist to `localStorage`.
- **`ResizeObserver` in `MindMap`** is debounced 120ms so the fit/recenter effect doesn't fire mid-drag.
- After drag ends, the fit effect calls `animateToRef.current(...)` (smooth 300ms) instead of `setView` (snap) so the map re-fits without flickering. `animateToRef` is a plain ref kept in sync with `animateTo`; it is intentionally NOT in the `useEffect` deps array because adding it would change the array size and trigger React's hooks invariant error.

---

## Cognito login — custom UI (branch: `cognito`)

The app uses a **custom email/password login UI** instead of the Cognito Hosted UI redirect. Architecture:

### Auth flow
1. `LoginPage.tsx` collects email → password (multi-step, animated bar)
2. Password is submitted to `/api/cognito/login` (Next.js route, server-side)
3. That route calls Cognito `InitiateAuth` with `USER_PASSWORD_AUTH` flow
4. On success, the `idToken` comes back — frontend calls `signIn('cognito-token', { idToken, redirect: false })` from `next-auth/react`
5. A next-auth credentials provider (`cognito-token` in `src/auth.ts`) decodes the JWT and stores `idToken` in the session
6. `App.tsx` reads `authSession?.idToken` from `useSession()` — unchanged from before

### Login page steps
| Step | Input | Action |
|---|---|---|
| `email` | email address | Enter/center dot → `password` step |
| `password` | password | Submit → call `/api/cognito/login` |
| → if `UserNotFoundException` | — | transition to `signup-password` |
| → if `NotAuthorizedException` | — | show "Incorrect password" error |
| → if success | — | `signIn('cognito-token')` → graph animation → `onEnter()` |
| `signup-password` | password + confirm | Password regex validation → call `/api/cognito/signup` |
| `verify` | code from email | Call `/api/cognito/confirm` → auto-login → animation |

### Next.js API routes (all server-side, call Cognito AWS SDK)
- `POST /api/cognito/login` — `InitiateAuth USER_PASSWORD_AUTH`
- `POST /api/cognito/signup` — `SignUp`
- `POST /api/cognito/confirm` — `ConfirmSignUp` then auto-`InitiateAuth`
- `POST /api/cognito/resend` — `ResendConfirmationCode`

### Key constraints
- **`USER_PASSWORD_AUTH` flow must be enabled** on the Cognito App Client (AWS Console → User Pool → App clients → Auth flows). If missing, Cognito returns `NotAuthorizedException: ALLOW_USER_PASSWORD_AUTH flow not enabled for this client`.
- **`SECRET_HASH` required when App Client has a client secret.** Every Cognito SDK call (`InitiateAuth`, `SignUp`, `ConfirmSignUp`, `ResendConfirmationCode`) must include a `SECRET_HASH`. The helper is `computeSecretHash(email)` in `src/lib/cognito-secrets.ts` — `Base64(HMAC-SHA256(username + clientId, clientSecret))`.
- Password regex: `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&_\-#])[A-Za-z\d@$!%*?&_\-#]{8,}$` — must match the User Pool's password policy.
- The Google OAuth button still calls `signIn('cognito')` → Cognito Hosted UI (existing flow unchanged).
- `triggerRef` in `LoginPage.tsx` is updated on each step change via `useEffect([step, ...])` — center dot always calls the current step's action. The graph animation trigger is stored separately in `graphTriggerRef` and fires only after successful auth.

---

## Deployment

### API — CodeBuild → Docker → Elastic Beanstalk

| Resource | Value |
|---|---|
| CodeBuild project | `forkai-api-deploy` (ap-south-1) |
| ECR repo | `forkai-api` |
| EB app / env | `forkai-api` / `forkai-api-prod` |
| EB LB | Classic LB `awseb-e-t-AWSEBLoa-CXJ72Y7Y13FA`, SG `sg-0453dabdaefe71c37` |
| API URL | `https://api.forkai.in` (CNAME → EB hostname, HTTPS via ACM `forkai.in`/`*.forkai.in` cert) |
| S3 artifacts bucket | `forkai-eb-artifacts` |
| Buildspec | `apps/api/buildspec.yml` |

**How a deploy works:**
1. Push to `prod` branch → CodeBuild webhook fires
2. `docker build` using `apps/api/Dockerfile` with repo root as context
3. Image pushed to ECR with tag `$CODEBUILD_RESOLVED_SOURCE_VERSION` (commit SHA) + `latest`
4. `Dockerrun.aws.json` uploaded to `s3://forkai-eb-artifacts/<sha>/`
5. Single `elasticbeanstalk update-environment` call deploys version AND injects secrets

**Critical constraints (hard-won):**
- **Docker base image**: use `public.ecr.aws/docker/library/node:22-alpine` — NOT `node:22-alpine`. Docker Hub has unauthenticated pull rate limits (429) in CodeBuild. ECR Public mirror has none.
- **Single `update-environment` call**: never split deploying a version and updating env vars into two separate calls. EB allows only one update at a time; the second call will hit `OperationInProgress`.
- **`create-application-version` is idempotent**: buildspec uses `|| true` because re-running on the same commit SHA returns `InvalidParameterValue: version already exists`.
- **`forkai-build-role` IAM**: needs `AdministratorAccess-AWSElasticBeanstalk` managed policy (EB's `UpdateEnvironment` internally checks CloudFormation, S3, EC2 permissions on the caller). Also needs S3 read/write on `elasticbeanstalk-ap-south-1-643830915895`.
- **EB default S3 bucket policy** (`elasticbeanstalk-ap-south-1-643830915895`): `forkai-build-role` must be an explicit principal — the bucket policy is not open to all IAM roles in the account.
- **`forkai-api-role` (EC2 instance profile)**: must have ECR pull permissions (`ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer` on `arn:aws:ecr:ap-south-1:643830915895:repository/forkai-api`). Without this the instance cannot pull the Docker image and EB rolls back silently.
- **HTTPS on the EB Classic LB**: HTTPS (443) listener uses the `forkai.in` ACM cert (which has `*.forkai.in` SAN — covers `api.forkai.in`). Port 443 must be open on the LB security group (`sg-0453dabdaefe71c37`) — it is NOT open by default when EB creates the LB. LB forwards to EC2 port 80 (nginx proxy) → Docker port 8080.
- **`CORS_ORIGIN`** on EB is set to `https://forkai.in`. NestJS CORS allows only that origin — any change to the frontend domain requires updating this env var and redeploying.

**Triggering a manual redeploy (if webhook didn't fire):**
```bash
aws codebuild start-build --project-name forkai-api-deploy \
  --region ap-south-1 --source-version prod
```

---

### Frontend — Amplify (Next.js SSR)

| Resource | Value |
|---|---|
| Amplify app | `forkai-web` (AppId: `d2ej36ff5hc50c`, ap-south-1) |
| Branch | `prod` → PRODUCTION stage |
| Build spec | `amplify.yml` at repo root |
| Live URL | `https://forkai.in` (custom domain) |

**Critical constraints (hard-won):**
- **`AMPLIFY_MONOREPO_APP_ROOT=apps/web`** must be set on the Amplify branch as an environment variable. Without it, Amplify's framework detector reads the root `package.json` (which has no `next` dep) and errors with `Cannot read 'next' version in package.json`.
- **Next.js must be pinned to 15.x** — Amplify's detector does not recognise Next.js 16. Pin is enforced in two places: `apps/web/package.json` (`"next": "^15.5.18"`) and root `package.json` `overrides` + direct dep. The override is required because `next-auth`'s peer dep range includes 16, which npm would otherwise hoist to root `node_modules`, causing TypeScript to see two conflicting Next.js type definitions simultaneously.
- **`$CODEBUILD_SRC_DIR` is NOT the repo root**: in Amplify's build environment it is the *parent* of the repo clone (e.g. `/codebuild/output/.../src`), and `PWD` starts at the appRoot (`apps/web`). The repo root is therefore always `$(pwd)/../..` from inside the build phases. The `amplify.yml` preBuild uses `cd $(pwd)/../../ && npm ci` to reach it.
- **npm workspaces + Amplify**: there is no per-workspace `package-lock.json`. The lock file lives at the repo root, so `npm ci` must run from the repo root, not from `apps/web`.
- **Amplify WEB_COMPUTE Lambda does NOT inject branch env vars at runtime.** Non-`NEXT_PUBLIC_` env vars set on the Amplify branch are available during the **build phase** but are NOT forwarded to the SSR Lambda function at request time. Symptoms: `process.env.COGNITO_CLIENT_SECRET` is `undefined` inside a route handler even though it's set in the Amplify console. Fix: add the server-side secrets to the `env` block in `next.config.ts` — webpack's DefinePlugin inlines them into the Lambda bundle at build time. See `apps/web/next.config.ts`. **Do not attempt to read them from AWS Secrets Manager / SSM at runtime** — the Amplify-managed Lambda execution role has no IAM credentials available (`CredentialsProviderError`).
- **Amplify WEB_COMPUTE Lambda execution role is Amplify-managed** and does NOT appear in your account's Lambda or IAM console. You cannot attach custom policies to it. If a route handler needs AWS SDK calls (e.g. Cognito), those work because Cognito is a public API using the client secret — not IAM credentials.
- **next-auth v5 + Amplify: three required settings in `auth.ts`:**
  1. `secret: process.env.NEXTAUTH_SECRET` — next-auth v5 reads `AUTH_SECRET` internally (in node_modules, not webpack-transformed). Pass it explicitly so the constructor receives the build-time-inlined value.
  2. `AUTH_SECRET: process.env.NEXTAUTH_SECRET` in the `next.config.ts` `env` block — belt-and-suspenders so it's also available as a real env var.
  3. `trustHost: true` — next-auth v5 validates the request host against `AUTH_URL`; without this it rejects all requests at non-localhost URLs. Required for any CDN/serverless deployment.

---

### Session persistence
Login survives tab close. `App.tsx` gates the login page on two conditions: `status === 'unauthenticated'` (covers logout from any page) and `showLogin` (keeps `LoginPage` mounted during the post-login animation). `showLogin` is initialised from `localStorage` (persists across tab closes) and is set back to `true` by a `useEffect` whenever `status` becomes `'unauthenticated'`. Do **not** use `sessionStorage` for this — it is tab-scoped and would break persistence.

**Do not add `!loadingRoot` to the login gate.** The earlier version `(showLogin && !loadingRoot)` looked safe but broke the post-login animation: on a logout→reload→login flow, `loadingRoot` is initialised to `true` from a stored session in `localStorage`, and `loadSession()` also sets it back to `true` as soon as `status` becomes `'authenticated'`. That caused `LoginPage` to unmount mid-animation. `showLogin` alone is sufficient — it stays `true` until `onEnter()` fires at the end of the 1500ms animation.

### Cognito refresh token flow
`id_token` from Cognito expires after 1 hour. To keep users logged in for 30 days (the refresh-token lifetime):

- `/api/cognito/login` and `/api/cognito/confirm` return `{ idToken, refreshToken, expiresIn }`.
- `LoginPage.tsx` forwards all three into `signIn('cognito-token', { idToken, refreshToken, expiresAt, redirect: false })`.
- The credentials provider in `src/auth.ts` stores `refreshToken` and `expiresAt` on the JWT.
- The `jwt` callback in `src/auth.ts` auto-refreshes the `id_token` 60s before expiry via Cognito's `REFRESH_TOKEN_AUTH` flow (also needs `SECRET_HASH`).
- If refresh fails (e.g., the refresh token itself has expired after 30 days), the callback returns `{ ...token, error: 'RefreshTokenExpired' }`.
- `App.tsx` watches `authSession?.error === 'RefreshTokenExpired'` and calls `signOut()` to send the user back to the login page.
- Session `maxAge` is set to 30 days in `NextAuth` config to match the Cognito refresh-token lifetime.

The next-auth type augmentation lives in `apps/web/src/types/next-auth.d.ts` — adds `refreshToken`, `expiresAt`, `error` to `JWT`/`User`/`Session`.

### Hook ordering caveat in App.tsx
`useEffect` hooks that reference `loadSession` (a `useCallback` declared mid-file) **must appear after the `loadSession` declaration**, otherwise the dependency array `[..., loadSession]` is evaluated in the temporal dead zone and throws `ReferenceError: Cannot access 'loadSession' before initialization` at runtime. Keep new effects that touch `loadSession` below its `useCallback`.

### JWT auth guard (backend)
`JwtAuthGuard` (`apps/api/src/auth/jwt-auth.guard.ts`) validates the Cognito `id_token` via `passport-jwt` + `jwks-rsa`. It must **not** be bypassed in production. The `sub` claim is the stable user ID for all DynamoDB keys — bypassing it (e.g. hardcoding `sub: 'dev-user'`) causes all users to share the same session list. Routes that must skip auth use the `@Public()` decorator. Currently `@Public()`:
- `GET /notion/callback`
- `GET /share/:token`
- `POST /share/:token/nodes`
- `POST /share/:token/highlights`
- `PATCH /share/:token/highlights/:hlId`
- `DELETE /share/:token/highlights/:hlId`

`POST /share/:token/claim` is intentionally NOT `@Public()` — claiming a shared session requires a Cognito JWT to know which user to attach it to.

---

## Session sharing — Share Tokens & Guest Mode

See `CONTEXT.md` for the domain definitions of **Share Token**, **Guest**, **Guest Mode**, and **Claim**. See `docs/adr/0001-share-token-as-opaque-db-record.md` and `docs/adr/0002-guest-api-isolation.md` for the architectural decisions.

### Backend
- `ShareController` (`apps/api/src/share/share.controller.ts`) exposes the public `/share/:token/*` surface — strictly isolated from the authenticated `/sessions/*` controller (per ADR-0002).
- `SessionsService.generateShareToken / revokeShareToken / getShareStatus` manage one active token per Session. Token format: `randomBytes(32).toString('base64url')`. Stored at `PK: SHARE#<token>, SK: METADATA` (per ADR-0001).
- `SessionsService.claimSession(guestSub, token)` creates a `SessionMeta` row under the claimant's `sub` pointing at the same nodes/annotations/highlights. Idempotent — a second claim returns the existing summary.

### Dynamoose null handling
Dynamoose v4 rejects `null` for typed `String` fields (even when `required: false`). `DynamoRepository.updateSessionMeta` therefore translates `null` values into a `$REMOVE` expression:

```ts
for (const [k, v] of Object.entries(updates)) {
  if (v === null) remove.push(k);
  else if (v !== undefined) set[k] = v;
}
const op: Record<string, unknown> = { ...set };
if (remove.length) op.$REMOVE = remove;
```

Without this, clearing `shareToken` (on revoke) or `notionPageUrl` (on any node create) throws `TypeMismatch: Expected <field> to be of type string, instead found type null` and 500s the request. Any future schema field that may be cleared must rely on this pattern.

### Frontend — guest mode mechanics

| State | Set when | Cleared when |
|---|---|---|
| `guestToken` | URL has `?sk=<token>` on mount, OR `?sk=` is read on any render | Successful claim, or `shareApi.getSession` 403 |
| `forceLogin` | Guest clicks "Login to Save" or "Save to Notion" | `LoginPage.onEnter()` fires (1500ms after sign-in succeeds) |

**The `?sk=` token stays in the URL for the lifetime of guest mode.** Earlier attempts to strip it broke refresh (`guestToken` re-init from a clean URL fell into the login gate) and StrictMode double-mounts (same root cause). The token IS the share link by design, so URL visibility is not a leak.

**Login gate** ([App.tsx](apps/web/src/components/App.tsx)):
```ts
if (forceLogin || (!guestToken && (status === 'unauthenticated' || showLogin))) {
  return <LoginPage onEnter={() => { setShowLogin(false); setForceLogin(false); }} />;
}
```
- `forceLogin` short-circuits the `!guestToken` bypass so a guest can explicitly invoke LoginPage while still keeping `guestToken` set for the post-login claim effect.
- Do **NOT** add `status !== 'authenticated'` to the outer condition — it unmounts LoginPage mid-animation. The 1500ms animation completes only when `onEnter()` clears both flags.

**Claim-on-login effect** ([App.tsx:310-319](apps/web/src/components/App.tsx#L310-L319)):
```ts
useEffect(() => {
  if (status !== 'authenticated' || !idToken || !guestToken || hasClaimedRef.current) return;
  hasClaimedRef.current = true;
  shareApi.claimSession(guestToken, idToken)
    .then(summary => { setGuestToken(null); return loadSession(summary.sessionId); });
}, [status, idToken, guestToken, loadSession]);
```

### 401 handler is gated on `idToken`
`apiFetch` only fires `unauthorizedHandler?.()` when the request actually carried a token:
```ts
if (res.status === 401 && idToken) unauthorizedHandler?.();
```
Without the `&& idToken` guard, a guest who accidentally hits an authed endpoint (e.g. `updateSessionNotionUrl` with empty `idToken`) gets bounced to login by `signOut()`. The handler is for *expired* sessions only, never *missing* ones.

### Guest UI rules
- `idToken` only — `History` button visible.
- `guestToken && !idToken` — `Login to Save` button visible next to where History would be. `ShareButton` is NOT rendered (sharing is host-only).
- `Save to Notion` (inside MindMap) calls `setForceLogin(true)` for guests rather than opening the picker.

---

## Web search

All three LLM call types support an optional `webSearch` flag. When `true`, the Anthropic API is called with `tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]`. The toggle lives in TweaksPanel and is persisted via `useTweaks` under the `webSearch` key (default `false`). It is forwarded through the full stack:

```
TweaksPanel → tweaks.webSearch → submitRootQuery / expandSectionAsChild / askFromHighlight
  → createSessionStream / createNode (api.ts)
  → POST /sessions/stream, POST /sessions/:id/nodes (webSearch field in body)
  → SessionsService / NodesService → LlmService.streamAnswerQuery / answerQuery / expandSection / followUpFromHighlight
```

The `webSearch` param is optional everywhere and defaults to `false`, so all existing behaviour is unchanged when the toggle is off.

---

## Email — OTP verification

Cognito sends OTP verification emails via **Amazon SES** (`ap-south-1`) from `fork.ai <verify@forkai.in>`.

- SES domain: `forkai.in` — DKIM verified, DNS records in Route 53
- A `CustomMessage` Lambda trigger (`forkai-cognito-custom-email`) intercepts `CustomMessage_SignUp`, `CustomMessage_ResendCode`, and `CustomMessage_ForgotPassword` events and returns a branded HTML email body
- Lambda + email config are always updated in **one `update-user-pool` call** — updating them separately resets whichever field is omitted
- Source: `infra/lambda/cognito-custom-email/` — `index.js` (template) + `setup.sh` (full one-shot deploy)
- SES sandbox: still active — recipients must be verified until AWS approves production access

---

## AWS CLI v1 — known quirks

The project uses AWS CLI v1 (not v2). Two patterns that differ from v2:

### Structured parameters require `--cli-input-json file://`

AWS CLI v1 does **not** accept inline JSON or `file://` for parameters like `--lambda-config` and `--email-configuration`. It tries to parse them as shorthand (`Key=Value`) and fails with `Expected: '=', received: 'EOF'`.

The working pattern: write JSON to a temp file and pass via `--cli-input-json`:

```bash
printf '{"UserPoolId":"%s","LambdaConfig":{"CustomMessage":"%s"}}\n' \
  "${POOL_ID}" "${LAMBDA_ARN}" > /tmp/update.json

aws cognito-idp update-user-pool \
  --region "${REGION}" \
  --cli-input-json "file:///tmp/update.json"
```

Use `printf` (not heredoc + jq) to build the JSON — jq failures inside `$()` are silently swallowed by bash even with `set -euo pipefail`, leaving variables empty and producing invalid JSON.

### `sesv2 create-email-identity` — DKIM attribute key name

AWS CLI v1 does not support `SigningAttributesOrigin=AWS_SES`. Use `NextSigningKeyLength=RSA_2048_BIT` instead to get the same AWS-managed Easy DKIM:

```bash
aws sesv2 create-email-identity \
  --email-identity "forkai.in" \
  --dkim-signing-attributes NextSigningKeyLength=RSA_2048_BIT \
  --region "ap-south-1"
```

---

## Custom slash commands

| Command | Purpose |
|---|---|
| `/grill-me` | Ask targeted clarifying questions before starting any implementation task |
| `/caveman` | Ultra-compressed terse mode — drops filler, keeps full technical accuracy |
