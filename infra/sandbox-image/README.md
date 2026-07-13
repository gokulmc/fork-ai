# infra/sandbox-image — the forkai-code cloud sandbox image

Canonical source for the Fly Machine image `CloudAgentRunner`
(`apps/code-api/src/agent/cloud/`) boots one of per run. Promoted here from
`tools/spikes/cloud-sandbox/image/` once the design stabilized (single public
service + reverse proxy, shared IPv4) — see that spike's README for the
original feasibility findings (cold-boot timings, cost, iframe blockers) and
`tools/spikes/cloud-sandbox/src/fly-provider.ts` for the historical
two-public-service client this was ported from.

## What it is

A Debian-based image (`node:22-slim`) with the Claude Code CLI and
`openvscode-server` pre-installed. `runner.mjs` is the in-machine HTTP
server: it exposes the platform's own control endpoints under `/__forkai/*`
and reverse-proxies everything else — including WebSocket upgrades — to
`openvscode-server` on `127.0.0.1:3000`. That's what lets the whole sandbox
live behind one public Fly service on port 8080 instead of two.

## Build + push

```bash
docker build --platform linux/amd64 -t registry.fly.io/forkai-sbx-base:latest .
fly auth docker
docker push registry.fly.io/forkai-sbx-base:latest
```

`--platform linux/amd64` is required regardless of the build host's own
architecture — Fly Machines default to x86_64 hosts.

## Runner HTTP contract

| Route | Auth | Purpose |
|---|---|---|
| `GET /__forkai/healthz` | none | liveness probe — polled by `FlyProvider.create` through the public edge |
| `POST /__forkai/run` | `Authorization: Bearer <RUN_TOKEN>` | SSE stream: clones `repoUrl`, runs `claude -p <instruction>`, commits only if the tree is dirty post-run, emits translated agent events + a final `result` frame (`sha`/`baseSha`/`diffSummary`) |
| everything else, incl. WebSocket upgrades | openvscode-server's own `?tkn=`/cookie auth | reverse-proxied to `127.0.0.1:3000` — this is how the browser reaches the VS Code UI, its file tree, and its terminals |

`RUN_TOKEN` gates `/__forkai/*` only. The proxy never checks it on vscode
paths — the browser has no way to attach a bearer header to a plain
navigation, so vscode's own connection-token auth is what protects it.

See `runner.mjs`'s header comment for the exfiltration-hardening notes:
`ANTHROPIC_API_KEY` travels in the `/__forkai/run` request body, never
machine env, and openvscode is spawned with a sanitized env (no key, no
`RUN_TOKEN`) so a user poking around their own sandbox terminal can't read
the shared platform key.
