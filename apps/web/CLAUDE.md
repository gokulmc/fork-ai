# fork.ai — Frontend (Next.js 16)

> See root `CLAUDE.md` for shared data model, architecture overview, and project context.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16, App Router, TypeScript strict |
| Auth | `next-auth` v5 (Auth.js) with Cognito as OAuth2 provider |
| State | React 19 hooks — local state, synced to NestJS REST API |
| Markdown | `marked` v15 (GFM, synchronous parse) |
| Syntax highlight | `highlight.js` v11 |
| Icons | Custom `make()` factory in `src/components/Icons.tsx` |
| Port | **3001** (run with `npm run dev -- -p 3001`) |

---

## Critical architecture rule

> **The Next.js app never calls Anthropic directly.**
>
> All LLM work goes through the NestJS backend at `NEXT_PUBLIC_API_BASE_URL`.
> Any `/api/llm/*` route files inside this project are from a discarded approach and must be **deleted**.

### Files that must be deleted

```
src/app/api/llm/answer/route.ts   ← WRONG — direct Anthropic call
src/app/api/llm/expand/route.ts   ← WRONG
src/app/api/llm/followup/route.ts ← WRONG
src/lib/llm.ts                    ← WRONG — called those routes
```

---

## Project structure

```
frontend/
├── .env.local.example
├── next.config.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout — Google Fonts <link>, theme-aware favicon <link>s, imports globals.css
│   │   ├── globals.css         # Full design system (ported from styles.css)
│   │   ├── page.tsx            # Renders <App /> (or <SessionsDashboard /> if logged in with no active session)
│   │   └── api/
│   │       └── auth/
│   │           └── [...nextauth]/route.ts   # next-auth Cognito provider
│   ├── components/
│   │   ├── App.tsx             # Root client component — all research state
│   │   ├── Landing.tsx         # Landing page (unauthenticated or new session)
│   │   ├── HistoryPage.tsx     # Research history — date-grouped session cards + topic bubbles
│   │   ├── HistoryBubbles.tsx  # Force-directed topic-bubble cluster atop HistoryPage
│   │   ├── MindMap.tsx         # SVG mind map — pan/zoom/layout
│   │   ├── Section.tsx         # Section renderer — marked + hljs
│   │   ├── SkeletonSections.tsx
│   │   ├── HighlightMenu.tsx   # Floating menu on text selection
│   │   ├── FollowUpPop.tsx     # Follow-up question popup
│   │   ├── NotesDrawer.tsx     # Slide-out notes & callouts drawer
│   │   ├── TweaksPanel.tsx     # Draggable tweaks panel (theme, font, density, layout, maxSections)
│   │   └── Icons.tsx           # Lucide-style SVG icons via make() factory
│   ├── hooks/
│   │   └── useTweaks.ts        # useTweaks(defaults) → [values, setTweak]; persists to localStorage under fork.ai.tweaks
│   └── lib/
│       ├── types.ts            # Shared TypeScript interfaces (ForkNode, Section, Annotation, …)
│       ├── utils.ts            # uid, short5, stripMarkdown, pickEmoji, wrapTextInElement, …
│       ├── api.ts              # Typed NestJS REST client (reads id_token, sends Bearer header)
│       └── notion-clipboard.ts # Builds Notion block tree from session; splitBlocks strips inline children
```

---

## Auth: next-auth v5 + Cognito

### How it works

1. User visits the app → `useSession()` / middleware checks for a session.
2. If unauthenticated → redirect to `/api/auth/signin` (next-auth) → Cognito Hosted UI.
3. User logs in → Cognito redirects back with authorization code.
4. next-auth exchanges code for tokens. The Cognito `id_token` (JWT) is stored server-side.
5. Frontend retrieves the `id_token` from the next-auth session and sends it on every NestJS request:
   ```
   Authorization: Bearer <id_token>
   ```
6. NestJS validates the `id_token` against Cognito's public JWKS — no extra calls needed.

### next-auth configuration (`src/app/api/auth/[...nextauth]/route.ts`)

```ts
import NextAuth from 'next-auth';
import CognitoProvider from 'next-auth/providers/cognito';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    CognitoProvider({
      clientId: process.env.COGNITO_CLIENT_ID!,
      clientSecret: process.env.COGNITO_CLIENT_SECRET!,
      issuer: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Persist the Cognito id_token on the JWT so we can forward it to NestJS
      if (account?.id_token) token.idToken = account.id_token;
      return token;
    },
    async session({ session, token }) {
      // Expose id_token to the client via useSession()
      (session as Record<string, unknown>).idToken = token.idToken;
      return session;
    },
  },
});
```

