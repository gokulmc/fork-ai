# @fork-ai/code-api

NestJS backend for **forkai-code**, a second product pair forked from the original fork.ai `apps/api`. See root `CLAUDE.md` → "forkai-code" and this app's `CLAUDE.md` for the full picture.

- **Port:** 4000
- **DynamoDB table:** `forkai-code-main` (`DYNAMO_TABLE_NAME` is required — boot fails if unset, to prevent an accidental write to the production `forkai-main` table)
- **Env file:** `.env` (gitignored — copy `.env.example` conventions from `apps/api` if you need to recreate it; see this app's `CLAUDE.md` for the variable list)

## What this app is

A stripped-down fork of the fork.ai API: same core research/branching flow (sessions, nodes, annotations, highlights, LLM providers, billing) minus Notion export, guest/share/trial mode, the admin dashboard, blog, referrals, and transactional email — those modules were removed in the Phase 0 scaffold.

## Run

```bash
# From repo root:
npm run dev:code-api      # nodemon + ts-node, port 4000
npx nx run @fork-ai/code-api:type-check
```
