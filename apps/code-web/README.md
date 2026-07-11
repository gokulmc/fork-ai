# @fork-ai/code-web

Next.js frontend for **forkai-code**, a second product pair forked from the original fork.ai `apps/web`. See root `CLAUDE.md` → "forkai-code" and this app's `CLAUDE.md` for the full picture.

- **Port:** 4001
- **Backend:** `apps/code-api` on port 4000 (`NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`)
- **Env file:** `.env.local` (gitignored — see this app's `CLAUDE.md` for the variable list)

## What this app is

A stripped-down fork of the fork.ai web app: same core research/branching UI (Landing, MindMap, Sections, History, TweaksPanel, Cognito login) minus the blog, admin dashboard, Notion export UI, guest/share mode, mobile-shell install prompts, and onboarding tour — those were removed in the Phase 0 scaffold.

## Run

```bash
# From repo root:
npm run dev:code-web      # Next.js on port 4001
npx nx run @fork-ai/code-web:type-check
```