---

## API client: `src/lib/api.ts`

This file is the **only** place that talks to NestJS. It reads the Cognito `id_token` from the next-auth session and attaches it as a Bearer header.

```ts
// Pattern every call follows:
async function apiFetch(path: string, init?: RequestInit, idToken?: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.status === 204 ? null : res.json();
}
```

Typed wrappers to expose:
- `createSession(query, idToken)` → `FullSession`
- `listSessions(idToken)` → `SessionSummary[]`
- `getSession(sessionId, idToken)` → `FullSession`
- `deleteSession(sessionId, idToken)` → `void`
- `createNode(sessionId, dto, idToken)` → `ForkNode`
- `renameNode(sessionId, nodeId, title, idToken)` → `ForkNode`
- `deleteNode(sessionId, nodeId, idToken)` → `void`
- `createAnnotation(sessionId, dto, idToken)` → `Annotation`
- `listAnnotations(sessionId, idToken)` → `Annotation[]`
- `deleteAnnotation(sessionId, annId, idToken)` → `void`
- `createHighlight(sessionId, dto, idToken)` → `Highlight`
- `updateHighlight(sessionId, hlId, dto, idToken)` → `Highlight`
- `deleteHighlight(sessionId, hlId, idToken)` → `void`
- `getNotionStatus(idToken)` → `{ connected: boolean }`
- `searchNotionPages(idToken, q)` → `NotionPage[]`
- `pushToNotion(idToken, title, blocks, childrenMap, parentPageId)` → `{ url: string }`

---

## State management in `App.tsx`

The app uses React local state as the source of truth for the UI, with **optimistic updates**: apply state changes immediately, then sync to NestJS in the background.

### Session lifecycle

1. User submits a query on `<Landing>` → call `POST /sessions` → receive `FullSession` with root node already populated
2. Set `sessionId`, `nodes`, `annotations`, `highlights` from the response
3. Branching (Go deeper / Ask AI) → optimistic: add a loading node to local state → call `POST /sessions/:id/nodes` → replace loading node with real response
4. Page reload → if `sessionId` is in URL or localStorage, call `GET /sessions/:id` to rehydrate

### `nodes` state shape

```ts
// React state
const [nodes, setNodes] = useState<Record<string, ForkNode>>({});
```

The tree is reconstructed by grouping nodes by `parentId` — never stored as a tree directly. This matches the DynamoDB flat-query approach.

---

## Component guide

| Component | Notes |
|---|---|
| `App.tsx` | `'use client'` — all session state lives here |
| `MindMap.tsx` | `'use client'` — SVG pan/zoom, `ResizeObserver`, `requestAnimationFrame` easing |
| `Section.tsx` | `'use client'` — clean marked HTML via `dangerouslySetInnerHTML`; hljs + CSS Highlight API in `useEffect` |
| `HighlightMenu.tsx` | `'use client'` — positions itself relative to `getBoundingClientRect()` |
| `FollowUpPop.tsx` | `'use client'` — positions below/above selection rect; Escape or X button (beside Branch) closes it |
| `TweaksPanel.tsx` | `'use client'` — draggable via `mousemove` listeners; rendered on ALL pages (Landing, History, Workspace) so the settings icon is always accessible |
| `Landing.tsx` | `'use client'` — controlled input only |
| `HistoryPage.tsx` | `'use client'` — date-grouped session cards; renders `<HistoryBubbles>` above the list |
| `HistoryBubbles.tsx` | `'use client'` — force-directed topic cluster; see "History — topic bubbles" below |
| `NotesDrawer.tsx` | `'use client'` — tab state |
| `SkeletonSections.tsx` | Pure presentational — no `'use client'` needed |
| `Icons.tsx` | Pure presentational — no `'use client'` needed |

---

## History — topic bubbles

`HistoryBubbles.tsx` renders a force-directed cluster in the top ~25 % of the History page (`max-height: 25vh` stage), above the unchanged chronological card list.

