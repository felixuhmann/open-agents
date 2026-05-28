import type { Job } from "pg-boss";
import { log } from "../log.js";
import {
  backfillSandboxesFromSessions,
  reconcileSandboxes,
} from "../services/sandboxes.js";
import { getBoss } from "./queue.js";
import { JOB_SANDBOX_RECONCILE, type SandboxReconcileJobData } from "./types.js";

/** Cron: every 6 hours (UTC). */
export const SANDBOX_RECONCILE_CRON = "0 */6 * * *";

export async function registerSandboxReconcileWorker(): Promise<void> {
  const boss = await getBoss();
  await boss.work<SandboxReconcileJobData>(JOB_SANDBOX_RECONCILE, async (jobs) => {
    for (const job of jobs) {
      await handleSandboxReconcile(job);
    }
  });

  await boss.schedule(JOB_SANDBOX_RECONCILE, SANDBOX_RECONCILE_CRON, {}, { tz: "UTC" });
  log.info("worker registered", {
    queue: JOB_SANDBOX_RECONCILE,
    schedule: SANDBOX_RECONCILE_CRON,
  });
}

async function handleSandboxReconcile(job: Job<SandboxReconcileJobData>): Promise<void> {
  log.info("sandbox-reconcile: start", { jobId: job.id });
  const backfilled = await backfillSandboxesFromSessions();
  if (backfilled > 0) {
    log.info("sandbox-reconcile: backfilled session rows", { count: backfilled });
  }
  const result = await reconcileSandboxes();
  log.info("sandbox-reconcile: done", { jobId: job.id, ...result });
}
