# fork.ai — Frontend (Next.js 16)

> See root `CLAUDE.md` for shared data model, architecture overview, and project context.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16, App Router, TypeScript strict |
| Auth | `next-auth` v5 (Auth.js) with Cognito as OAuth2 provider |
| State | React 19 hooks — local state, synced to NestJS REST API |
| Markdown | `marked` v15 (GFM, synchronous parse) + `marked-katex-extension` (KaTeX math) |
| Syntax highlight | `highlight.js` v11 |
| Math | `katex` via `marked-katex-extension` (`output: 'html'`) — `$…$` inline, `$$…$$` block; LaTeX `\(…\)` / `\[…\]` pre-rendered (see "Math rendering") |
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
│   │   ├── TweaksPanel.tsx     # Draggable tweaks panel (theme, font, density, layout, maxSections, branchModel, webSearch) + status chips above the gear
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

### Dev-only session cookie name (`forkai.session-token`)

`localhost` cookies are shared across **ports**, so any other next-auth app running locally (e.g. `p2p-lending-tracker` on `:3001`) writes the default `authjs.session-token` cookie with *its* secret — fork.ai then fails every request with `JWTSessionError: no matching decryption secret` and the user looks logged out. `src/auth.ts` therefore namespaces the session cookie in dev:

```ts
...(process.env.NODE_ENV !== 'production' && {
  cookies: { sessionToken: { name: 'forkai.session-token' } },
}),
```

**Prod must keep the default name** — renaming it there would log out every live forkai.in session at once. If a sibling local app ever shows the same error, it needs its own namespaced cookie name on its side.

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
| `Section.tsx` | `'use client'` — clean marked HTML via `dangerouslySetInnerHTML`; hljs + CSS Highlight API in `useEffect`; KaTeX math (see "Math rendering" below) |
| `HighlightMenu.tsx` | `'use client'` — positions itself relative to `getBoundingClientRect()` |
| `FollowUpPop.tsx` | `'use client'` — positions below/above selection rect; Escape or X button (beside Branch) closes it |
| `TweaksPanel.tsx` | `'use client'` — draggable via `mousemove` listeners; rendered on ALL pages (Landing, History, Workspace) so the settings icon is always accessible |
| `Landing.tsx` | `'use client'` — controlled input only |
| `HistoryPage.tsx` | `'use client'` — date-grouped session cards; renders `<HistoryBubbles>` above the list |
| `HistoryBubbles.tsx` | `'use client'` — force-directed topic cluster; see "History — topic bubbles" below |
| `NotesDrawer.tsx` | `'use client'` — tab state |
| `SkeletonSections.tsx` | Pure presentational — no `'use client'` needed |
| `Icons.tsx` | Pure presentational — no `'use client'` needed |

## Math rendering (`Section.tsx`)

Section bodies are GitHub-flavoured markdown that may contain LaTeX. `marked.use(markedKatex({ throwOnError: false, output: 'html' }))` renders `$…$` (inline) and `$$…$$` (block). `output: 'html'` (not the default `htmlAndMathml`) is deliberate: it skips KaTeX's duplicate MathML so the rendered `textContent` stays aligned with the character offsets the CSS Custom Highlight API and triple-click sentence selection depend on. `katex/dist/katex.min.css` is imported at the top of `Section.tsx`.

**Why `extractBracketMath()` exists:** DeepSeek and GPT routinely emit math with the LaTeX `\(…\)` (inline) / `\[…\]` (display) delimiters instead of `$…$`. marked doesn't recognise those — it treats the bracket as escaped punctuation and strips the backslash (`\(`→`(`, `\[`→`[`), so the bare LaTeX leaks into the prose and subscript underscores even render as `<em>`. Before `marked.parse`, `extractBracketMath` pre-renders each `\(…\)` / `\[…\]` span to KaTeX HTML (`output: 'html'`, `displayMode` for the square-bracket form) and substitutes an `@@MATH-n@@` sentinel; the rendered HTML is spliced back into marked's output afterwards. Doing it as a pre-render (rather than rewriting to `$…$`) is deliberate: it sidesteps marked-katex's `$`-delimiter quirks — a closing `$` adjacent to `)` (e.g. `(e.g. \(10^{-5}\))`) won't match, and `nonStandard` would falsely match dollar amounts like `$5 … $10` — and leaves the existing `$…$` + currency behaviour completely untouched. It skips fenced code blocks so delimiters there stay literal.

