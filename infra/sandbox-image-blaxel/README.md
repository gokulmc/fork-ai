# infra/sandbox-image-blaxel — the Blaxel variant of the sandbox image

The Blaxel counterpart of `../sandbox-image/` (the Fly image). Same job — the
per-run VM that clones a repo, runs `claude`, commits, pushes back, and serves
openvscode — but built for Blaxel's runtime instead of Fly's.

## Why it differs from the Fly image

A Blaxel sandbox bundles **`sandbox-api`**, Blaxel's own control binary on port
**8080** — that's what the `@blaxel/core` SDK talks to for lifecycle, `exec`,
filesystem, and previews. Our `runner.mjs` also wants 8080 (its `/__forkai/*`
API + openvscode proxy), so here it moves to **8081** (`RUNNER_PORT`), and
`BlaxelProvider` creates the public preview against 8081. On Fly, runner.mjs
keeps 8080 — the `RUNNER_PORT` env defaults to 8080, so the Fly image and its
behaviour are unchanged.

| Port | Process | Exposure |
|---|---|---|
| 8080 | `sandbox-api` (Blaxel) | platform control channel (SDK) |
| 8081 | `runner.mjs` (ours) | public preview → `/__forkai/run` + VS Code |
| 3000 | openvscode-server | 127.0.0.1 only, proxied by runner.mjs |

`entrypoint.sh` starts sandbox-api in the background and `runner.mjs` in the
foreground (so the container's life tracks the runner, like the Fly `CMD`).

## Single source of truth for runner.mjs

`runner.mjs` is **not committed here** — `build.sh` copies it from
`../sandbox-image/runner.mjs` right before `bl push` and deletes it after (it's
gitignored). A `runner.mjs` change is made once, in `../sandbox-image/`, and
must be re-pushed to **both** images (Fly registry + Blaxel) — same invisible
"old code silently runs" failure mode called out in the Fly image's README and
`docs/forkai-code/deploy-cloud-runner.md`.

## Build + push

```bash
# bl CLI logged in, or BL_API_KEY + BL_WORKSPACE in the env:
sh build.sh
# → Blaxel builds the image remotely (no local Docker) and prints the ref.
# Set that ref as BLAXEL_SANDBOX_IMAGE (apps/code-api/.env + prod EB env).
```
