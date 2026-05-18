# fork.ai - Codex Context

Use this alongside `CLAUDE.md`. The Claude files describe the intended architecture; this file captures the repo as inspected on 2026-05-18.

## Product Shape

fork.ai is a branching research workspace. A user asks a root question, receives a structured answer split into sections, then branches by either:

- clicking "Go deeper" on a section, creating a `DEEPER` child node
- highlighting text and asking a follow-up, creating an `ASK` child node

The full research graph is stored as a flat node map and rendered as a mind map. Notes, callouts, and persistent highlights are stored separately under the same session.

## Monorepo

- Root is an Nx + npm workspaces repo.
- `apps/api` is a NestJS 11 backend on port `3000`.
- `apps/web` is a Next.js 15 App Router frontend on port `3001`.
- `_prototype` is reference-only vanilla/prototype UI. Do not edit it for production changes.
- Root scripts:
  - `npm run dev`
  - `npm run dev:api`
  - `npm run dev:web`
  - `npm run build`
  - `npm run test`
  - `npm run type-check`

## Non-Negotiable Architecture Rules

- The frontend must not call Anthropic directly. All LLM calls go through `apps/api`.
- Do not introduce architecture-level changes without explicit confirmation: auth stack, database, ORM/data layer, state-management architecture, build tooling, or major runtime dependencies.
- Keep TypeScript strict. Avoid `any`.
- Treat `_prototype` as behavior/design reference only.

## Backend Reality

Main modules:

- `auth`: Cognito JWT auth via `passport-jwt` and `jwks-rsa`; `JwtAuthGuard` is global through `APP_GUARD`.
- `dynamo`: `DynamoRepository` wraps DynamoDB document client operations.
- `sessions`: session CRUD and root query creation.
- `nodes`: branch creation, rename, branch delete.
- `annotations`: note/callout persistence.
- `highlights`: persistent highlight persistence.
- `llm`: Anthropic calls and streaming JSON extraction.

Important backend files:

- `apps/api/src/main.ts`: CORS, global `ValidationPipe`, Swagger at `/api`.
- `apps/api/src/config/configuration.ts`: Joi env validation.
- `apps/api/src/sessions/sessions.controller.ts`: includes `POST /sessions/stream`, an SSE endpoint not mentioned in older docs.
- `apps/api/src/sessions/sessions.service.ts`: creates root node, persists session metadata, lists/loads sessions.
- `apps/api/src/nodes/nodes.service.ts`: loads full session, builds ancestor trail, calls LLM for `DEEPER`/`ASK`.
- `apps/api/src/llm/llm.service.ts`: uses model `claude-sonnet-4-6`; prompts for JSON-only structured sections.

Data model in DynamoDB:

- User metadata: `PK=USER#{sub}`, `SK=METADATA`
- Session metadata: `PK=USER#{sub}`, `SK=SESSION#{sessionId}`
- Session items: `PK=SESSION#{sessionId}` with `SK=NODE#...`, `ANN#...`, `HL#...`
- GSI `gsi1` uses `gsi1pk=USER#{sub}`, `gsi1sk=UPDATED#{isoTimestamp}` for newest-first sessions.

Backend routes:

- `GET /users/me`
- `GET /sessions`
- `POST /sessions`
- `POST /sessions/stream`
- `GET /sessions/:sessionId`
- `PATCH /sessions/:sessionId`
- `DELETE /sessions/:sessionId`
- `POST /sessions/:sessionId/nodes`
- `PATCH /sessions/:sessionId/nodes/:nodeId`
- `DELETE /sessions/:sessionId/nodes/:nodeId`
- `GET /sessions/:sessionId/annotations`
- `POST /sessions/:sessionId/annotations`
- `DELETE /sessions/:sessionId/annotations/:annId`
- `POST /sessions/:sessionId/highlights`
- `PATCH /sessions/:sessionId/highlights/:hlId`
- `DELETE /sessions/:sessionId/highlights/:hlId`

## Frontend Reality

Main stack:

- Next.js 15, React 19, TypeScript
- Auth.js/next-auth v5 with Cognito in `apps/web/src/auth.ts`
- `marked` and `highlight.js` for markdown/code rendering
- Custom SVG icon factory in `apps/web/src/components/Icons.tsx`
- Global CSS design system in `apps/web/src/app/globals.css`

Important frontend files:

- `apps/web/src/components/App.tsx`: root client state and most app behavior.
- `apps/web/src/lib/api.ts`: only frontend client for NestJS. Includes SSE `createSessionStream`.
- `apps/web/src/components/MindMap.tsx`: SVG tree layout, pan/zoom, fit, context menu entry.
- `apps/web/src/components/Section.tsx`: markdown render, code highlighting, persistent highlight application, triple/quad click selection helpers.
- `apps/web/src/components/HighlightMenu.tsx`: text-selection action menu.
- `apps/web/src/components/FollowUpPop.tsx`: follow-up question popup.
- `apps/web/src/components/NotesDrawer.tsx`: notes/callouts drawer.
- `apps/web/src/components/HistoryPage.tsx`: session history UI.
- `apps/web/src/middleware.ts`: currently bypasses auth for local testing.

Current frontend flow:

- `App.tsx` reads `useSession`; if no id token it uses `'dev-bypass'` for local testing.
- It lists sessions on load through `listSessions(idToken)`.
- Root query uses `createSessionStream`, immediately renders an optimistic root node, streams `meta` and `section` events, then swaps the temp node id for the persisted node id on `done`.
- "Go deeper" creates an optimistic child and replaces it with the API response from `POST /sessions/:id/nodes`.
- "Ask AI" creates an optimistic child from highlighted text and persists a highlight.
- Highlights are stored in `persistentHl` keyed by `${nodeId}::${sectionId}` and are baked into section HTML with DOMParser on render.
- Notes/callouts are optimistic, then replaced with API ids after persistence.

## Known Drift / Risk Areas

- `apps/web/CLAUDE.md` has a "Build order" section that is partly stale. Auth route, API client, CSS, dashboard/history, and middleware already exist.
- Backend tests appear stale around LLM signatures. `NodesService` and `LlmService` now pass/use an ancestor trail array, while some specs still expect a plain root-query string.
- `renameSession`, `renameNode`, and highlight update endpoints may return `void` on the backend while the frontend API types currently expect returned objects in places.
- `apps/web/src/middleware.ts` and `App.tsx` intentionally bypass auth for local testing. Revisit before production behavior.
- The current worktree was dirty before this context file was added. Do not revert unrelated changes.

## Environment Notes

Do not copy real secrets into docs or commits. The relevant example file currently present is:

- `apps/web/.env.local.example`

The backend requires, at minimum, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `DYNAMO_TABLE_NAME`, `ANTHROPIC_API_KEY`, and optional `PORT`.

## Working Style For Future Codex Turns

- Read the relevant `CLAUDE.md` first, then this file.
- Prefer small, scoped edits that follow existing app structure.
- Use `apps/web/src/lib/api.ts` for frontend/backend calls.
- Use `DynamoRepository` for backend persistence.
- If touching the LLM behavior, keep JSON response parsing and frontend response shapes in sync.
- If touching branch/session behavior, verify both the optimistic UI state and the persisted DynamoDB shape.
