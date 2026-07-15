import type { RunEventEnvelope } from "@open-agents/types";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  HttpError,
  canOperateAgents,
  requireAgentAccess,
  requireUser,
} from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { log } from "../../log.js";
import { isTerminalEvent, readBacklog, subscribe } from "../../runs/events.js";
import type { AppVariables } from "../../server/types.js";
import { requestAgentRunCancellation } from "../../services/runCancellation.js";

export const runsRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * Resolve a run + assert the caller is allowed to see it. For chat surface
 * runs that means the run's conversation belongs to the calling user (or
 * the caller is an admin); for email surface runs we don't currently
 * expose any per-user UI so admin-only is enforced.
 */
async function resolveRunForCaller(c: Parameters<typeof requireUser>[0], runId: string) {
  const user = requireUser(c);
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "run not found");
  if (run.surface === "chat") {
    if (!run.conversationId) throw new HttpError(404, "run not found");
    const conv = await prisma.chatConversation.findUnique({
      where: { id: run.conversationId },
      select: { userId: true },
    });
    if (!conv) throw new HttpError(404, "run not found");
    if (conv.userId !== user.id && !canOperateAgents(user)) {
      throw new HttpError(403, "not your run");
    }
  } else if (run.surface === "workflow") {
    // Workflow step runs are owned by the workflow conversation's user.
    const stepRun = await prisma.workflowStepRun.findUnique({
      where: { runId: run.id },
      include: {
        workflowRun: {
          select: { conversation: { select: { userId: true } }, emailThreadId: true },
        },
      },
    });
    if (!stepRun) throw new HttpError(404, "run not found");
    const conv = stepRun.workflowRun.conversation;
    if (conv) {
      if (conv.userId !== user.id && !canOperateAgents(user)) {
        throw new HttpError(403, "not your run");
      }
    } else if (!canOperateAgents(user)) {
      throw new HttpError(403, "agent operator role required");
    }
  } else {
    if (!canOperateAgents(user)) throw new HttpError(403, "agent operator role required");
  }
  return { run, user };
}

runsRoutes.post("/:runId/stop", async (c) => {
  const runId = c.req.param("runId");
  const { run } = await resolveRunForCaller(c, runId);
  await requireAgentAccess(c, run.agentId);
  const status = await requestAgentRunCancellation(runId);
  return c.json({ runId, status });
});

/**
 * SSE endpoint for live run events with `Last-Event-ID` replay. Browser
 * sends `Last-Event-ID: <seq>` (handled automatically by EventSource on
 * reconnect); we read the backlog past that seq, then transition to
 * Postgres NOTIFY-driven live events. Closes when the run reaches a
 * terminal event.
 */
runsRoutes.get("/:runId/events", async (c) => {
  const runId = c.req.param("runId");
  // Per-conversation ownership (or operator role for email runs) — keeps
  // members from streaming another user's chat run on a shared agent.
  const { run } = await resolveRunForCaller(c, runId);
  // Defense in depth: also verify the caller still has access to the
  // owning agent (e.g. ACL changed mid-run).
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
      if (
        refreshed?.status === "succeeded" ||
        refreshed?.status === "failed" ||
        refreshed?.status === "cancelled"
      ) {
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

/**
 * List attachments the agent produced during a run via `attach_run_file`. Used
 * by the SPA chat to render assistant-message attachments alongside the text.
 */
runsRoutes.get("/:runId/attachments", async (c) => {
  const runId = c.req.param("runId");
  await resolveRunForCaller(c, runId);
  const rows = await prisma.agentAttachment.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      filename: true,
      contentType: true,
      sizeBytes: true,
      createdAt: true,
    },
  });
  return c.json({
    attachments: rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

/**
 * Download a single agent-uploaded attachment. Cookie-authenticated and
 * scoped through `resolveRunForCaller`, so a leaked attachment id by itself
 * does not grant access — the caller must own the parent conversation
 * (or be an admin).
 */
runsRoutes.get("/:runId/attachments/:attachmentId", async (c) => {
  const runId = c.req.param("runId");
  const attachmentId = c.req.param("attachmentId");
  await resolveRunForCaller(c, runId);
  const row = await prisma.agentAttachment.findUnique({
    where: { id: attachmentId },
  });
  if (row?.runId !== runId) throw new HttpError(404, "attachment not found");
  c.header("content-type", row.contentType || "application/octet-stream");
  c.header("content-length", String(row.sizeBytes));
  const safeName = row.filename.replace(/[^\w.\- ]+/g, "_") || "attachment";
  c.header("content-disposition", `attachment; filename="${safeName}"`);
  c.header("cache-control", "private, max-age=0, must-revalidate");
  return c.body(new Uint8Array(row.bytes));
});