**Why `unwrapCodeMath()` exists:** Gemini is inconsistent about math notation — it usually emits valid `$…$`, but sometimes wraps the same LaTeX in an inline-code span (`` `\cos(\theta_j)` ``), which would render as monospace text. Before parsing, `unwrapCodeMath` rewrites code spans whose content is unambiguously LaTeX (a curated command whitelist — `\theta`, `\frac`, `\mathbf`, … — NOT a bare backslash, so `` `\d+` `` regexes and `` `C:\Users` `` paths are left alone) into `$…$`. It skips fenced code blocks and uses a `(?![A-Za-z])` boundary so subscripts like `\theta_j` match. The ad-hoc bold-letter style (`**x**_i`) is intentionally NOT auto-converted — too ambiguous against real emphasis.

---

## History — topic bubbles

`HistoryBubbles.tsx` renders a force-directed cluster in the top ~25 % of the History page (`max-height: 25vh` stage), above the unchanged chronological card list.

- **Clustering is client-side, keyword-based.** Sessions are grouped by the most globally-frequent significant word in their title (stopwords stripped; longer word breaks ties). One bubble can hold many sessions; leftovers fall into "Others". There is **no** topic field on the backend — if grouping ever needs to be sharper, that's the change to make.
- **Capped at `MAX_BUBBLES` (20).** When there are more keyword buckets than the cap, the long tail folds into the single **"Others"** bubble (merged with any existing one) so no session is dropped — clicking "Others" lists them all in the drawer.
- **The "Others" bubble is special** (`key === OTHER_KEY`): pinned to the **bottom-left corner** (not the radial cluster), **fixed diameter** `OTHER_D` (does NOT grow with node count), excluded from the size ranking and the auto-fit area, immovable in the non-overlap pass, and ignores the cursor. This stops a large catch-all from grabbing centre stage.
- **Size encodes node count** (real topics only). Bubble area ∝ total `nodeCount` (sqrt scale so *area*, not radius, tracks count). "Others"' large total is kept out of the min/max so it can't shrink the real bubbles. The badge shows node count with the `GitBranch` icon, matching the session cards.
- **Layout is a radial-rank model, not emergent packing.** Each *real* bubble gets an orbit rank `t ∈ [0,1]` by size (`0` = biggest, `1` = smallest) and is spring-pulled toward an **elliptical** ring at that rank — biggest dead-centre, smaller ones on wider rings. The ellipse uses the full (wide) stage so small bubbles spread horizontally instead of piling onto one cramped central ring. A hard positional non-overlap pass (mass-weighted, `mass ∝ r²`) guarantees no overlap and keeps the heavy centre bubble anchored. Cursor repulsion + damping give the elastic feel.
- **Auto-fit:** real bubble radii are scaled so their combined area ≤ `FILL_FRAC` of the stage, so a crowded set shrinks rather than overlaps.
- **Perf:** the rAF loop writes `transform`/size **straight to the DOM via refs** — no per-frame React re-render (same discipline as `MindMap`). All physics constants are tunables at the top of the file.

---

## Model selector (branch model)

`tweaks.branchModel` (persisted in `fork.ai.tweaks`) chooses the model for **branch** calls (Go Deeper / Ask AI); it's sent as `model` on the create-node payload (authed and guest). Eight options in `MODEL_OPTIONS` (`TweaksPanel.tsx`, default `haiku`), rendered as a `TweakSelect`: Claude `haiku`/`sonnet`/`opus` + Gemini `gemini-flash-lite`/`gemini-flash`/`gemini-pro` + DeepSeek `deepseek-flash`/`deepseek-pro`. The root query uses `ROOT_MODEL` server-side (not selectable by the user).

