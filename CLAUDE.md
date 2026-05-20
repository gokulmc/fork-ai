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
- The Notion API rejects blocks with inline `children` in `pages.create`. The client splits the nested block tree into `{ blocks: FlatBlock[], childrenMap: ChildEntry[] }` before sending; the server depth-first appends each level via `blocks.children.append`.
- Toggle heading text colour is set on `rich_text[].annotations.color`, NOT on the block-level `color` field (block-level `color` sets the background).
- Empty string `''` stored in `notionPageUrl` DynamoDB field means "cleared" — `toSummary` maps it to `null` via `|| null`.

---

## LLM call types (all fired server-side by NestJS)

| Function | Trigger | Sections returned |
|---|---|---|
| `answerQuery(query, n=5)` | New root query (`POST /sessions`) | 5 sections |
| `expandSection(rootQuery, heading, body)` | "Go deeper" (`POST /sessions/:id/nodes` with `kind: DEEPER`) | 3–4 sections |
| `followUpFromHighlight(rootQuery, highlight, question)` | "Ask AI" (`POST /sessions/:id/nodes` with `kind: ASK`) | 3–4 sections |

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
| Live URL | `https://prod.d2ej36ff5hc50c.amplifyapp.com` |

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

## Custom slash commands

| Command | Purpose |
|---|---|
| `/grill-me` | Ask targeted clarifying questions before starting any implementation task |
| `/caveman` | Ultra-compressed terse mode — drops filler, keeps full technical accuracy |
