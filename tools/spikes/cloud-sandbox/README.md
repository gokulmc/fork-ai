# cloud-sandbox spike (Fly Machines, region `bom`)

> **THROWAWAY feasibility spike.** Not wired into `apps/`, not part of the npm
> workspace, no production code depends on this. Delete the whole
> `tools/spikes/cloud-sandbox/` directory once the questions below are
> answered and the decision is made.

## What this proves

Can we boot a Fly Machine on demand, clone a repo into it, run Claude Code
headless inside, stream its event log back to a browser/CLI over HTTP/SSE,
land a real git commit + diff summary, **and** expose an authed
`openvscode-server` on a public HTTPS URL that can be iframed from
`http://localhost:4001` (i.e. from code-web's own origin)?

If yes — with acceptable cold-boot latency and cost — this is the shape of a
"cloud sandbox" execution backend for CODE nodes, as an alternative/addition
to the current local (same-host) agent runner
(`apps/code-api/src/agent/local/`).

**This spike was built and typechecked/docker-built locally but never run
against a real Fly account** — no `flyctl`, no `FLY_API_TOKEN` on this
machine. Everything below the "Verified locally" section is unexecuted;
treat the Fly API shapes as "verified against docs and community reports,"
not "verified by running."

---

## Verified locally (no Fly account required)

| Check | Result |
|---|---|
| `npx tsc --noEmit` on `src/**/*.ts` | Clean, 0 errors |
| `node --check image/runner.mjs` | Clean |
| `docker build --platform linux/amd64 -t forkai-sbx-test image/` | **Succeeded.** 911MB image, ~90s cold build (52s apt, 12s `npm i -g claude-code`, 16s openvscode-server download+extract) on this machine (Colima, arm64 host, amd64 emulation via QEMU — a native amd64 CodeBuild-style builder will be faster) |
| Inside-container smoke test (`docker run ... node --check /runner.mjs`, `git --version`, `claude --version`, `/opt/openvscode/bin/openvscode-server --version`) | `git 2.39.5`, `claude 2.1.207`, `openvscode-server 1.109.5` all present and runnable |
| `runner.mjs` HTTP smoke test | Started locally with `RUN_TOKEN=x node image/runner.mjs`; `GET /healthz` → `200 {"ok":true}` with no auth; `POST /run` with no `Authorization` header → `401 {"error":"unauthorized"}`. `/run`'s full path (git clone + claude spawn) was **not** exercised locally — it needs a real repo URL + `ANTHROPIC_API_KEY` + a `claude` binary+auth, which is exactly what running this on Fly proves end-to-end. |

Not verified (needs a live Fly account — see "Open questions" at the bottom):
the whole `fly-provider.ts` flow (app create, dedicated IPv4 allocation,
machine create/wait, edge `/healthz` routing, machine+app destroy), the
`/run` SSE stream against a real `claude` invocation, and the iframe
embedding test.

---

## Prereqs (for the live run, not required to build/typecheck this spike)

1. **flyctl** — not installed on this machine.
   ```bash
   curl -L https://fly.io/install.sh | sh
   fly auth login          # interactive, opens a browser
   # or, non-interactively:
   fly tokens create org -o <your-org-slug>   # prints a token → export as FLY_API_TOKEN
   ```
2. **Docker**, for building the sandbox image (`docker version` was confirmed
   working on this machine — Colima, linux/arm64 host, so image builds must
   pass `--platform linux/amd64` since Fly Machines are x86_64 by default).
3. **An Anthropic API key** with credit, for `ANTHROPIC_API_KEY` (used both by
   `run-spike.ts`'s own env passthrough requirement, and forwarded into the
   Fly Machine for `claude -p` to authenticate).
4. **A repo the machine can clone.** For a private repo, embed a token in
   `--repo` (e.g. `https://<gh-pat>@github.com/org/repo.git`) — `runner.mjs`
   never logs the raw URL (see "Security notes").

---

## Exact bring-up commands

```bash
cd tools/spikes/cloud-sandbox
npm install                     # installs tsx/typescript/@types/node locally — this dir is
                                 # NOT in the root npm workspace, own package-lock.json

# 1. Build + push the sandbox image
docker build --platform linux/amd64 -t registry.fly.io/forkai-sbx-base:latest image/
fly auth docker                 # authenticates docker against registry.fly.io using your flyctl session
docker push registry.fly.io/forkai-sbx-base:latest

#    (Alternative that skips the local docker build entirely — lets Fly's
#    remote builder do it: `fly deploy --build-only --push --image-label latest -c /dev/null`
#    is awkward without a fly.toml; for a one-off image push the docker build+push
#    above is more direct for a spike with no fly.toml in this repo.)

# 2. Set env for the CLI
export FLY_API_TOKEN=<token from `fly tokens create org`>
export FLY_ORG=personal                     # or your org slug
export FLY_REGION=bom                       # Mumbai — this spike's target region
export FLY_SANDBOX_IMAGE=registry.fly.io/forkai-sbx-base:latest
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Run it
npx tsx src/run-spike.ts \
  --repo "https://github.com/<org>/<repo>.git" \
  --branch spike-1 \
  --instruction "Add a comment to the top of README.md saying hello from the cloud sandbox spike"

# (append --keep to leave the machine+app up after the run for manual poking —
#  remember to destroy it yourself: `fly apps destroy forkai-sbx-<runId> --yes`)
```

`run-spike.ts` prints the `vscodeUrl` prominently right after the machine
comes up — open it immediately to watch the agent work live in the editor
while the SSE stream also prints translated events to the terminal.

### iframe embedding test

```bash
# from repo root, in a second terminal:
npx serve -l 4001 tools/spikes/cloud-sandbox/src
# open http://localhost:4001/iframe-test.html, paste the vscodeUrl printed above
```

Or check headers directly without a browser:
```bash
npx tsx src/run-spike.ts --headers-check "https://forkai-sbx-xxxx.fly.dev:10300/?tkn=..."
```

---

## Live-run attempt log

**2026-07-12 — BLOCKED at app creation by Fly account verification.**
flyctl v0.4.69 installed and authenticated (mcgokul123@gmail.com, org
`personal`). What was verified live before the block:

- `fly orgs list` — org slug `personal` confirmed.
- `fly auth docker` — registry auth configured OK.
- `fly auth token` works against **both** API surfaces this spike uses:
  `GET https://api.machines.dev/v1/apps?org_slug=personal` → `200
  {"total_apps":0,"apps":[]}` (REST auth + endpoint shape confirmed), and a
  GraphQL `viewer` query on `https://api.fly.io/graphql` → correct
  email/org (GraphQL auth confirmed, relevant for the `allocateIpAddress`
  mutation path).
- `POST /v1/apps` (both via flyctl and directly via the REST API) →
  **`Your account has been marked as high risk. Please go to
  https://fly.io/high-risk-unlock to verify your account.`** Every create
  operation is blocked account-wide; image push is also blocked since
  `registry.fly.io/<app>` requires the app to exist first.
- Confirmed clean exit state: `fly apps list` empty, GraphQL
  `creditBalance: 0` — nothing was created, $0 spent.

**Unblock (human action, browser-only):** visit
https://fly.io/high-risk-unlock signed in as mcgokul123@gmail.com and
complete verification (typically adding a credit card). Then re-run the
bring-up commands above unchanged.

Two hardening fixes were made in anticipation of the live run (both
typechecked): `IS_SANDBOX=1` is now passed in the machine env (Claude Code
refuses `--dangerously-skip-permissions` when running as root — which the
container does — unless this is set), and the machine `/wait?state=started`
call in `fly-provider.ts` retries up to 5×60s windows since a ~900MB cold
image pull can exceed a single window.

---

## What to record (fill this in during the live run)

| Metric | Value |
|---|---|
| Cold app+machine create → `/healthz` OK | |
| Warm re-run (existing image, new app) | |
| Time-to-first-agent-event (POST /run → first `claude` SSE line) | |
| openvscode-server ready (from machine start) | |
| Total wall time for a trivial instruction | |
| iframe embed result (headers-check + visual load in iframe-test.html) | |
| `x-frame-options` / `content-security-policy` seen | |
| Cost estimate printed by run-spike.ts | |
| Cleanup verified (`fly apps list` shows no leftover `forkai-sbx-*`) | |
| Any GraphQL `allocateIpAddress` failures / fallback to flyctl used? | |

---

## Port-mapping + IP-allocation notes (from API research)

- The **Machines REST API** (`https://api.machines.dev`) has confirmed
  endpoints for `POST /v1/apps`, `DELETE /v1/apps/:app`,
  `POST /v1/apps/:app/machines`, `.../machines/:id/start`,
  `.../machines/:id/wait?state=started&timeout=`, and
  `DELETE /v1/apps/:app/machines/:id?force=true` — all Bearer-token
  authenticated (`docs.machines.dev`, `fly.io/docs/machines/api/*`).
- **It has no IP-allocation endpoint.** `docs.machines.dev`'s resource list is
  exactly Apps / Machines / Volumes / Secrets / TLS Certificates / Tokens —
  nothing for IPs. IP allocation only exists on Fly's **undocumented GraphQL
  API** (`https://api.fly.io/graphql`, `allocateIpAddress` mutation, same
  bearer token) or in `flyctl` itself.
- **A shared IPv4 only routes ports 80/443, and only to a single service.**
  Per Fly's docs and community reports (see `fly-provider.ts` comments for
  links): *"An app with multiple services needs a dedicated global IPv4
  address; a shared one won't work with multiple services."* This spike needs
  two public services (8080 for the runner's SSE/health API, 3000 for
  openvscode-server), so `fly-provider.ts` **always allocates a dedicated
  (non-shared) IPv4** via the GraphQL mutation, falling back to shelling out
  to `fly ips allocate-v4 -a <app>` if the mutation fails, and throwing a
  clear "install flyctl and run this by hand" error if both fail. A dedicated
  IPv4 costs money (Fly's pricing page — verify current rate before a real
  build) — that cost is separate from the machine's own runtime cost.
