# fork.ai — Backend (NestJS)

> See root `CLAUDE.md` for shared data model, architecture overview, and project context.

## Stack

| Layer | Choice |
|---|---|
| Framework | NestJS 11, TypeScript strict |
| Database | AWS DynamoDB — single-table design |
| Auth | AWS Cognito User Pool — JWT validated via `jwks-rsa` (no Cognito API call per request) |
| LLM | Anthropic Claude (`@anthropic-ai/sdk`) + Google Gemini (`@google/genai`) + DeepSeek (via Anthropic-compat endpoint, reuses `@anthropic-ai/sdk`) behind a provider abstraction |
| ID generation | `ulid` (lexicographically sortable — used as DynamoDB sort key) |
| API style | REST + OpenAPI (Swagger at `/api`) |
| Port | **3000** (default) |

---

## Module layout

```
backend/src/
├── main.ts                         # Bootstrap, Swagger, ValidationPipe, CORS
├── app.module.ts                   # Wires all modules; APP_GUARD = JwtAuthGuard
├── config/configuration.ts         # Joi-validated env vars
├── dynamo/
│   ├── dynamo.module.ts            # DynamoDBDocumentClient provider
│   └── dynamo.repository.ts        # put/get/query/update/batchDelete helpers
├── auth/
│   ├── jwt.strategy.ts             # passport-jwt + jwks-rsa (Cognito JWKS)
│   ├── jwt-auth.guard.ts           # applied globally via APP_GUARD
│   ├── current-user.decorator.ts   # @CurrentUser() → { sub, email }
│   └── public.decorator.ts         # @Public() skips guard (health check)
├── users/                          # GET /users/me; auto-upsert on first request
├── sessions/                       # CRUD — create fires LLM answerQuery
├── nodes/                          # Branch creation fires expandSection or followUpFromHighlight
├── annotations/                    # Notes and callouts
├── highlights/                     # Persistent text highlight marks
├── notion/
│   ├── notion.module.ts            # Imports DynamoModule
│   ├── notion.controller.ts        # GET /notion/auth|callback|status|pages, POST /notion/push
│   └── notion.service.ts           # OAuth flow, token storage, page push (recursive append)
└── llm/
    ├── llm.service.ts              # Orchestrator: prompts, streaming, JSON parse, callJson → provider
    ├── models.ts                   # Aliases ↔ model ids, per-model pricing, resolveBranchModel, providerNameFor
    ├── citations.ts                # Anthropic <cite> + Gemini grounding → numbered footnotes
    └── providers/                  # LlmProvider abstraction
        ├── provider.types.ts       # complete() interface
        ├── anthropic.provider.ts   # @anthropic-ai/sdk
        ├── gemini.provider.ts      # @google/genai (lazy client; branch calls only)
        └── deepseek.provider.ts    # DeepSeek V4 via api.deepseek.com/anthropic (reuses @anthropic-ai/sdk; no web search)
```

---

## REST API surface

```
GET    /users/me

GET    /sessions                              # list, newest first (GSI-1 query)
POST   /sessions                             # create session + fire answerQuery → root node
GET    /sessions/:sessionId                  # full load — all nodes + annotations + highlights
PATCH  /sessions/:sessionId                  # rename session title
DELETE /sessions/:sessionId                  # delete session + all children (BatchWriteItem)

POST   /sessions/:sessionId/nodes            # branch: fires DEEPER or ASK LLM call
PATCH  /sessions/:sessionId/nodes/:nodeId    # rename node title
DELETE /sessions/:sessionId/nodes/:nodeId    # delete branch + all descendants (BFS)

GET    /sessions/:sessionId/annotations
POST   /sessions/:sessionId/annotations
DELETE /sessions/:sessionId/annotations/:annId

POST   /sessions/:sessionId/highlights
PATCH  /sessions/:sessionId/highlights/:hlId
DELETE /sessions/:sessionId/highlights/:hlId

GET    /notion/auth                           # redirect to Notion OAuth (authenticated)
GET    /notion/callback                       # @Public — exchanges code, saves token, redirects to frontend
GET    /notion/status                         # { connected: boolean }
GET    /notion/pages?q=...                    # search user's Notion pages (for parent picker)
POST   /notion/push                           # create Notion page from session blocks
```

### Key DTOs

**`POST /sessions`** body:
```json
{ "query": "How do neural networks learn?", "sectionCount": 5 }
```

**`POST /sessions/:id/nodes`** body:
```json
{
  "kind": "DEEPER" | "ASK",
  "parentNodeId": "01HZ...",
  "fromSection": "secA",
  "query": "Backpropagation in detail",
  "sectionBody": "...",       // for DEEPER
  "highlightText": "..."      // for ASK
}
```

**`GET /sessions/:id`** response shape:
```json
{
  "sessionId": "...",
  "title": "...",
  "emoji": "🧠",
  "lede": "...",
  "nodes": [...],
  "annotations": [...],
  "highlights": [...]
}
```

---

## DynamoDB single-table: `forkai-main`

