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
RUN pnpm install --frozen-lockfile

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
COPY --from=build /app/apps/api/dist ./apps/api/dist
RUN mkdir -p apps/api/data/skills

COPY --from=build /app/apps/web/dist ./apps/web/dist

COPY --from=build /app/packages/db/package.json ./packages/db/
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/prisma ./packages/db/prisma
COPY --from=build /app/packages/db/prisma.config.ts ./packages/db/prisma.config.ts

COPY --from=build /app/packages/types/package.json ./packages/types/
COPY --from=build /app/packages/types/dist ./packages/types/dist

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/apps/api
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