- **Chosen port scheme:** service 1 maps machine-internal `8080` → external
  `80` (`http`) and `443` (`tls, http`) — this is the "default" service, so
  the runner is reachable at `https://<app>.fly.dev/`. Service 2 maps
  internal `3000` → external `10300` (`tls, http`), so openvscode-server is
  reachable at `https://<app>.fly.dev:10300/`. This was chosen because it's
  the simplest scheme that keeps both services on standard TLS termination
  without needing a reverse proxy inside the machine (which would have added
  a dependency, contradicting the "no deps" constraint on `runner.mjs`).
- Machine sizing: `guest: { cpu_kind: 'shared', cpus: 2, memory_mb: 4096 }` —
  a guess sized for "clone + claude + openvscode-server all resident at once
  without swapping." Not benchmarked against a real run; the live run should
  record actual memory pressure and right-size this.

---

## Security notes

- **`--dangerously-skip-permissions` is intentional here, not an oversight.**
  The Fly Machine is a single-use, single-tenant, network-isolated (from the
  user's own machine) throwaway sandbox that gets destroyed at the end of the
  run — the blast radius of an unconfirmed tool call is contained to that
  machine's own filesystem and its outbound network access, not the user's
  laptop. This is a materially different trust boundary than the local agent
  runner (`apps/code-api/src/agent/local/`), which runs against the user's
  own clone on the API host.
- **Both `RUN_TOKEN` and `VSCODE_TOKEN` are single-use, per-run, randomly
  generated in `run-spike.ts`** (`randomBytes(24).toString('base64url')`) and
  passed to the machine only as env vars — never written to disk, never
  logged. They die with the machine on `destroy()`. Anyone who obtains a
  `vscodeUrl` (which embeds `VSCODE_TOKEN` as `?tkn=`) has full read/write/
  terminal access to that one sandbox for its lifetime — treat it exactly
  like a bearer credential (don't paste it in a public channel, etc).
- **`repoUrl` may embed a clone credential** (e.g. a GitHub PAT as
  `https://<token>@github.com/...`). `runner.mjs` never logs the raw command
  line or URL; on a git failure it redacts anything matching
  `https://<user>@` before emitting the error over SSE. This is a
  best-effort regex, not a guarantee — don't rely on it for a
  high-sensitivity token.
- `ANTHROPIC_API_KEY` is passed straight through to the `claude` process's
  env — same trust model as the local runner already has.

## openvscode-server licensing note

`gitpod-io/openvscode-server` is **MIT-licensed** (a fork of Microsoft's
`vscode` repo with the proprietary bits — telemetry, marketplace, Microsoft
branding — stripped and replaced with the open VSX registry). It is designed
to be embedded in third-party products; that's the entire point of the
project. This is **not** the same as Microsoft's own `code-server`/VS Code
Server or `vscode.dev` tunnels product, which carry Microsoft's proprietary
license terms that explicitly prohibit embedding VS Code (with Microsoft
branding/marketplace) into a competing product. Using `openvscode-server`
here specifically avoids that restriction.

---

## Docker base image choice

`node:22-slim` (Debian bookworm), not `node:22-alpine`. openvscode-server's
release artifacts are glibc binaries with native modules (ripgrep, etc. — see
`gitpod-io/openvscode-server` releases); Alpine's musl libc would need the
separate, unofficial `-musl` build (`gitpodify/openvscode-releases-musl`),
not the upstream release feed this Dockerfile pins to. `-slim` keeps the
`apt` footprint (just `git curl ca-certificates`) small while staying
glibc-based — final image is 911MB, dominated by the Node/Debian base +
openvscode-server's ~75MB tarball extracted, not by anything this spike
added.

---

## Open questions (for the live run)

1. **Cold-boot latency end to end** — is "app create → dedicated IPv4 →
   machine create → wait started → healthz OK through the edge" fast enough
   (seconds, not tens of seconds) for a responsive product feature, or does
   it need a warm-pool of pre-created machines?
2. **Does the GraphQL `allocateIpAddress` mutation actually work as
   documented?** It's unofficial/undocumented — this spike's fallback to
   `fly ips allocate-v4 -a <app>` via flyctl may end up being the primary
   path in practice, not just a fallback.
3. **Does the dedicated-IPv4 two-service scheme actually route correctly**,
   or does `<app>.fly.dev:10300` need something this research missed (e.g.
   Fly may not proxy non-standard ports on the `*.fly.dev` wildcard cleanly)?
4. **iframe embedding** — does openvscode-server send any
   `X-Frame-Options`/`frame-ancestors` header out of the box that would block
   embedding, and if so, does it have a documented flag to disable it (vs.
   needing a reverse proxy to strip the header)?
5. **Real cost per run** — the `$0.00051/min` figure in `run-spike.ts` is an
   unverified placeholder; get the actual current shared-cpu-2x/4096mb Fly
   Machine rate from `fly.io/docs/about/pricing/` and update it.
6. **Image pull latency on a cold machine** — 911MB is not small; check
   whether Fly's registry pull is fast enough on `bom`, or whether the image
   needs slimming (e.g. is `git-man`/`liberror-perl` etc. pulled in by `apt
   install git` actually all needed, could a smaller openvscode-server
   variant be used).
