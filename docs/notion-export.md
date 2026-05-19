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
7. Button changes to **Open in Notion ↗** for 8 seconds, linking directly to the created page.

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
| `apps/web/src/lib/notion-clipboard.ts` | Builds the Notion block tree from session state; splits nested tree for API |
| `apps/web/src/components/App.tsx` | OAuth redirect, picker state, `saveToNotionPage` callback |
| `apps/web/src/components/MindMap.tsx` | "Save to Notion" button + error/success states |
| `apps/web/src/lib/api.ts` | `getNotionStatus`, `searchNotionPages`, `pushToNotion` |
| `apps/api/src/notion/notion.service.ts` | OAuth exchange, page search, recursive block push |
| `apps/api/src/notion/notion.controller.ts` | Route handlers + DTOs |
| `apps/api/src/notion/notion.module.ts` | Module wiring |

---

## Block mapping

| fork.ai concept | Notion block |
|---|---|
| Root node title | `heading_1` (non-toggle) |
| Root node lede | `paragraph` |
| Section heading | `heading_2` (depth 1), `heading_3` (depth 2+) |
| Section body (markdown) | `paragraph`, `bulleted_list_item`, `code`, `quote` |
| Child node (depth 1) | `heading_1` with `is_toggleable: true` |
| Child node (depth 2) | `heading_2` with `is_toggleable: true` |
| Child node (depth 3+) | `heading_3` with `is_toggleable: true` |
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

## Error handling (frontend)

| Scenario | UI behaviour |
|---|---|
| `/notion/status` throws | Button shows "Could not reach server" in red |
| `pushToNotion` throws | Button shows "Failed to save — try again" in red |
| Clicking error button | Clears error and retries `openNotionPicker` |
| Notion returns success | Button changes to "Open in Notion ↗" for 8 s, then resets |
| Page picker loading | Shows "Loading…" while `searchNotionPages` is in-flight |

---

## Future work

- **Disconnect Notion** — UI to revoke the token (call `updateNotionToken(sub, null)` on the backend, which already handles null).
- **Database parents** — currently only page parents are supported; extend `searchPages` to include Notion databases.
- **Incremental sync** — detect an existing fork.ai page for the session and update blocks rather than creating a new page.
