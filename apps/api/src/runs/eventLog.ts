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

  const toEnvelope = (row: EventRow): EventEnvelope =>
    ({
      seq: row.seq,
      type: row.type as EventType,
      createdAt: row.createdAt.toISOString(),
      payload: row.payload as EventPayload,
    }) as EventEnvelope;

  const eventName = (id: string): string => `${options.emitterPrefix}:${id}`;

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
          const parsed = JSON.parse(msg.payload) as LiveEvent;
          emitter.emit(eventName(parsed[options.idKey]), parsed);
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
    emitter.removeAllListeners();
  }

  async function append(
    input: AppendInput<IdKey, EventType, EventPayload>,
  ): Promise<EventEnvelope> {
    const created = await prisma.$transaction((tx: Prisma.TransactionClient) =>
      options.insertRow(tx, input),
    );
    const envelope = toEnvelope(created);
    await ensureListener();
    await listenerClient!.query(`SELECT pg_notify($1, $2)`, [
      options.notifyChannel,
      JSON.stringify({ [options.idKey]: input[options.idKey], ...envelope }),
    ]);
    return envelope;
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
