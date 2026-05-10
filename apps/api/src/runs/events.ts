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
 * Insert one event row + NOTIFY subscribers. Sequence is allocated via
 * a `MAX(seq)+1` CTE under a transaction to avoid races inside a single
 * worker; cross-worker contention is impossible because each AgentRun is
 * processed by exactly one pg-boss handler at a time.
 */
export async function appendEvent(input: AppendEventInput): Promise<RunEventEnvelope> {
  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
  await listenerClient!.query(`NOTIFY ${NOTIFY_CHANNEL}, $1`, [
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
