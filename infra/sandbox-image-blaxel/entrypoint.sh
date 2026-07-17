#!/bin/sh
# Starts BOTH control planes: Blaxel's sandbox-api (8080, background — the SDK
# talks to it) and our runner.mjs (8081, foreground — the /__forkai/run API +
# openvscode proxy). runner.mjs stays in the foreground so the container's life
# tracks it, same as `CMD ["node","/runner.mjs"]` does on the Fly image; if it
# exits, the sandbox is done. RUNNER_PORT moves runner off 8080 (sandbox-api's).
set -e

export RUNNER_PORT="${RUNNER_PORT:-8081}"

/usr/local/bin/sandbox-api &

exec node /runner.mjs
