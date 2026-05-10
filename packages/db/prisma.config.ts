/**
 * Prisma 7 CLI configuration. Replaces the implicit env-loading and the
 * inline `url = env("DATABASE_URL")` we used to declare in `schema.prisma`.
 *
 * Loads `.env` from any of the canonical locations in this monorepo so that
 * `pnpm db:migrate`, `pnpm db:generate`, etc. work whether you keep your env
 * file at the repo root or alongside the API app (the legacy location).
 * Production env vars are set on the host directly and don't need a file.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

const here = fileURLToPath(new URL(".", import.meta.url));

const ENV_CANDIDATES = [
  `${here}.env`, // packages/db/.env (rare; explicit override)
  `${here}../../.env`, // monorepo root
  `${here}../../apps/api/.env`, // legacy location used by the API app today
];

for (const path of ENV_CANDIDATES) {
  if (existsSync(path)) {
    loadEnv({ path, override: false });
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
