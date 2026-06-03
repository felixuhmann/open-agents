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
import { defineConfig } from "prisma/config";

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

/**
 * Why `process.env` and not Prisma's `env()` helper?
 *
 * `env("DATABASE_URL")` throws at config-load time when the variable is
 * missing, which breaks any command that doesn't actually need a live DB.
 * The Docker image build runs `prisma generate` (codegen
 * only — Prisma 7 has no Rust query engine for SQL providers, so generate
 * never connects) and there's no reason to inject a real `DATABASE_URL`
 * into the build environment.
 *
 * The placeholder URL below is therefore ONLY ever read during codegen,
 * `prisma format`, and similar offline tooling. Every command that
 * actually opens a connection (`prisma migrate dev`, `prisma migrate
 * deploy`, `prisma studio`, the API at runtime) is launched with the
 * real `DATABASE_URL` already set — by `dotenv` above in dev, by the
 * host in production. If you somehow run a connecting command without
 * setting it, the connection itself will fail with a clear error long
 * before this placeholder causes any confusion.
 */
const PLACEHOLDER_DATABASE_URL =
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? PLACEHOLDER_DATABASE_URL,
  },
});
