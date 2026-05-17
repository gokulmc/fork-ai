# fork.ai — Claude Code Context

## What this project is

**fork.ai** is a branching research workspace. A user types a question, gets a structured answer split into sections, and can explore any section into a child node ("Go deeper"), or highlight any passage and branch from it ("Ask AI"). Every branch becomes a node on a live mind map. Notes and callouts can be saved from highlights.

The project currently has a **working frontend prototype** (vanilla HTML + React via Babel standalone). The next phase is building a **production NestJS backend** to replace the in-browser `window.claude.complete` calls with real Anthropic API calls, and to persist all session data.

---

## Repository structure

```
fork ai/
├── CLAUDE.md               ← you are here
├── fork.ai.html            ← entry point (loads all scripts)
├── styles.css              ← full design system (Notion-white aesthetic, dark mode)
├── llm.js                  ← LLM bridge (currently calls window.claude.complete)
├── app.jsx                 ← root state, landing page, full composition
├── icons.jsx               ← Lucide-style SVG icons
├── mindmap.jsx             ← pannable/zoomable SVG mind map
├── workspace.jsx           ← section renderer, highlight menu, follow-up popup
├── notes.jsx               ← slide-out notes & callouts drawer
└── tweaks-panel.jsx        ← floating tweaks panel (theme, font, density, map layout)
```

Backend will live in `backend/` (NestJS monorepo, to be scaffolded).

---

## Frontend — key concepts

### Node (the core data unit)

Every piece of content in the app is a **node**. The app state is a flat map `{ [id]: node }`.

```ts
interface Node {
  id: string;            // uid() — timestamp-based
  parentId: string|null; // null = root node
  kind: "QUERY" | "DEEPER" | "ASK";
  title: string;         // ≤5 words, shown on mind map card
  emoji: string;         // single emoji, from LLM
  query: string;         // the user's original question / section heading
  lede: string;          // one-sentence summary from LLM
  sections: Section[];   // ALL text content lives here, nested
  fromSection: string;   // id of the parent section that spawned this node
  fromText: string;      // source snippet (first 200 chars of section, or highlight text)
  createdAt: number;     // Date.now()
  loading: boolean;
  error?: string;
}

interface Section {
  id: string;
  heading: string;
  body: string;          // GitHub-flavoured markdown
}
```

**Sections are nested inside nodes** — they are never queried independently.

### Parent/child relationships

No child-pointer arrays. The tree is reconstructed by scanning all nodes and grouping by `parentId`. `mindmap.jsx` builds a `childMap` this way. Breadcrumbs walk upward via `parentId`.

The `fromSection` field on a child node links it back to the exact section in its parent that spawned it — this is how section-level child chips are rendered in the workspace.

### Highlights (`persistentHl`)

```ts
// keyed by "nodeId::sectionId"
persistentHl: Record<string, Array<{ text: string; bg: string|null; fg: string|null }>>
```

Stored separately from nodes. Applied to the DOM by walking text nodes and wrapping matches in `<span class="persistent-hl">` (see `wrapTextInElement` in `app.jsx`).

### Annotations

```ts
interface Annotation {
  id: string;
  kind: "note" | "callout";
  text: string;          // the selected passage
  fromTitle: string;     // display name of source node
  nodeId: string;
  sectionId: string;
  createdAt: number;
}
```

Notes → saved to drawer + persistent highlight mark in text.  
Callouts → saved to drawer + rendered as a grey block below the section (no highlight mark).

### LLM calls (3 types, in `llm.js`)

| Function | Trigger | Sections returned |
|---|---|---|
| `answerQuery(query, n=5)` | New root query | 5 sections |
| `expandSection(rootQuery, heading, body)` | "Go deeper" button | 3–4 sections |
| `followUpFromHighlight(rootQuery, highlight, question)` | "Ask AI" from selection | 3–4 sections |

All three return the same JSON shape:
```json
{
  "title": "≤5 words",
  "emoji": "🧠",
  "lede": "One sentence.",
  "sections": [{ "heading": "...", "body": "markdown..." }]
}
```

---

## Backend plan — NestJS + DynamoDB + Cognito

### Tech stack

| Layer | Choice |
|---|---|
| Framework | NestJS (TypeScript strict) |
| Database | AWS DynamoDB — single-table design |
| Auth | AWS Cognito User Pool — email/password + Google/Apple OAuth |
| LLM | Anthropic Claude API (`@anthropic-ai/sdk`) |
| ID generation | `ulid` (lexicographically sortable — works as DynamoDB sort key) |
| API style | REST + OpenAPI (Swagger via `@nestjs/swagger`) |
| Deployment | TBD (likely ECS Fargate or Lambda) |

### DynamoDB table: `forkai-main`

Single table. One query per session load.

| Entity | PK | SK |
|---|---|---|
| User | `USER#{cognitoSub}` | `METADATA` |
| Research Session | `USER#{cognitoSub}` | `SESSION#{ulid}` |
| Node | `SESSION#{sessionId}` | `NODE#{ulid}` |
| Annotation | `SESSION#{sessionId}` | `ANN#{ulid}` |

