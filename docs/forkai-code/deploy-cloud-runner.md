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

**This step is easy to silently skip and the failure mode is invisible.** A
`runner.mjs` change that isn't pushed passes every test/build/lint check —
`AGENT_RUNNER=cloud` still works, runs still complete, `done` still fires —
because the OLD sandbox code just runs instead, with no error anywhere. Live
testing (ADR-0002's third amendment) hit exactly this: push-back code shipped
and unit-tested, but the image push was deferred while no credentials existed
yet to test against, and the gap wasn't visible until a real push to a real
repo silently didn't happen. Verify with
`docker run --rm registry.fly.io/forkai-sbx-base:latest grep -c '<new symbol>' /runner.mjs`
before trusting a live test result after any `runner.mjs` change.

## 3. The launch switch

Once 1–2 are done and `code-prod` has deployed, the API is *capable* of
`environment: 'cloud'` runs but nothing routes users to it yet — `code-web`'s
`TWEAK_DEFAULTS.environment` still defaults to `'demo'`. Flipping that
constant to `'cloud'` (a `code-web` change, separate deploy) is what actually
turns cloud runs on for users. Until then, cloud is reachable only by a
client that explicitly requests it.

## 4. GitHub App (private repos — Contents:Read v1)

**Manual, one-time GitHub-side registration — no API for this step.** Without
it, `GithubAppService.isConfigured()` is false, `GET /github/app/install`
503s, and `resolveRunRepo` 400s any cloud run against a private repo with a
friendly "install the App" message (public repos and mock/local runs are
unaffected — see ADR-0002's amendment).

1. **Create the GitHub App** at <https://github.com/settings/apps/new> (or the
   org equivalent):
   - Name: `forkai code` (or any available name — the App's `slug`, read from
     the created App's settings page, is what `GITHUB_APP_SLUG` below needs).
   - Homepage URL: `https://code.forkai.in`
   - **Setup URL**: `https://code.forkai.in/github/setup`, with **"Redirect on
     update"** checked — this is the page that receives `?installation_id=`
     and links it to the signed-in user (`apps/code-web/src/app/github/setup/page.tsx`).
   - **Permissions**: Repository → Contents: **Read-only**, Metadata: **Read-only**.
     No other permissions, no account permissions.
   - **Webhooks**: none for v1 — uncheck "Active".
   - **Where can this GitHub App be installed?**: "Any account" (so any user
     can install it on their own personal account or org).
2. **Generate a private key** (App settings → "Generate a private key" —
   downloads a `.pem`), then base64-encode it for the env var:
   ```bash
   base64 -i forkai-code.YYYY-MM-DD.private-key.pem | tr -d '\n' > /tmp/gh-app-key-b64.txt
   ```
3. **Set three env vars** — `GITHUB_APP_ID` (the App's numeric id, shown on
   its settings page), `GITHUB_APP_PRIVATE_KEY_B64` (contents of the file from
   step 2), `GITHUB_APP_SLUG` (the App's URL slug, e.g. `forkai-code` — used
   to build the `/apps/<slug>/installations/new` install link). All three are
   **optional** Joi keys (`config/configuration.ts`) — omitting any of them
   leaves `isConfigured()` false and the feature inert, same lazy-validation
   pattern as `GEMINI_API_KEY`/`DEEPSEEK_API_KEY`/`GLM_API_KEY`. Needed in
   **both** places:
   - Local dev: `apps/code-api/.env` (gitignored).
   - `forkai-code-api-prod` EB env, once a `code-prod` deploy is authorized —
     not a Secrets Manager entry like the LLM keys (the private key isn't a
     single short secret string in the same category, and this doc is a
     manual-step checklist, not a buildspec change; wiring it through
     `secrets-manager:` the same way the LLM keys are is the natural v1.1 step
     if this needs to survive an EB env rebuild without re-pasting).
4. **Activate it for a user**: sign in to forkai code, navigate to
   `{NEXT_PUBLIC_API_BASE_URL}/github/app/install` (no in-app button yet — see
   ADR-0002's amendment), install the App on the account/org that owns the
   private repo, and GitHub redirects back to `/github/setup?installation_id=…`,
   which POSTs it to `POST /github/app/installations`.

## What the buildspec now provisions

| EB env var | Value | Purpose |
|---|---|---|
| `FLY_API_TOKEN` | from Secrets Manager | auth for `FlyProvider`'s Machines REST + GraphQL calls |
| `AGENT_RUNNER` | `cloud` | server default when a request omits `environment` (per-request override via the DTO still works either way — see `runner-registry.ts`) |
| `FLY_ORG` | `personal` | org slug apps are created under |
| `FLY_SANDBOX_IMAGE` | `registry.fly.io/forkai-sbx-base:latest` | image `FlyProvider.create` boots |
| `FLY_REGION` | `sin` | single-region fallback when `FLY_REGIONS` is unset |
| `FLY_REGIONS` | `sin,bom` | ordered region list — `bom` is only tried if `sin` 422s with `insufficient_capacity` (it has historically had none for `shared-cpu-2x`, see ADR-0001's amendment) |
| `SANDBOX_TTL_MINUTES` | `10` | minutes a successful run's sandbox survives past `done`, so the user can open the workspace (≈$0.005/run infra — cost is negligible at any reasonable value; 10 balances enough time to react against fewer standing sandboxes / faster sweep convergence) |

## 5. Blaxel — the second, user-selectable cloud provider (`environment: 'blaxel'`)

Blaxel is a parallel billed-cloud runner offered alongside Fly. A user picks it
in the TweaksPanel (Environment → "Cloud (Blaxel)"); the frontend sends
`environment: 'blaxel'`. It reuses the whole `CloudAgentRunner` loop via an
injected `BlaxelProvider` (`apps/code-api/src/agent/cloud/blaxel-provider.ts`,
built on the `@blaxel/core` SDK) — same `runner.mjs` and same `/__forkai/run` +
`/__forkai/healthz` contract. It differs from Fly in three ways: US/EU-only
regions (no Asia); **split billing** — active compute at
`BLAXEL_ACTIVE_MINUTE_RATE_USD`, idle standby at the near-zero
`BLAXEL_STANDBY_GB_SECOND_RATE_USD` (see `billBlaxelMachineUsage`); and a
**different image** — a Blaxel sandbox bundles Blaxel's own `sandbox-api`
control binary on port 8080 (what the SDK talks to), so `runner.mjs` moves to
**8081** (`RUNNER_PORT`) and the preview targets 8081. Hence a separate image
dir, `infra/sandbox-image-blaxel/` (Fly's `runner.mjs` is the single source; the
Blaxel image copies it in and adds `sandbox-api` + a dual-process entrypoint —
see that dir's README).

The runner registers **only when `BLAXEL_API_TOKEN` + `BLAXEL_WORKSPACE` +
`BLAXEL_SANDBOX_IMAGE` are all set** — otherwise `resolve('blaxel')` 400s, the
same gating as Fly. So this can ship inert and be turned on later.

1. **Build + push the Blaxel sandbox image** (Blaxel builds it remotely — no
   local Docker needed):
   ```bash
   cd infra/sandbox-image-blaxel
   bl login                       # or BL_API_KEY + BL_WORKSPACE in the env
   sh build.sh                    # copies runner.mjs in, `bl push`, prints the ref
   # → set the printed ref (e.g. sandbox/forkai-sbx-base:latest) as BLAXEL_SANDBOX_IMAGE
   ```
   ⚠️ **Same invisible failure mode as Fly (step 2):** an un-pushed `runner.mjs`
   change silently runs the old code. There are now **two** registries holding
   this image (Fly + Blaxel) — a `runner.mjs` change must be pushed to **both**.
2. **Store the creds** the same way as `forkai/fly-api-token` (Secrets Manager
   → buildspec → EB env), adding `BLAXEL_API_TOKEN`, `BLAXEL_WORKSPACE`,
   `BLAXEL_SANDBOX_IMAGE` (and optionally `BLAXEL_REGION`, default `eu-fra-1`;
   `BLAXEL_MEMORY_MB`, default 4096). The SDK authenticates purely off
   `BL_API_KEY`/`BL_WORKSPACE`, which `BlaxelProvider` maps from `BLAXEL_*` at
   boot — no separate `BL_*` vars needed.
3. **Rates** (`config/configuration.ts` `billing` block, optional Joi keys with
   published-2026 defaults): `BLAXEL_ACTIVE_MINUTE_RATE_USD` (default `0.0028`),
   `BLAXEL_STANDBY_GB_SECOND_RATE_USD` (default `0.0000000772`). Re-derive from
   Blaxel's live pricing periodically, same as the `MODEL_OPTIONS` `×N` figures.

**No launch-switch change needed** (unlike Fly step 3): Blaxel is never a server
*default* — it's opt-in per request via the tweak, so it becomes available the
moment the three env vars land and `code-web` ships the ENVIRONMENT_OPTIONS
entry. The frontend option is already present; just ensure the backend is
configured before users can pick it (an unconfigured pick 400s).
