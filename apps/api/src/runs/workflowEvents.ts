import { EventEmitter } from "node:events";
import type { Prisma } from "@open-agents/db";
import { Client, type Notification } from "pg";
import type {
  WorkflowRunEventEnvelope,
  WorkflowRunEventPayload,
  WorkflowRunEventTypes,
} from "@open-agents/types";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { log } from "../log.js";

/**
 * Per-workflow-run event log. Mirrors `runs/events.ts` but on its own NOTIFY
 * channel + table so the workflow chat SSE can replay (`Last-Event-ID`) and
 * switch to live events independent of the per-agent run streams.
 */
export const WORKFLOW_NOTIFY_CHANNEL = "workflow_run_events";

export type WorkflowLiveEvent = WorkflowRunEventEnvelope & { workflowRunId: string };

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
      log.error("workflow-events listener error", { err: String(err) }),
    );
    await client.connect();
    await client.query(`LISTEN ${WORKFLOW_NOTIFY_CHANNEL}`);
    client.on("notification", (msg: Notification) => {
      if (msg.channel !== WORKFLOW_NOTIFY_CHANNEL || !msg.payload) return;
      try {
        const parsed = JSON.parse(msg.payload) as WorkflowLiveEvent;
        emitter.emit(`wf:${parsed.workflowRunId}`, parsed);
      } catch (err) {
        log.warn("workflow-events: bad NOTIFY payload", {
          err: String(err),
          payload: msg.payload,
        });
      }
    });
    listenerClient = client;
    log.info("workflow-events: LISTEN established");
  })();
  await listenerStarting;
}

export async function stopWorkflowEventsListener(): Promise<void> {
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

export type AppendWorkflowEventInput = {
  workflowRunId: string;
  type: WorkflowRunEventTypes;
  payload: WorkflowRunEventPayload;
};

/**
 * Insert one event row + NOTIFY subscribers. Sequence allocation is atomic
 * per-run via a Postgres advisory transaction lock (see `runs/events.ts`).
 */
export async function appendWorkflowEvent(
  input: AppendWorkflowEventInput,
): Promise<WorkflowRunEventEnvelope> {
  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.workflowRunId}, 1))`;
    const last = await tx.workflowRunEvent.findFirst({
      where: { workflowRunId: input.workflowRunId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const seq = (last?.seq ?? 0) + 1;
    return tx.workflowRunEvent.create({
      data: {
        workflowRunId: input.workflowRunId,
        seq,
        type: input.type,
        payload: input.payload,
      },
      select: { seq: true, type: true, payload: true, createdAt: true },
    });
  });
  const envelope: WorkflowRunEventEnvelope = {
    seq: created.seq,
    type: created.type as WorkflowRunEventTypes,
    createdAt: created.createdAt.toISOString(),
    payload: created.payload as WorkflowRunEventPayload,
  };
  await ensureListener();
  await listenerClient!.query(`SELECT pg_notify($1, $2)`, [
    WORKFLOW_NOTIFY_CHANNEL,
    JSON.stringify({ workflowRunId: input.workflowRunId, ...envelope }),
  ]);
  return envelope;
}

export async function readWorkflowBacklog(
  workflowRunId: string,
  afterSeq: number,
): Promise<WorkflowRunEventEnvelope[]> {
  const rows = await prisma.workflowRunEvent.findMany({
    where: { workflowRunId, seq: { gt: afterSeq } },
    orderBy: { seq: "asc" },
  });
  return rows.map(
    (r: { seq: number; type: string; payload: unknown; createdAt: Date }) => ({
      seq: r.seq,
      type: r.type as WorkflowRunEventTypes,
      createdAt: r.createdAt.toISOString(),
      payload: r.payload as WorkflowRunEventPayload,
    }),
  );
}

export function subscribeWorkflow(
  workflowRunId: string,
  handler: (env: WorkflowRunEventEnvelope) => void | Promise<void>,
): () => void {
  void ensureListener().catch((err) =>
    log.error("workflow-events: failed to start LISTEN", { err: String(err) }),
  );
  const wrapper = (event: WorkflowLiveEvent): void => {
    void handler(event);
  };
  const channel = `wf:${workflowRunId}`;
  emitter.on(channel, wrapper);
  return () => emitter.off(channel, wrapper);
}

export function isTerminalWorkflowEvent(env: WorkflowRunEventEnvelope): boolean {
  return env.type === "workflow.run.succeeded" || env.type === "workflow.run.failed";
}
