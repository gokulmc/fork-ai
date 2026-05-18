# fork.ai — Frontend (Next.js 15)

> See root `CLAUDE.md` for shared data model, architecture overview, and project context.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15, App Router, TypeScript strict |
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
│   │   ├── layout.tsx          # Root layout — Google Fonts <link>, imports globals.css
│   │   ├── globals.css         # Full design system (ported from styles.css)
│   │   ├── page.tsx            # Renders <App /> (or <SessionsDashboard /> if logged in with no active session)
│   │   └── api/
│   │       └── auth/
│   │           └── [...nextauth]/route.ts   # next-auth Cognito provider
│   ├── components/
│   │   ├── App.tsx             # Root client component — all research state
│   │   ├── Landing.tsx         # Landing page (unauthenticated or new session)
│   │   ├── MindMap.tsx         # SVG mind map — pan/zoom/layout
│   │   ├── Section.tsx         # Section renderer — marked + hljs
│   │   ├── SkeletonSections.tsx
│   │   ├── HighlightMenu.tsx   # Floating menu on text selection
│   │   ├── FollowUpPop.tsx     # Follow-up question popup
│   │   ├── NotesDrawer.tsx     # Slide-out notes & callouts drawer
│   │   ├── TweaksPanel.tsx     # Draggable tweaks panel (theme, font, density, layout)
│   │   └── Icons.tsx           # Lucide-style SVG icons via make() factory
│   ├── hooks/
│   │   └── useTweaks.ts        # useTweaks(defaults) → [values, setTweak]
│   └── lib/
│       ├── types.ts            # Shared TypeScript interfaces (ForkNode, Section, Annotation, …)
│       ├── utils.ts            # uid, short5, stripMarkdown, pickEmoji, wrapTextInElement, …
│       └── api.ts              # TO BUILD — typed NestJS REST client (reads id_token, sends Bearer header)
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
| `Section.tsx` | `'use client'` — `dangerouslySetInnerHTML` with marked output; hljs in `useEffect` |
| `HighlightMenu.tsx` | `'use client'` — positions itself relative to `getBoundingClientRect()` |
| `FollowUpPop.tsx` | `'use client'` — positions below/above selection rect |
| `TweaksPanel.tsx` | `'use client'` — draggable via `mousemove` listeners |
| `Landing.tsx` | `'use client'` — controlled input only |
| `NotesDrawer.tsx` | `'use client'` — tab state |
| `SkeletonSections.tsx` | Pure presentational — no `'use client'` needed |
| `Icons.tsx` | Pure presentational — no `'use client'` needed |

---

## Design system

Styles live entirely in `src/app/globals.css` (ported from root `styles.css`).

Key CSS variables (set on `<html>` via `App.tsx` useEffect based on tweaks):
- `--accent`, `--serif`, `--sans` — changed dynamically by TweaksPanel
- `data-theme="light|dark"` on `<html>` — dark mode
- `data-density="comfortable|compact"` on `<html>` — density

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

## Build order (what still needs to be built)

1. Delete `src/app/api/llm/` directory and `src/lib/llm.ts`
2. Add `src/app/api/auth/[...nextauth]/route.ts` (next-auth Cognito provider)
3. Build `src/lib/api.ts` — typed NestJS client
4. Add `src/app/globals.css` — port from root `styles.css`
5. Rewrite `App.tsx` to use `api.ts` instead of in-memory LLM calls
6. Add sessions dashboard (list existing sessions on login)
7. Wire `src/middleware.ts` to protect routes (redirect to sign-in if no session)
