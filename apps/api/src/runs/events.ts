import type { Prisma } from "@open-agents/db";
import type {
  RunEventEnvelope,
  RunEventPayload,
  RunEventTypes,
} from "@open-agents/types";
import { prisma } from "../db.js";
import { createDurableEventLog } from "./eventLog.js";

/**
 * Per-run event log. Producers (the run-agent worker) call `appendEvent`
 * to insert + NOTIFY; consumers (the SSE handler) subscribe through the
 * shared LISTEN connection plus replay any backlog from the table.
 *
 * Postgres NOTIFY identifiers can be quoted strings (no length limit), but
 * to keep the channel namespace tidy we use a constant channel and pass a
 * compact runId + event-sequence pointer in the payload.
 */
export const NOTIFY_CHANNEL = "run_events";

export type LiveEvent = RunEventEnvelope & { runId: string };

export type AppendEventInput = {
  runId: string;
  type: RunEventTypes;
  payload: RunEventPayload;
};

const runEventLog = createDurableEventLog<
  "runId",
  RunEventTypes,
  RunEventPayload,
  RunEventEnvelope
>({
  name: "run-events",
  notifyChannel: NOTIFY_CHANNEL,
  idKey: "runId",
  emitterPrefix: "run",
  terminalTypes: ["run.succeeded", "run.failed", "run.cancelled"],
  readRow: (runId, seq) =>
    prisma.runEvent.findUnique({
      where: { runId_seq: { runId, seq } },
    }),
  readRows: (runId, afterSeq) =>
    prisma.runEvent.findMany({
      where: { runId, seq: { gt: afterSeq } },
      orderBy: { seq: "asc" },
    }),
  insertRow: async (tx, input) => {
    /**
     * Sequence allocation must be atomic per-run: the run-agent worker fans out
     * `appendEvent` calls fast enough that two transactions can both read the
     * same `MAX(seq)` under READ COMMITTED and both try to insert `seq = N+1`
     * → second one hits the `(runId, seq)` unique index. Even though pg-boss
     * gives each AgentRun to exactly one worker at a time, that single worker
     * still issues overlapping inserts.
     *
     * Fix: take a Postgres advisory **transaction** lock keyed on the runId at
     * the start of the transaction. `pg_advisory_xact_lock` blocks any other
     * transaction trying the same key until commit/rollback; concurrency
     * between different runs is unaffected. The lock is process-wide, so it
     * also covers the (rare) case of two pg-boss workers briefly believing
     * they own the same run during a redeploy.
     */
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.runId}, 0))`;
    const last = await tx.runEvent.findFirst({
      where: { runId: input.runId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const seq = (last?.seq ?? 0) + 1;
    return tx.runEvent.create({
      data: {
        runId: input.runId,
        seq,
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
      },
      select: { seq: true, type: true, payload: true, createdAt: true },
    });
  },
});

export async function stopRunEventsListener(): Promise<void> {
  await runEventLog.stop();
}

export async function appendEvent(input: AppendEventInput): Promise<RunEventEnvelope> {
  return runEventLog.append(input);
}

/**
 * Read the historical backlog for a run starting after `afterSeq`.
 */
export async function readBacklog(
  runId: string,
  afterSeq: number,
): Promise<RunEventEnvelope[]> {
  return runEventLog.readBacklog(runId, afterSeq);
}

/**
 * Subscribe to live events for a single run. Returns an `unsubscribe`
 * function. Handlers are async-safe (pg-boss can be slow); listeners are
 * fired sequentially so ordering with the Postgres backlog is preserved.
 */
export function subscribe(
  runId: string,
  handler: (env: RunEventEnvelope) => void | Promise<void>,
): () => void {
  return runEventLog.subscribe(runId, handler);
}

/**
 * Whether a run has reached a terminal status (and therefore no further
 * events will be appended). Used by the SSE handler to close the stream.
 */
export function isTerminalEvent(env: RunEventEnvelope): boolean {
  return runEventLog.isTerminalEvent(env);
}
