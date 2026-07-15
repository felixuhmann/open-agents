import { EventEmitter } from "node:events";
import type { Prisma } from "@open-agents/db";
import { Client, type Notification } from "pg";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { log } from "../log.js";

type EventRow = {
  seq: number;
  type: string;
  payload: unknown;
  createdAt: Date;
};

type AppendInput<IdKey extends string, EventType extends string, EventPayload> = Record<
  IdKey,
  string
> & {
  type: EventType;
  payload: EventPayload;
};

type EventLogOptions<IdKey extends string, EventType extends string, EventPayload> = {
  name: string;
  notifyChannel: string;
  idKey: IdKey;
  emitterPrefix: string;
  terminalTypes: readonly EventType[];
  readRow: (id: string, seq: number) => Promise<EventRow | null>;
  readRows: (id: string, afterSeq: number) => Promise<EventRow[]>;
  insertRow: (
    tx: Prisma.TransactionClient,
    input: AppendInput<IdKey, EventType, EventPayload>,
  ) => Promise<EventRow>;
};

/**
 * Build a durable per-entity event log backed by a Prisma table plus Postgres
 * LISTEN/NOTIFY. Agent runs and workflow runs use the same replay/live-SSE
 * contract; this factory keeps listener lifecycle, payload parsing, NOTIFY,
 * backlog mapping, and terminal-event checks in one place while each caller
 * supplies its own table-specific insert/read functions.
 */
export function createDurableEventLog<
  IdKey extends string,
  EventType extends string,
  EventPayload,
  EventEnvelope extends {
    seq: number;
    type: EventType;
    createdAt: string;
    payload: EventPayload;
  },
>(options: EventLogOptions<IdKey, EventType, EventPayload>) {
  type LiveEvent = EventEnvelope & Record<IdKey, string>;

  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  let listenerClient: Client | null = null;
  let listenerStarting: Promise<void> | null = null;
  const notificationTails = new Map<string, Promise<void>>();

  const toEnvelope = (row: EventRow): EventEnvelope =>
    ({
      seq: row.seq,
      type: row.type as EventType,
      createdAt: row.createdAt.toISOString(),
      payload: row.payload as EventPayload,
    }) as EventEnvelope;

  const eventName = (id: string): string => `${options.emitterPrefix}:${id}`;

  function dispatchNotification(id: string, seq: number): void {
    // Loading durable rows is asynchronous. Chain reads per entity so
    // subscribers still observe the transaction/NOTIFY order.
    const previous = notificationTails.get(id) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const row = await options.readRow(id, seq);
        if (!row) {
          log.warn(`${options.name}: NOTIFY event row not found`, { id, seq });
          return;
        }
        const liveEvent = {
          [options.idKey]: id,
          ...toEnvelope(row),
        } as LiveEvent;
        emitter.emit(eventName(id), liveEvent);
      });
    notificationTails.set(id, current);
    void current
      .catch((err: unknown) =>
        log.warn(`${options.name}: failed to load NOTIFY event`, {
          id,
          seq,
          err: String(err),
        }),
      )
      .finally(() => {
        if (notificationTails.get(id) === current) notificationTails.delete(id);
      });
  }

  async function ensureListener(): Promise<void> {
    if (listenerClient) return;
    if (listenerStarting) return listenerStarting;
    listenerStarting = (async () => {
      const client = new Client({ connectionString: config.DATABASE_URL });
      client.on("error", (err: unknown) =>
        log.error(`${options.name} listener error`, { err: String(err) }),
      );
      await client.connect();
      await client.query(`LISTEN ${options.notifyChannel}`);
      client.on("notification", (msg: Notification) => {
        if (msg.channel !== options.notifyChannel || !msg.payload) return;
        try {
          const parsed = JSON.parse(msg.payload) as Record<string, unknown>;
          const id = parsed[options.idKey];
          const seq = parsed.seq;
          if (typeof id !== "string" || typeof seq !== "number") {
            throw new Error("expected an event id and numeric seq");
          }
          dispatchNotification(id, seq);
        } catch (err) {
          log.warn(`${options.name}: bad NOTIFY payload`, {
            err: String(err),
            payload: msg.payload,
          });
        }
      });
      listenerClient = client;
      log.info(`${options.name}: LISTEN established`);
    })().catch((err: unknown) => {
      listenerStarting = null;
      throw err;
    });
    await listenerStarting;
  }

  async function stop(): Promise<void> {
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
    notificationTails.clear();
    emitter.removeAllListeners();
  }

  async function append(
    input: AppendInput<IdKey, EventType, EventPayload>,
  ): Promise<EventEnvelope> {
    await ensureListener();
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = await options.insertRow(tx, input);
      // PostgreSQL limits NOTIFY payloads to roughly 8 KiB. Publish only a
      // compact pointer and let every listener load the canonical event row.
      // Running both operations in one transaction prevents partial success.
      const notification = JSON.stringify({
        [options.idKey]: input[options.idKey],
        seq: row.seq,
      });
      await tx.$executeRaw`SELECT pg_notify(${options.notifyChannel}, ${notification})`;
      return row;
    });
    return toEnvelope(created);
  }

  async function readBacklog(id: string, afterSeq: number): Promise<EventEnvelope[]> {
    const rows = await options.readRows(id, afterSeq);
    return rows.map(toEnvelope);
  }

  function subscribe(
    id: string,
    handler: (env: EventEnvelope) => void | Promise<void>,
  ): () => void {
    void ensureListener().catch((err) =>
      log.error(`${options.name}: failed to start LISTEN`, { err: String(err) }),
    );
    const wrapper = (event: LiveEvent): void => {
      void handler(event);
    };
    const channel = eventName(id);
    emitter.on(channel, wrapper);
    return () => emitter.off(channel, wrapper);
  }

  function isTerminalEvent(env: EventEnvelope): boolean {
    return options.terminalTypes.includes(env.type);
  }

  return {
    append,
    isTerminalEvent,
    readBacklog,
    stop,
    subscribe,
  };
}