- **Cost ×N in the dropdown.** Each option label carries the measured average cost multiplier relative to Claude Haiku (1×) — derived from real branch-call (ASK/DEEPER/MIX) usage history, not list-price ratios, since real prompts per model don't carry the same token volume (`cost` field in `MODEL_OPTIONS`; static snapshot — re-derive from `UsageEventItem` history periodically, or whenever backend `MODEL_PRICING` changes). `glm`/`glm-air` were computed from very small samples and may shift as usage grows. DeepSeek entries carry a `2x peak` note for its 1-4am/6-10am UTC peak-hour pricing. The clean name (no ×N) is what `modelLabel()` returns for the chip.
- **DeepSeek has no web search:** when a DeepSeek model is selected, the Web Search `TweakRadio` is `disabled` (greyed, `.twk-seg-disabled`) with a hint note, and the web status chip shows **🔍 Web n/a**. The backend also drops the flag (`supportsWebSearch`), so it's belt-and-suspenders.
- **Status chips** float above the ⚙ trigger (`.twk-status`) when the panel is closed and hide when it opens: a **🤖 model** chip and a **🔍 Web on/off/n-a** chip — a quick at-a-glance status. The chips reuse the trigger's theme tokens (auto dark-mode).
- **Node header pill** shows which model produced the active node (**✳ <model name>**), next to the sections count, via `modelDisplayName(node.model)` (`lib/utils.ts`). The root node's model is now set immediately from the `done` SSE event (no reload needed). Only renders for nodes that have a stored `model` (older nodes won't).
- Citation markup is stripped from **ledes** for plain-text display via `stripCite()` (workspace, history cards, Notion export).

---

## Session-restore resilience (no "clear cache to fix")

Restore reads `fork.ai.session` / `fork.ai.node` / `fork.ai.trial` at mount. These **self-heal** so a stale/deleted id can't strand the user (was a real prod bug fixed only by manually clearing site data):
- `loadSession` catch removes `fork.ai.session`/`fork.ai.node` on a definitive **404/403** (kept on network blips, still retryable). It also deletes the IndexedDB snapshot and, if one was already painted, clears the in-memory session state so a deleted session can't ghost-restore.
- The guest share-load catch removes a stale `fork.ai.trial` so the invalid-link → login bounce can't recur.
- A safety-net effect forces `loadingRoot = false` once auth settles **unauthenticated with no guest token**, so the `ResearchingScreen` can never hang (covers a logged-out former-guest with a persisted session id — the case the login gate skips).

---

## Performance — app shell & session cache

Four mechanisms keep "time to usable" low; each has an invariant that must not be regressed.

### 1. Service worker caches the app shell (`public/sw.js`)

No longer a no-op. Caching is scoped to what can never go stale, preserving the ADR-0008 freshness contract (every deploy ships instantly):
- **`/_next/static/*` → cache-first.** Content-hashed, immutable; a deploy mints new URLs referenced by freshly-fetched HTML, so staleness is impossible.
- **Navigations (HTML) → network-first**, cached copy used only when the network fails — this is what lets the installed PWA launch on bad/no internet instead of white-screening.
- **Public assets (icons/fonts/images) → stale-while-revalidate.**
- **Everything else — API calls (cross-origin to NestJS), `/api/auth`, RSC payloads, SSE streams — is never intercepted.** Do not add caching for these.

Bump `CACHE_VERSION` in `sw.js` when changing the caching strategy (the `activate` handler purges old caches by name).

### 2. `Section` and `MindMap` are code-split (`App.tsx`)

Loaded via `next/dynamic` (`ssr: false`), NOT static imports — `Section` drags in `marked` + `katex` + `highlight.js` (~1MB+ uncompressed) which Landing/History never need. **Do not convert these back to static imports**; the chunks load on first session render, in parallel with the LLM call. Anything else that imports `Section.tsx`/`MindMap.tsx` statically would silently pull the libraries back into the shared bundle.

### 3. IndexedDB session cache (`src/lib/sessionCache.ts`)