| Entity | PK | SK |
|---|---|---|
| User | `USER#{sub}` | `METADATA` |
| Session | `USER#{sub}` | `SESSION#{ulid}` |
| Node | `SESSION#{id}` | `NODE#{ulid}` |
| Annotation | `SESSION#{id}` | `ANN#{ulid}` |
| Highlight | `SESSION#{id}` | `HL#{ulid}` |

**GSI-1** (`gsi1pk` / `gsi1sk`): `USER#{sub}` / `UPDATED#{isoTimestamp}` — powers newest-first session listing.

### Access patterns

| Pattern | Operation |
|---|---|
| List sessions for user (newest first) | GSI-1 query, `ScanIndexForward=false` |
| Load full session (nodes + annotations + highlights) | Query `PK=SESSION#{id}` — one roundtrip |
| Point-read a node | GetItem |
| Delete branch + descendants | App BFS-collects IDs, `BatchWriteItem` in chunks of 25 |

---

## Auth flow

1. Cognito issues a JWT `id_token` after user logs in (via Hosted UI / OAuth2 PKCE).
2. Frontend sends `Authorization: Bearer <id_token>` on every request.
3. `JwtAuthGuard` → `JwtStrategy` validates the token using Cognito's public JWKS (fetched once, cached by `jwks-rsa`).
4. The `sub` claim becomes the stable user ID for all DynamoDB keys.

No Cognito Admin API call per request — purely offline JWT validation.

---

## Environment variables

```bash
AWS_REGION=ap-south-1
COGNITO_USER_POOL_ID=ap-south-1_XXXXX
COGNITO_CLIENT_ID=XXXXXXXXXXXXX
DYNAMO_TABLE_NAME=forkai-main
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...              # optional — only needed for Gemini branch models
DEEPSEEK_API_KEY=sk-...             # optional — only needed for DeepSeek branch models
PORT=3000                           # optional, defaults to 3000
CORS_ORIGIN=http://localhost:3001   # Next.js dev server
FRONTEND_URL=http://localhost:3001  # used for Notion OAuth redirect

# Notion OAuth — create a Public integration at https://www.notion.com/my-integrations
# Set redirect URI to: http://localhost:3000/notion/callback
NOTION_CLIENT_ID=
NOTION_CLIENT_SECRET=
NOTION_REDIRECT_URI=http://localhost:3000/notion/callback
```

---

## Root-query streaming — persist-first / `init` event (IMPORTANT)

Both `SessionsService.createStreaming` (`POST /sessions/stream`) and `createTrialSessionStreaming` (`POST /share`) persist the session + root node to DynamoDB **before** the LLM stream and emit an **`init`** SSE event (`{ type: 'init', sessionId, nodeId, token? }`) up-front, re-`putNode` incrementally per section, and finalise at `done` (final `putNode` + `updateSessionMeta`). `send` is wrapped in a swallow-errors `emit()` so a client disconnect (refresh) doesn't abort the loop — the full result still persists. This is what lets a refresh *during* the root stream restore the real session instead of dropping the user to Landing. See root `CLAUDE.md` → "Root-query streaming". **Do not move session persistence back to the `done` block only.**

The History list reads `SessionMetaItem` (not the node). The up-front write makes the session *accessible* with a placeholder `title` (`query.slice(0,60)`) and empty `emoji`; the real values are applied at `done` via **`updateSessionMeta(sub, sessionId, { title, emoji, lede })`** — a partial **update**, not a `putSessionMeta` full replace. Because the loop runs to completion server-side after a disconnect, a tab closed mid-stream still gets the correct title/emoji once `done` lands. `updateSessionMeta`'s allowlisted fields include `emoji`/`lede` for this.

---

## Coding conventions

- **Repository pattern** — business logic never touches `DynamoDBDocumentClient` directly; always goes through `DynamoRepository`
- **DTOs** with `class-validator` decorators on all request bodies
- **Swagger** — every DTO field and controller route must have `@ApiProperty` / `@ApiOperation`
- **Error handling** — throw NestJS `HttpException` subclasses; never leak stack traces to the client
- **No over-engineering** — if a helper is only used once, inline it
- `@Public()` decorator marks routes that bypass `JwtAuthGuard` (health check, etc.)

---

## Testing patterns

- **Unit specs** (`*.spec.ts`) — mock `DynamoRepository` and `LlmService` with `jest.spyOn`; no real AWS calls
- **E2E** (`test/app.e2e-spec.ts`) — bypass `JwtAuthGuard` via `jest.spyOn(JwtAuthGuard.prototype, 'canActivate')` (standard `overrideGuard` does not work for global `APP_GUARD` in NestJS v11)
- **ESM `jose` package** — `jest.e2e.config.js` needs `transformIgnorePatterns: ['node_modules/(?!(jose)/)']`
- **Env vars in e2e** — set `process.env` at the top of the e2e file, before any imports, or ConfigModule Joi validation fails

---

## Run

```bash
# From repo root:
npm run dev:api      # nodemon + ts-node (hot-reloads on src/**/*.ts changes), port 3000
npm run test         # unit specs (Nx-cached)
```
