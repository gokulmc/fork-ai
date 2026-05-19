# Notion Export — Technical Reference

## Overview

A session can be pushed to Notion as a structured page via the "Save to Notion" button in the mind map header. Child branches appear as collapsible toggle headings, highlights become Notion text colour annotations, and callout annotations become Notion callout blocks.

---

## User flow

1. User clicks **Save to Notion** in the mind map header.
2. If Notion is not connected → redirected to `GET /notion/auth` → Notion OAuth consent screen.
3. After authorising, Notion redirects to `GET /notion/callback` → access token saved to DynamoDB.
4. Frontend receives `?notion=connected` → page picker modal opens automatically.
5. User searches their Notion workspace and picks a parent page.
6. Session is pushed as a child page of the chosen parent.
7. Button changes to **Open in Notion ↗** permanently, linking directly to the created page.
8. The Notion page URL is persisted to DynamoDB (`notionPageUrl` on the session item) so the button survives page reload and history navigation.
9. If the user adds a new branch (Go Deeper / Ask AI), `notionPageUrl` is cleared immediately (both UI and DB) and the button reverts to **Save to Notion** — the export is now stale.

---

## Architecture

```
App.tsx (openNotionPicker / saveToNotionPage)
    │
    │  GET /notion/status        ← check if connected
    │  GET /notion/auth          ← start OAuth (redirect)
    │  GET /notion/pages?q=...   ← search parent pages
    │  POST /notion/push         ← push blocks
    ▼
NotionController → NotionService
    │
    ├── Notion OAuth API  — token exchange, stored in DynamoDB USER#sub METADATA
    └── Notion Blocks API — pages.create + blocks.children.append (recursive)
```

### Files

| File | Role |
|---|---|
| `apps/web/src/lib/notion-clipboard.ts` | Builds Notion block tree (Mermaid diagram first, then nodes); `splitBlocks` strips inline children for API |
| `apps/web/src/components/App.tsx` | OAuth redirect, picker state, `saveToNotionPage`, URL persistence, stale-on-branch invalidation |
| `apps/web/src/components/MindMap.tsx` | "Save to Notion" button + error/success states |
| `apps/web/src/lib/api.ts` | `getNotionStatus`, `searchNotionPages`, `pushToNotion`, `updateSessionNotionUrl` |
| `apps/api/src/notion/notion.service.ts` | OAuth exchange, page search, recursive block push |
| `apps/api/src/notion/notion.controller.ts` | Route handlers + DTOs |
| `apps/api/src/notion/notion.module.ts` | Module wiring |

---

## Block mapping

