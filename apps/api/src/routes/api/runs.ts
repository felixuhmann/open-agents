import type { RunEventEnvelope } from "@open-agents/types";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { HttpError, requireAgentAccess, requireUser } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { log } from "../../log.js";
import { isTerminalEvent, readBacklog, subscribe } from "../../runs/events.js";
import type { AppVariables } from "../../server/types.js";

export const runsRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * SSE endpoint for live run events with `Last-Event-ID` replay. Browser
 * sends `Last-Event-ID: <seq>` (handled automatically by EventSource on
 * reconnect); we read the backlog past that seq, then transition to
 * Postgres NOTIFY-driven live events. Closes when the run reaches a
 * terminal event.
 */
runsRoutes.get("/:runId/events", async (c) => {
  requireUser(c);
  const runId = c.req.param("runId");
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "run not found");
  await requireAgentAccess(c, run.agentId);

  const lastEventIdHeader = c.req.header("last-event-id") ?? c.req.query("lastEventId");
  const afterSeq = lastEventIdHeader ? Number(lastEventIdHeader) : 0;

  return streamSSE(c, async (stream) => {
    let stopped = false;

    const send = async (env: RunEventEnvelope) => {
      await stream.writeSSE({
        id: String(env.seq),
        event: env.type,
        data: JSON.stringify(env),
      });
    };

    const queue: RunEventEnvelope[] = [];
    let live = false;

    const unsubscribe = subscribe(runId, (env) => {
      if (!live) {
        queue.push(env);
        return;
      }
      void send(env)
        .then(() => {
          if (isTerminalEvent(env)) {
            stopped = true;
            unsubscribe();
            void stream.close();
          }
        })
        .catch((err) => log.warn("runs: SSE write failed", { err: String(err), runId }));
    });

    try {
      const backlog = await readBacklog(runId, isFinite(afterSeq) ? afterSeq : 0);
      for (const env of backlog) {
        if (stopped) return;
        await send(env);
        if (isTerminalEvent(env)) {
          unsubscribe();
          return;
        }
      }
      live = true;
      while (queue.length > 0) {
        const env = queue.shift()!;
        if (env.seq <= (backlog[backlog.length - 1]?.seq ?? afterSeq)) continue;
        await send(env);
        if (isTerminalEvent(env)) {
          unsubscribe();
          return;
        }
      }

      const refreshed = await prisma.agentRun.findUnique({ where: { id: runId } });
      if (refreshed?.status === "succeeded" || refreshed?.status === "failed") {
        unsubscribe();
        return;
      }

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      });
    } catch (err) {
      log.warn("runs: SSE handler error", { err: String(err), runId });
      unsubscribe();
    }
  });
});
