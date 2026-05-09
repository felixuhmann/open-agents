import { EventEmitter } from "node:events";
import type { Prisma } from "@open-agents/db";
import { Client, type Notification } from "pg";
import type {
  RunEventEnvelope,
  RunEventPayload,
  RunEventTypes,
} from "@open-agents/types";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { log } from "../log.js";

/**
 * Per-run event log. Producers (the run-agent worker) call `appendEvent`
 * to insert + NOTIFY; consumers (the SSE handler) subscribe through the
 * shared LISTEN connection plus replay any backlog from the table.
 *
 * Postgres NOTIFY identifiers can be quoted strings (no length limit), but
 * to keep the channel namespace tidy we use a constant prefix and pass the
 * runId in the payload.
 */
export const NOTIFY_CHANNEL = "run_events";

export type LiveEvent = RunEventEnvelope & { runId: string };

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

let listenerClient: Client | null = null;
let listenerStarting: Promise<void> | null = null;

async function ensureListener(): Promise<void> {
  if (listenerClient) return;
  if (listenerStarting) return listenerStarting;
  listenerStarting = (async () => {
    const client = new Client({ connectionString: config.DATABASE_URL });
    client.on("error", (err: unknown) =>
      log.error("run-events listener error", { err: String(err) }),
    );
    await client.connect();
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    client.on("notification", (msg: Notification) => {
      if (msg.channel !== NOTIFY_CHANNEL || !msg.payload) return;
      try {
        const parsed = JSON.parse(msg.payload) as LiveEvent;
        emitter.emit(`run:${parsed.runId}`, parsed);
      } catch (err) {
        log.warn("run-events: bad NOTIFY payload", {
          err: String(err),
          payload: msg.payload,
        });
      }
    });
    listenerClient = client;
    log.info("run-events: LISTEN established");
  })();
  await listenerStarting;
}

export async function stopRunEventsListener(): Promise<void> {
  if (listenerClient) {
    try {
      await listenerClient.query(`UNLISTEN *`);
      await listenerClient.end();
    } catch {
      // best-effort
    }
    listenerClient = null;
  }
  listenerStarting = null;
  emitter.removeAllListeners();
}

export type AppendEventInput = {
  runId: string;
  type: RunEventTypes;
  payload: RunEventPayload;
};

/**
 * Insert one event row + NOTIFY subscribers.
 *
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
export async function appendEvent(input: AppendEventInput): Promise<RunEventEnvelope> {
  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
  });
  const envelope: RunEventEnvelope = {
    seq: created.seq,
    type: created.type as RunEventTypes,
    createdAt: created.createdAt.toISOString(),
    payload: created.payload as RunEventPayload,
  };
  await ensureListener();
  // NOTIFY does not accept bind parameters (its payload must be a string
  // literal). Use pg_notify(channel, payload) which does.
  await listenerClient!.query(`SELECT pg_notify($1, $2)`, [
    NOTIFY_CHANNEL,
    JSON.stringify({ runId: input.runId, ...envelope }),
  ]);
  return envelope;
}

/**
 * Read the historical backlog for a run starting after `afterSeq`.
 */
export async function readBacklog(
  runId: string,
  afterSeq: number,
): Promise<RunEventEnvelope[]> {
  const rows = await prisma.runEvent.findMany({
    where: { runId, seq: { gt: afterSeq } },
    orderBy: { seq: "asc" },
  });
  return rows.map(
    (r: { seq: number; type: string; payload: unknown; createdAt: Date }) => ({
      seq: r.seq,
      type: r.type as RunEventTypes,
      createdAt: r.createdAt.toISOString(),
      payload: r.payload as RunEventPayload,
    }),
  );
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
  void ensureListener().catch((err) =>
    log.error("run-events: failed to start LISTEN", { err: String(err) }),
  );
  const wrapper = (event: LiveEvent): void => {
    void handler(event);
  };
  const channel = `run:${runId}`;
  emitter.on(channel, wrapper);
  return () => emitter.off(channel, wrapper);
}

/**
 * Whether a run has reached a terminal status (and therefore no further
 * events will be appended). Used by the SSE handler to close the stream.
 */
export function isTerminalEvent(env: RunEventEnvelope): boolean {
  return env.type === "run.succeeded" || env.type === "run.failed";
}
