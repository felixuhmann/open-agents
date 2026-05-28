import { serve } from "@hono/node-server";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { getBoss, stopBoss } from "../jobs/queue.js";
import { registerRunAgentWorker } from "../jobs/runAgent.js";
import { registerSandboxReconcileWorker } from "../jobs/sandboxReconcile.js";
import { registerSendEmailWorker } from "../jobs/sendEmail.js";
import { backfillSandboxesFromSessions } from "../services/sandboxes.js";
import { log } from "../log.js";
import { stopRunEventsListener } from "../runs/events.js";
import { seedToolCatalog } from "../services/seedToolCatalog.js";
import { buildApp } from "./app.js";

/**
 * Process bootstrap. Order matters:
 *
 * 1. Connect Prisma — every worker / route assumes the client is up.
 * 2. Seed the curated MCP tool catalog so the UI shows what's available.
 * 3. Start pg-boss + register workers.
 * 4. Build the app and start listening.
 * 5. Install signal handlers so SIGINT / SIGTERM drain pg-boss, close the
 *    LISTEN connection, and disconnect Prisma cleanly.
 *
 * Anthropic / Mailgun credentials are NOT validated here — they live in
 * the encrypted Secret store and may not be populated yet (the first-run
 * /setup wizard captures them). Workers fail fast with a clear error
 * message when the wizard hasn't been completed.
 */
export async function bootstrap(): Promise<void> {
  log.info("starting open-agents", { port: config.PORT });

  await prisma.$connect();
  await seedToolCatalog();
  await getBoss();
  await registerRunAgentWorker();
  await registerSendEmailWorker();
  const backfilled = await backfillSandboxesFromSessions();
  if (backfilled > 0) {
    log.info("backfilled AgentSandbox rows from existing sessions", {
      count: backfilled,
    });
  }
  await registerSandboxReconcileWorker();

  const app = buildApp();

  const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    log.info("listening", { port: info.port });
  });

  const shutdown = async (signal: string) => {
    log.info("shutting down", { signal });
    server.close();
    try {
      await stopRunEventsListener();
    } catch (err) {
      log.warn("error stopping run-events listener", { err: String(err) });
    }
    try {
      await stopBoss();
    } catch (err) {
      log.warn("error stopping pg-boss", { err: String(err) });
    }
    try {
      await prisma.$disconnect();
    } catch (err) {
      log.warn("error disconnecting prisma", { err: String(err) });
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
