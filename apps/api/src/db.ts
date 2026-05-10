import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@open-agents/db";
import { config } from "./config.js";

/**
 * Prisma 7 requires a driver adapter for SQL providers. We use `@prisma/adapter-pg`
 * (backed by `pg`, which is already a runtime dep for the LISTEN/NOTIFY connection
 * in `runs/events.ts`). The adapter owns its own connection pool — Prisma no longer
 * spawns a Rust query engine.
 */
const adapter = new PrismaPg({
  connectionString: config.DATABASE_URL,
});

export const prisma = new PrismaClient({
  adapter,
  log: ["warn", "error"],
});