- **Clustering is client-side, keyword-based.** Sessions are grouped by the most globally-frequent significant word in their title (stopwords stripped; longer word breaks ties). One bubble can hold many sessions; leftovers fall into "Other". There is **no** topic field on the backend — if grouping ever needs to be sharper, that's the change to make.
- **Size encodes node count.** Bubble area ∝ total `nodeCount` across its sessions (sqrt scale so *area*, not radius, tracks count). The badge shows node count with the `GitBranch` icon, matching the session cards.
- **Layout is a radial-rank model, not emergent packing.** Each bubble gets an orbit rank `t ∈ [0,1]` by size (`0` = biggest, `1` = smallest) and is spring-pulled toward an **elliptical** ring at that rank — biggest dead-centre, smaller ones on wider rings. The ellipse uses the full (wide) stage so small bubbles spread horizontally instead of piling onto one cramped central ring. A hard positional non-overlap pass (mass-weighted, `mass ∝ r²`) guarantees no overlap and keeps the heavy centre bubble anchored. Cursor repulsion + damping give the elastic feel.
- **Auto-fit:** bubble radii are scaled so their combined area ≤ `FILL_FRAC` of the stage, so a crowded set shrinks rather than overlaps.
- **Perf:** the rAF loop writes `transform`/size **straight to the DOM via refs** — no per-frame React re-render (same discipline as `MindMap`). All physics constants are tunables at the top of the file.

---

## Logo & favicon (theming)

The brand mark exists as two SVGs in `public/`: **`icon.svg` (light)** and **`icon_b.svg` (dark)**. `logo.png` / `logo.svg` are **legacy and unreferenced** — do not reintroduce them.

- **Tab favicon follows the OS colour scheme**, via explicit `<link rel="icon" media="(prefers-color-scheme: …)">` tags in `layout.tsx`. It does **not** track the in-app `data-theme` toggle — browsers can't swap a favicon from a class on `<html>`.
- **Do NOT put `icon.svg` in `src/app/`.** Next.js App Router auto-detects `app/icon.*` and injects a **media-less** `<link>` that overrides the dark variant. Both icons live in `public/` and are wired manually in `layout.tsx`; `app/icon.svg` was deliberately removed.
- **The in-app brand logo** (`.app-brand .brand-logo` in `App.tsx`) is a CSS `background-image` that swaps `icon.svg` → `icon_b.svg` under `[data-theme="dark"]` — i.e. it *does* track the in-app toggle (the correct behaviour for an in-page element). The login arrived-screen logo is hard-coded to `icon.svg` (always on a white background).

---

## Design system

Styles live entirely in `src/app/globals.css` (ported from root `styles.css`).

Key CSS variables (set on `<html>` via `App.tsx` useEffect based on tweaks):
- `--accent`, `--serif`, `--sans` — changed dynamically by TweaksPanel
- `data-theme="light|dark"` on `<html>` — dark mode
- `data-density="comfortable|compact"` on `<html>` — density

**Dark-mode gotcha — white control surfaces.** Several controls default to white/near-white backgrounds (`.twk-field` select, `.twk-seg-thumb` toggle thumb) and the highlight backgrounds are fixed light pastels. With light text in dark mode these go invisible, so each needs an explicit `[data-theme="dark"]` override: dark surfaces for the panel controls, and `color: #0a0a0a` on background-only `::highlight(fork-hl-*)` rules. Any new white-surfaced control or light-background highlight must add its own dark override.

Fonts loaded via Google Fonts `<link>` in `layout.tsx`: Newsreader, Spectral, Fraunces, DM Sans, IBM Plex Sans, JetBrains Mono, Geist.

---

## Environment variables

```bash
# .env.local

NEXT_PUBLIC_API_BASE_URL=http://localhost:3000   # NestJS backend

# next-auth
NEXTAUTH_URL=http://localhost:3001
NEXTAUTH_SECRET=<generate: openssl rand -base64 32>

# Cognito
COGNITO_CLIENT_ID=<from AWS console>
COGNITO_CLIENT_SECRET=<from AWS console>
COGNITO_USER_POOL_ID=ap-south-1_XXXXX
AWS_REGION=ap-south-1
```

---

## Run

```bash
cd frontend
npm install
npm run dev -- -p 3001      # starts on port 3001
npm run build               # type-check + production build
```

## Run

```bash
# From repo root:
npm run dev:web      # Next.js on port 3001
npm run build        # type-check + production build (Nx-cached)
```