| fork.ai concept | Notion block |
|---|---|
| Mind map diagram | `code` block with `language: "mermaid"` — always the **first** block. Notion renders the diagram but lands in code view; users must manually click **Preview** to hide the code — the Notion API has no preview-mode property on code blocks. |
| Root node lede | `paragraph` (title is omitted — it's already the Notion page title) |
| Section heading (root) | `heading_1` in blue |
| Section heading (depth 1) | `heading_3` default |
| Section heading (depth 2+) | `paragraph` bold |
| Section body (markdown) | `paragraph`, `bulleted_list_item`, `code`, `quote` |
| Child node (depth 1) | `heading_2` toggle, purple text, `emoji title` |
| Child node (depth 2) | `heading_3` toggle, green text, `emoji title` |
| Child node (depth 3+) | `heading_3` toggle, yellow text, `emoji title` |
| Callout annotation | `callout` with 💡 emoji icon |
| Highlight (bg colour) | Notion background colour on matching text spans |
| Highlight (fg colour) | Notion foreground colour on matching text spans |

### Colour mapping

| App colour | Notion colour |
|---|---|
| `#fef08a` (yellow bg) | `yellow_background` |
| `#bbf7d0` (green bg) | `green_background` |
| `#bae6fd` (blue bg) | `blue_background` |
| `#fbcfe8` (pink bg) | `pink_background` |
| `#e5e5e5` (grey bg) | `gray_background` |
| `#b91c1c` (red fg) | `red` |
| `#1d4ed8` (blue fg) | `blue` |
| `#047857` (green fg) | `green` |

---

## The nested-blocks problem

The Notion API's `pages.create` endpoint **rejects any block that has an inline `children` property**. Toggle headings with child content must be appended separately via `blocks.children.append` after the page is created.

### Solution: client-side tree split

`notion-clipboard.ts` exports `buildNotionClipboard`, which:

1. Calls `nodeToNBlocks` to build the full nested block tree (toggle headings with inline `children`).
2. Passes the result through `splitBlocks`, which recursively:
   - Strips `children` from every block → produces a flat `blocks` array safe for `pages.create`.
   - Records which block indices had children in a `childrenMap: ChildEntry[]` tree.

```ts
interface ChildEntry {
  index: number;           // position in the flat blocks array at this level
  children: FlatBlock[];   // flat child blocks (children stripped)
  childrenMap: ChildEntry[]; // grandchildren (recursive)
}
```

The frontend sends `{ blocks, childrenMap }` to `POST /notion/push`.

### Server-side recursive append

`NotionService.pushPage`:

1. Creates the Notion page with the flat `blocks` (no `children` on any block).
2. If `childrenMap` is non-empty, calls `listAllBlockIds` to get the created block IDs in order.
3. Calls `appendChildrenRecursive(notion, createdIds, childrenMap)`:
   - For each `ChildEntry`, appends `children` to the block at `createdIds[index]`.
   - If the entry has a `subMap`, lists the newly appended block IDs and recurses.

This correctly handles any branching depth with no assumption about what Notion's `append` endpoint accepts for nested children.

---

## OAuth setup

Requires a **Public** Notion integration (not internal). Steps:

1. Go to `https://www.notion.com/my-integrations`.
2. Create a new integration → Distribution tab → enable **Public**.
3. Add redirect URI: `http://localhost:3000/notion/callback` (production: your API domain).
4. Copy the **OAuth Client ID** and **OAuth Client Secret**.

### Environment variables (API)

```bash
NOTION_CLIENT_ID=<oauth-client-id>
NOTION_CLIENT_SECRET=<oauth-client-secret>
NOTION_REDIRECT_URI=http://localhost:3000/notion/callback
FRONTEND_URL=http://localhost:3001   # where to redirect after OAuth
```

### Token storage

The Notion access token is stored on the `USER#sub / METADATA` DynamoDB item as `notionAccessToken`. It is retrieved by `NotionService.requireToken` before every Notion API call.

---

## Notion page URL persistence

After a successful push, `notionPageUrl` is written to the `SESSION#id` DynamoDB item via `PATCH /sessions/:id` with `{ notionPageUrl: url }`. On session load (`getSession`), the URL is included in the response and `App.tsx` restores the "Open in Notion ↗" button state.

### Stale-export invalidation

When a new branch is created (Go Deeper / Ask AI), the Notion export is immediately considered stale:

1. `notionSavedUrl` is set to `null` in React state (button reverts to "Save to Notion" instantly).
2. `updateSessionNotionUrl(idToken, sessionId, null)` fires in the background, writing `''` (empty string) to DynamoDB. `toSummary` maps `''` to `null` via `|| null`, so the next load also sees no URL.

Only new nodes trigger invalidation — highlights, callouts, and renames do not.

---

## Error handling (frontend)

| Scenario | UI behaviour |
|---|---|
| `/notion/status` throws | Button shows "Could not reach server" in red |
| `pushToNotion` throws | Button shows "Failed to save — try again" in red |
| Clicking error button | Clears error and retries `openNotionPicker` |
| Notion returns success | Button permanently shows "Open in Notion ↗" (URL persisted to DB) |
| Session loaded with saved URL | Button shows "Open in Notion ↗" immediately |
| New branch added | Button reverts to "Save to Notion" (URL cleared from DB) |
| Page picker loading | Shows "Loading…" while `searchNotionPages` is in-flight |

---

## Future work

- **Disconnect Notion** — UI to revoke the token (call `updateNotionToken(sub, null)` on the backend, which already handles null).
- **Database parents** — currently only page parents are supported; extend `searchPages` to include Notion databases.
- **Incremental sync** — detect an existing fork.ai page for the session and update blocks rather than creating a new page.
- **Mermaid preview mode** — Notion's code block API has no `preview_mode` property; the diagram always lands in code view. No workaround exists via the API — users must click **Preview** manually in Notion.
