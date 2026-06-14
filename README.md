# fork.ai

A branching research workspace. Ask a question, get a structured AI-generated answer split into sections, then explore any section deeper or highlight any passage and ask a follow-up. Every branch becomes a node on a live mind map.

---

## What it does

- **Query** — type a question and get a structured answer with 5 sections
- **Go deeper** — expand any section into its own focused deep-dive (3–4 sections)
- **Ask AI** — highlight any passage and ask a follow-up question that branches from it
- **Mind map** — every node is laid out as an interactive tree with pan, zoom, and fit-to-view
- **Highlights** — save colored highlights on any text passage, persisted per session
- **Notes & callouts** — save excerpts as notes or callouts in a slide-out drawer
- **History** — browse and resume past sessions

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15, React 19, next-auth v5 |
| Backend | NestJS, Passport JWT |
| Database | DynamoDB (single-table) |
| Auth | AWS Cognito (OIDC / RS256 JWT) |
| AI | Anthropic Claude (`claude-sonnet-4-6`) |
| Monorepo | Nx + npm workspaces |

---

## Repository layout

```
fork-ai/
├── apps/
│   ├── api/          # NestJS backend (port 3000)
│   └── web/          # Next.js 15 frontend (port 3001)
├── _prototype/       # Original vanilla JS prototype (reference only)
├── nx.json
├── tsconfig.base.json
└── package.json
```

---

## Getting started

### Prerequisites

- Node.js 20+
- AWS account with:
  - Cognito User Pool configured
  - DynamoDB table named `forkai-main` (or set via env)
- Anthropic API key

### Install

```bash
npm install
```

### Environment variables

**`apps/api/.env`**

```env
COGNITO_USER_POOL_ID=ap-south-1_xxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-...
AWS_REGION=ap-south-1
DYNAMO_TABLE_NAME=forkai-main
PORT=3000
```

**`apps/web/.env.local`**

```env
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_USER_POOL_ID=ap-south-1_xxxxxxxx
AWS_REGION=ap-south-1
NEXTAUTH_SECRET=any-random-string
NEXTAUTH_URL=http://localhost:3001
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
```

### Run

```bash
# Both apps in parallel
npm run dev

# Individual apps
npm run dev:api   # NestJS on :3000
npm run dev:web   # Next.js on :3001
```

**Open the app in a real browser** (Chrome / Safari / Edge) at the exact origin in `NEXTAUTH_URL` — e.g. `http://localhost:3001`. Use that same host:port you logged in on; next-auth cookies are bound to it, so a different origin shows you as logged out (no History).

> ⚠️ **Don't use the VS Code "Simple Browser".** Its sandbox blocks the cross-origin `fetch` to the API and drops the auth cookie, so every request fails with `Failed to fetch` and History never loads — even when both servers are healthy. This is a limitation of the embedded webview, not the app. Open a normal browser instead.
>
> **LAN / phone testing:** when serving on the machine's LAN IP, the web dev port and ports may differ from the defaults — `apps/web/package.json` hardcodes `next dev -p 3001`, so launch web on the env's port explicitly (`cd apps/web && npx next dev -p <port>`) and open `http://<lan-ip>:<port>` (the exact `NEXTAUTH_URL`).

Swagger docs are available at `http://localhost:3000/api` when the backend is running.

---

## Architecture

```
Browser (Next.js :3001)
    │  Authorization: Bearer <Cognito id_token>
    ▼
NestJS API (:3000)
    ├── Cognito JWKS  — offline JWT validation
    ├── DynamoDB      — sessions, nodes, annotations, highlights
    └── Anthropic API — answerQuery, expandSection, followUpFromHighlight
```

**The frontend never calls Anthropic directly.** All LLM work goes through the NestJS backend.

### DynamoDB access patterns

| PK | SK | Item |
|---|---|---|
| `USER#<sub>` | `METADATA` | User profile |
| `USER#<sub>` | `SESSION#<id>` | Session metadata |
| `SESSION#<id>` | `NODE#<id>` | Research node |
| `SESSION#<id>` | `ANN#<id>` | Annotation |
| `SESSION#<id>` | `HL#<id>` | Highlight |

GSI-1 on `gsi1pk` / `gsi1sk` powers session listing sorted by last activity.

### LLM call types

| Function | Trigger | Sections |
|---|---|---|
| `answerQuery` | New root query | 5 |
| `expandSection` | "Go deeper" | 3–4 |
| `followUpFromHighlight` | "Ask AI" on highlight | 3–4 |

All three receive the full ancestor chain (root → current node) for context, and return `{ title, emoji, lede, sections[] }`.

Streaming uses Server-Sent Events — the backend pipes LLM output to the client as sections are parsed, so the UI populates progressively.

---

## Scripts

```bash
npm run dev          # start both apps
npm run build        # build both apps (Nx-cached)
npm run test         # run all tests (Nx-cached)
npm run type-check   # TypeScript check across both apps
```

---

## Conventions

- TypeScript strict mode, no `any`
- No direct Anthropic calls from the frontend
- Single-table DynamoDB — all session data fetched in one `query` per session load
- Tree structure is implicit — only `parentId` is stored; the tree is reconstructed at read time
