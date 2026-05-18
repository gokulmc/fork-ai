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
    ├── DynamoDB      — sessions, nodes, annotations, highlights
    └── Anthropic API — LLM calls (answerQuery, expandSection, followUpFromHighlight)
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
persistentHl: Record<string, Array<{ text: string; bg: string | null; fg: string | null }>>
```

Applied to the DOM by walking text nodes and wrapping matches in `<span class="persistent-hl">`.

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

## Custom slash commands

| Command | Purpose |
|---|---|
| `/grill-me` | Ask targeted clarifying questions before starting any implementation task |