**GSI-1** (`gsi1pk` / `gsi1sk`): powers "list sessions sorted by last activity"
- `gsi1pk = USER#{sub}`, `gsi1sk = UPDATED#{isoTimestamp}`

**Node DynamoDB item** (sections + highlights stored as nested attributes — never queried individually):
```json
{
  "PK": "SESSION#01HZ...",
  "SK": "NODE#01HZ...",
  "parentId": "NODE#01HY...",
  "kind": "DEEPER",
  "title": "Backpropagation Deep Dive",
  "emoji": "🧠",
  "query": "Backpropagation",
  "lede": "How gradients flow backward through layers.",
  "fromSection": "secA",
  "fromText": "Backpropagation: the core mechanism...",
  "sections": [
    { "id": "secC", "heading": "Chain Rule", "body": "..." }
  ],
  "highlights": {
    "secC": [{ "text": "chain rule", "bg": "#fef08a", "fg": null }]
  },
  "createdAt": "2026-05-17T10:00:00Z",
  "gsi1pk": "USER#cognito-sub-xyz",
  "gsi1sk": "UPDATED#2026-05-17T10:05:00Z"
}
```

### Access patterns

| Pattern | DynamoDB operation |
|---|---|
| List sessions for user (newest first) | GSI-1 query on `USER#{sub}`, ScanIndexForward=false |
| Load full session (all nodes + annotations) | Query `PK=SESSION#{id}` — one roundtrip |
| Point-read a node | GetItem `SESSION#{id}` + `NODE#{id}` |
| Delete a branch + descendants | App collects descendant IDs, BatchWriteItem |

### NestJS module layout (planned)

```
backend/src/
├── main.ts                       # Bootstrap, Swagger, global pipes/filters
├── app.module.ts
├── config/configuration.ts       # Joi-validated env vars
├── dynamo/
│   ├── dynamo.module.ts          # DynamoDBDocumentClient provider
│   └── dynamo.repository.ts      # put/get/query/update/batchDelete helpers
├── auth/
│   ├── jwt.strategy.ts           # passport-jwt + jwks-rsa (Cognito JWKS)
│   ├── jwt-auth.guard.ts         # applied globally
│   ├── current-user.decorator.ts # @CurrentUser() → { sub, email }
│   └── public.decorator.ts       # @Public() for health check
├── users/                        # GET /users/me, auto-upsert on first request
├── sessions/                     # CRUD /sessions — create triggers LLM answerQuery
├── nodes/                        # POST/PATCH/DELETE /sessions/:id/nodes/:nodeId
├── annotations/                  # CRUD /sessions/:id/annotations
└── llm/
    └── llm.service.ts            # Anthropic SDK — 3 prompt functions from llm.js
```

### REST API surface

```
GET    /users/me

GET    /sessions                            # list, paginated, newest first
POST   /sessions                           # create + fire answerQuery → root node
GET    /sessions/:id                       # full session — all nodes + annotations
DELETE /sessions/:id

POST   /sessions/:id/nodes                 # add branch (kind + parentNodeId + context)
PATCH  /sessions/:id/nodes/:nodeId         # rename
DELETE /sessions/:id/nodes/:nodeId         # delete branch + descendants

GET    /sessions/:id/annotations
POST   /sessions/:id/annotations           # create note or callout
DELETE /sessions/:id/annotations/:annId
```

### Auth flow

Cognito issues a JWT (`id_token`) after login. NestJS validates it on every request via `jwks-rsa` (fetches Cognito's public JWKS once, caches it). The `sub` claim is the stable user ID used as DynamoDB partition key. No Cognito API call per request.

---

## Environment variables

```
AWS_REGION=ap-south-1
COGNITO_USER_POOL_ID=ap-south-1_XXXXX
COGNITO_CLIENT_ID=XXXXXXXXXXXXX
DYNAMO_TABLE_NAME=forkai-main
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Coding conventions

- **TypeScript strict** throughout — no `any`
- **DTOs** with `class-validator` decorators on all request bodies
- **Repository pattern** — business logic never touches the DynamoDB client directly
- **No over-engineering** — if a helper is only used once, inline it
- **Comments only for non-obvious WHY** — not what the code does
- **Swagger** — every DTO field and controller route annotated with `@ApiProperty` / `@ApiOperation`
- **Error handling** — throw NestJS `HttpException` subclasses; never leak stack traces

---

## Custom slash commands

| Command | Purpose |
|---|---|
| `/grill-me` | Ask targeted clarifying questions before starting any implementation task |

---

## Build order (next steps)

1. `backend/` scaffold — NestJS CLI, TypeScript strict, eslint/prettier
2. Config module — env var validation with Joi
3. DynamoDB module — client + base repository
4. Auth module — Cognito JWT guard + `@CurrentUser()`
5. Users module — auto-upsert on first authenticated request
6. LLM service — port the 3 prompt functions from `llm.js` to use `@anthropic-ai/sdk`
7. Sessions module — create triggers LLM, persists root node
8. Nodes module — branch creation triggers LLM, persists child, updates session `updatedAt`
9. Annotations module
10. Swagger annotations
11. Update frontend `llm.js` to call the NestJS API instead of `window.claude.complete`