`loadSession` is **cache-first / network-authoritative**: it paints the last local snapshot from IndexedDB immediately (clearing `loadingRoot`), then lets `GET /sessions/:id` overwrite it when it lands. A write-through effect in `App.tsx` snapshots `{ nodes, annotations, persistentHl, highlightsList, notionPageUrl }` to IndexedDB (debounced 400ms) on every change, so the snapshot stays current as sections stream and branches are added.
- **Loading/optimistic nodes are stripped before writing** — their temp ids don't exist server-side and a restored spinner would hang forever.
- **The network result is always authoritative**; the cache only accelerates first paint. On the network apply, the current `activeId` is kept if it still exists (so the refresh doesn't yank a user off a node they navigated to while the cached copy was showing).
- The store is capped at 10 sessions (oldest-by-`savedAt` evicted on write). All cache calls are best-effort — failures must behave as a cache miss, never block the network path.

### 4. Landing exit delay

`Landing.tsx`'s `setTimeout(…, 100)` before `onSubmit` must stay in sync with the `.landing` transition in `globals.css` (80ms). It sits on the critical path to the first LLM byte — keep it at ~animation + one paint, and don't raise either without the other.

---

## Logo & favicon (theming)

The brand mark exists as two SVGs in `public/`: **`icon.svg` (light)** and **`icon_b.svg` (dark)**. `logo.png` / `logo.svg` are **legacy and unreferenced** — do not reintroduce them.

- **Tab favicon follows the OS colour scheme**, via explicit `<link rel="icon" media="(prefers-color-scheme: …)">` tags in `layout.tsx`. It does **not** track the in-app `data-theme` toggle — browsers can't swap a favicon from a class on `<html>`.
- **Do NOT put `icon.svg` in `src/app/`.** Next.js App Router auto-detects `app/icon.*` and injects a **media-less** `<link>` that overrides the dark variant. Both icons live in `public/` and are wired manually in `layout.tsx`; `app/icon.svg` was deliberately removed.
- **The in-app brand logo** (`.app-brand .brand-logo` in `App.tsx`) is a CSS `background-image` that swaps `icon.svg` → `icon_b.svg` under `[data-theme="dark"]` — i.e. it *does* track the in-app toggle (the correct behaviour for an in-page element). The login arrived-screen logo is hard-coded to `icon.svg` (always on a white background).

---

## Blog — content & illustration conventions

Curated posts live in `src/content/blog/*.mdx` with **all metadata in `src/content/blog/index.ts`** (typed `POSTS` registry: slug, emoji, title, description, keywords, ISO date, readingMinutes, lazy `load()` importer — no frontmatter in the MDX). Adding a post = write the `.mdx` + register it in `index.ts`; `generateStaticParams` in `app/blog/[slug]/page.tsx` picks it up automatically. Shared chrome/typography (including `figure`/`img`/`figcaption`/`.post-sources` styles) is inline CSS in `app/blog/layout.tsx`.

**Editorial conventions (every post):**
- Essayistic prose, `##` headings, no H1 (the page renders the title from the registry).
- Cross-link related posts inline (`/blog/<slug>`), and present **fork.ai as the solution** by name at the post's pivot point — not just via links.
- Cite factual claims inline with real links (arXiv, primary sources); fact-heavy posts get a closing `<p className="post-sources">Sources: …</p>` after a `---`.

**Illustrations — every post gets one bespoke SVG diagram:**
- Hand-authored SVG in `public/blog/<motif>.svg`, embedded in MDX as:
  ```jsx
  <figure>
    <img src="/blog/<name>.svg" alt="<full description of the diagram>" width="1200" height="620" />
    <figcaption>One-line takeaway.</figcaption>
  </figure>
  ```
- **Canvas:** `viewBox="0 0 1200 <560–640>"`, root `font-family="ui-monospace, SFMono-Regular, Menlo, monospace"`. The SVG carries its own paper background (works in dark mode as a card; the layout adds the border/radius).
- **Palette (fixed — keep all diagrams consistent):** bg `#fbfaf8` · ink `#26231f` · muted label `#8f897c` · faint label `#b3ac9c` · line/stroke `#e3ded4` · node fill `#f1eee8` · fake-text bars `#d8d2c6` · grid `#eee9df` · **accent `#b45309`** · accent fill `#fdf3e7` · accent text `#7a4a12` · accent bars `#e3c49a` · negative/red `#c4452e` · dark panel `#211e1a`.
- **Vocabulary:** rounded-rect nodes (`rx≈12`) + curved edges for maps; accent = the highlighted path/solution, gray = everything else, red = the failure mode; simulate text with rounded bars, real labels in mono ≥14px (≥16px preferred — the SVG renders at 720px wide); side-by-side comparisons get mono uppercase headers + a faint center divider; one faint takeaway line at the bottom.
- Validate with `xmllint --noout public/blog/*.svg` (typographic quotes are fine; no unescaped `&`/`<`).

Community submissions (`/blog/submit`) are markdown stored via the API — untouched by all of the above.

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
