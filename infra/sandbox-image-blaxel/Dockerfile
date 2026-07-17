# The forkai-code cloud sandbox image, Blaxel variant (see README.md). It is
# the Fly image (infra/sandbox-image/) PLUS Blaxel's own `sandbox-api` control
# binary — the process the @blaxel/core SDK talks to for lifecycle/exec/preview.
#
# Port map (the whole reason this diverges from the Fly image):
#   8080  sandbox-api   — Blaxel's control plane, owned by the platform
#   8081  runner.mjs    — OUR control API + openvscode reverse-proxy (RUNNER_PORT)
#   3000  openvscode    — 127.0.0.1 only, proxied by runner.mjs (unchanged)
# On Fly, runner.mjs owns 8080; here it moves to 8081 so sandbox-api can keep
# 8080. runner.mjs reads RUNNER_PORT (default 8080) — set to 8081 by entrypoint.
#
# runner.mjs is COPIED IN by build.sh from ../sandbox-image/runner.mjs at push
# time (gitignored here) — single source of truth, no drift.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# openvscode-server — same pin as the Fly image. linux-x64: Blaxel sandboxes
# are x86_64 microVMs (like Fly); a runtime that turns out to be arm64 would
# need the -arm64 tarball here instead.
ARG OPENVSCODE_VERSION=1.109.5
RUN curl -fsSL -o /tmp/openvscode.tar.gz \
      "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${OPENVSCODE_VERSION}/openvscode-server-v${OPENVSCODE_VERSION}-linux-x64.tar.gz" \
    && mkdir -p /opt/openvscode \
    && tar -xzf /tmp/openvscode.tar.gz -C /opt/openvscode --strip-components=1 \
    && rm /tmp/openvscode.tar.gz

# Blaxel's control binary — public GHCR image, no registry creds needed. This
# is what makes it a real Blaxel sandbox (SDK process/fs/preview talk to it).
COPY --from=ghcr.io/blaxel-ai/sandbox:latest /sandbox-api /usr/local/bin/sandbox-api

COPY runner.mjs /runner.mjs
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /usr/local/bin/sandbox-api

# 8080 (sandbox-api) is the platform control port; 8081 is our preview'd runner.
EXPOSE 8080 8081
ENTRYPOINT ["/entrypoint.sh"]
