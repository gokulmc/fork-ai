# THROWAWAY spike image — see ../README.md for the feasibility question this
# proves. node:22-slim (Debian, not Alpine): openvscode-server ships glibc
# binaries with native modules (ripgrep, etc.); Alpine's musl libc needs a
# separate "-musl" build that gitpod-io only publishes unofficially
# (gitpodify/openvscode-releases-musl, not the upstream release feed this
# Dockerfile pins against). -slim keeps the apt footprint small while staying
# glibc-based, which matters for Fly Machine cold-start / image pull time.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# Pinned against the latest release at spike-authoring time (verified via
# `gh api repos/gitpod-io/openvscode-server/releases/latest`). linux-x64
# because Fly Machines default to x86_64 hosts — see README's "Docker base
# image" note for why this must match --platform linux/amd64 at build time.
ARG OPENVSCODE_VERSION=1.109.5
RUN curl -fsSL -o /tmp/openvscode.tar.gz \
      "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${OPENVSCODE_VERSION}/openvscode-server-v${OPENVSCODE_VERSION}-linux-x64.tar.gz" \
    && mkdir -p /opt/openvscode \
    && tar -xzf /tmp/openvscode.tar.gz -C /opt/openvscode --strip-components=1 \
    && rm /tmp/openvscode.tar.gz

COPY runner.mjs /runner.mjs

EXPOSE 8080 3000
CMD ["node", "/runner.mjs"]
