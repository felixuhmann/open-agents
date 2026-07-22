# syntax=docker/dockerfile:1

# Unified production image: Hono API + built SPA + Prisma migrations on boot.
# The API process runs with CWD `apps/api` so `../web/dist` resolves correctly.

FROM node:24-bookworm-slim AS base
RUN apt-get update -qq \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app

# Install workspace dependencies (layer-cached on lockfile).
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/types/package.json packages/types/
COPY packages/tsconfig/package.json packages/tsconfig/
# The sandbox broker client is pinned as a local tarball until its public
# release exists, so it has to be present before install resolves it.
# See vendor/sandbox-broker/README.md for the swap to the release URL.
COPY vendor/ vendor/
# postinstall in @open-agents/db runs `prisma generate`, which needs
# prisma/schema.prisma — not copied in this stage. Codegen runs in `pnpm build`.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build API, SPA, and workspace packages.
FROM deps AS build
COPY . .
ARG DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
ENV DATABASE_URL=$DATABASE_URL
RUN pnpm build

# Minimal runtime filesystem.
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules

COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
RUN mkdir -p apps/api/data/skills

COPY --from=build /app/apps/web/dist ./apps/web/dist

COPY --from=build /app/packages/db/package.json ./packages/db/
COPY --from=build /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/prisma ./packages/db/prisma
COPY --from=build /app/packages/db/prisma.config.ts ./packages/db/prisma.config.ts

COPY --from=build /app/packages/types/package.json ./packages/types/
COPY --from=build /app/packages/types/node_modules ./packages/types/node_modules
COPY --from=build /app/packages/types/dist ./packages/types/dist

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/apps/api
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
