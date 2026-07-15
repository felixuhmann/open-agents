import { config } from "../config.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { appendEvent } from "../runs/events.js";

const STALE_RUN_BATCH_SIZE = 200;

/**
 * Repair AgentRun rows left in `running` when a worker process dies or an
 * upstream promise never settles. The conditional update makes this safe to
 * run concurrently with a worker completing normally.
 */
export async function reconcileStaleAgentRuns(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - config.AGENT_STALE_RUN_SECONDS * 1_000);
  const stale = await prisma.agentRun.findMany({
    where: { status: "running", startedAt: { lt: cutoff } },
    orderBy: { startedAt: "asc" },
    select: { id: true, startedAt: true },
    take: STALE_RUN_BATCH_SIZE,
  });

  let repaired = 0;
  const error = `Agent run exceeded the ${config.AGENT_STALE_RUN_SECONDS}-second stale-run limit`;
  for (const run of stale) {
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.agentRun.updateMany({
        where: { id: run.id, status: "running" },
        data: { status: "failed", completedAt: now, error },
      });
      if (updated.count > 0) {
        await tx.workflowStepRun.updateMany({
          where: { runId: run.id, status: "running" },
          data: { status: "failed", error },
        });
      }
      return updated.count;
    });
    if (result === 0) continue;

    repaired += 1;
    await appendEvent({
      runId: run.id,
      type: "run.failed",
      payload: { type: "run.failed", error },
    }).catch((eventError) => {
      log.warn("run-recovery: failed to append terminal event", {
        runId: run.id,
        err: String(eventError),
      });
    });
    log.warn("run-recovery: marked stale run failed", {
      runId: run.id,
      startedAt: run.startedAt.toISOString(),
      cutoff: cutoff.toISOString(),
    });
  }

  return repaired;
}
