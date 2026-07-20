# Guest OCI image for OpenSandbox + Kata sandboxes.
#
# This is the image every agent sandbox boots from. It is intentionally pinned
# (no `latest`) and contains the managed-tool baseline the runtime assumes:
# bash, Node/TypeScript, Python, git, curl, ripgrep, and find. The workspace is
# a deterministic /workspace.
#
# Build and load it into the SAME Docker daemon the OpenSandbox Server drives
# (the host daemon, via the mounted socket):
#
#   docker build -t open-agents-opensandbox-guest:1.0.0 \
#     -f docker/opensandbox-guest.Dockerfile docker/
#
# Then point the app at it with OPENSANDBOX_IMAGE=open-agents-opensandbox-guest:1.0.0.
# For production, re-tag/pin by digest and host it in your own registry.

# Pinned base (Node 24 on Debian bookworm slim). Replace the tag with a
# digest (node@sha256:...) in production for full reproducibility.
FROM node:24.18.0-bookworm-slim

# Managed-tool baseline: python3, git, curl, ripgrep, find (findutils), plus
# CA certs and procps so the keep-alive entrypoint and health checks work.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    findutils \
    git \
    procps \
    python3 \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

# TypeScript runner available on PATH for TS execution inside the sandbox.
# Pinned so guest tooling does not drift.
RUN npm install -g tsx@4.20.6 typescript@5.9.3 \
  && npm cache clean --force

# Deterministic workspace the backend always uses (SANDBOX_WORKSPACE_DIR).
RUN mkdir -p /workspace
WORKDIR /workspace

# The OpenSandbox Server injects its own keep-alive entrypoint
# (`tail -f /dev/null`) at create time; no CMD is required here.
