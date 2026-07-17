#!/bin/sh
# Build + push the Blaxel sandbox image via `bl push` (Blaxel builds it remotely
# — no local Docker). runner.mjs is copied in from the single source next door
# so this dir never holds a drifting second copy; the copy is gitignored and
# removed afterwards.
#
# Requires: bl CLI logged in (or BL_API_KEY + BL_WORKSPACE in the env). Run from
# this directory: `sh build.sh`.
set -e
cd "$(dirname "$0")"

cp ../sandbox-image/runner.mjs ./runner.mjs
trap 'rm -f ./runner.mjs' EXIT

# --type sandbox is redundant with blaxel.toml but explicit; -y skips prompts.
bl push --type sandbox -y "$@"

echo
echo "Pushed. Set BLAXEL_SANDBOX_IMAGE to the image ref above on:"
echo "  - apps/code-api/.env (local)"
echo "  - forkai-code-api-prod EB env (prod, when authorized)"
