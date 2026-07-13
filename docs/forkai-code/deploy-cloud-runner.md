# Deploying the cloud agent runner (forkai-code)

Manual prerequisites before the next `code-prod` deploy picks up
`AGENT_RUNNER=cloud` on `forkai-code-api-prod`. The buildspec change
(`apps/code-api/buildspec.yml`) is **inert** until these exist — the build
will fail at the `secrets-manager:` fetch step (missing secret) if deployed
before step 1, and any live run will fail at sandbox create (missing image)
if deployed before step 2.

> Deploys are user-gated (see root `CLAUDE.md` → "Deployment"). This doc is
> the checklist, not permission to run any of it.

## 1. Create the `forkai/fly-api-token` secret

The buildspec's `secrets-manager:` block now fetches `FLY_API_TOKEN` from
`forkai/fly-api-token`, mirroring the existing LLM-provider keys.

```bash
FLY_TOKEN=$(fly tokens create org -o personal)
aws secretsmanager create-secret \
  --name forkai/fly-api-token \
  --secret-string "$FLY_TOKEN" \
  --region ap-south-1
```

An **org token** (not a personal/user token) — it's scoped to app
create/destroy within the org, which is all `FlyProvider` needs, and doesn't
expire when a human's session does.

## 2. Push the sandbox image

`FLY_SANDBOX_IMAGE` on the EB environment points at
`registry.fly.io/forkai-sbx-base:latest` — that tag has to exist before the
first cloud run, and should be re-pushed whenever `infra/sandbox-image/`
changes (see that directory's own README for the build+push commands):

```bash
cd infra/sandbox-image
docker build --platform linux/amd64 -t registry.fly.io/forkai-sbx-base:latest .
fly auth docker
docker push registry.fly.io/forkai-sbx-base:latest
```

## 3. The launch switch

Once 1–2 are done and `code-prod` has deployed, the API is *capable* of
`environment: 'cloud'` runs but nothing routes users to it yet — `code-web`'s
`TWEAK_DEFAULTS.environment` still defaults to `'demo'`. Flipping that
constant to `'cloud'` (a `code-web` change, separate deploy) is what actually
turns cloud runs on for users. Until then, cloud is reachable only by a
client that explicitly requests it.

## What the buildspec now provisions

| EB env var | Value | Purpose |
|---|---|---|
| `FLY_API_TOKEN` | from Secrets Manager | auth for `FlyProvider`'s Machines REST + GraphQL calls |
| `AGENT_RUNNER` | `cloud` | server default when a request omits `environment` (per-request override via the DTO still works either way — see `runner-registry.ts`) |
| `FLY_ORG` | `personal` | org slug apps are created under |
| `FLY_SANDBOX_IMAGE` | `registry.fly.io/forkai-sbx-base:latest` | image `FlyProvider.create` boots |
| `FLY_REGION` | `sin` | single-region fallback when `FLY_REGIONS` is unset |
| `FLY_REGIONS` | `sin,bom` | ordered region list — `bom` is only tried if `sin` 422s with `insufficient_capacity` (it has historically had none for `shared-cpu-2x`, see ADR-0001's amendment) |
| `SANDBOX_TTL_MINUTES` | `20` | minutes a successful run's sandbox survives past `done`, so the user can open the workspace (≈$0.01/run infra) |
