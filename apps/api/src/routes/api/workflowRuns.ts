import type { WorkflowRunEventEnvelope } from "@open-agents/types";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  HttpError,
  canOperateAgents,
  requireUser,
  requireWorkflowAccess,
} from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { log } from "../../log.js";
import {
  isTerminalWorkflowEvent,
  readWorkflowBacklog,
  subscribeWorkflow,
} from "../../runs/workflowEvents.js";
import type { AppVariables } from "../../server/types.js";
import { requestWorkflowRunCancellation } from "../../services/runCancellation.js";

export const workflowRunsRoutes = new Hono<{ Variables: AppVariables }>();

async function resolveWorkflowRunForCaller(
  c: Parameters<typeof requireUser>[0],
  workflowRunId: string,
) {
  const user = requireUser(c);
  const run = await prisma.workflowRun.findUnique({
    where: { id: workflowRunId },
    include: {
      conversation: { select: { userId: true } },
      emailThread: { select: { userEmail: true } },
    },
  });
  if (!run) throw new HttpError(404, "run not found");
  if (run.conversation) {
    if (run.conversation.userId !== user.id && !canOperateAgents(user)) {
      throw new HttpError(403, "not your run");
    }
  } else if (!canOperateAgents(user)) {
    throw new HttpError(403, "agent operator role required");
  }
  return run;
}

workflowRunsRoutes.post("/:workflowRunId/stop", async (c) => {
  const workflowRunId = c.req.param("workflowRunId");
  const run = await resolveWorkflowRunForCaller(c, workflowRunId);
  await requireWorkflowAccess(c, run.workflowId);
  const status = await requestWorkflowRunCancellation(workflowRunId);
  return c.json({ workflowRunId, status });
});

workflowRunsRoutes.get("/:workflowRunId/events", async (c) => {
  const workflowRunId = c.req.param("workflowRunId");
  const run = await resolveWorkflowRunForCaller(c, workflowRunId);
  await requireWorkflowAccess(c, run.workflowId);

  const lastEventIdHeader = c.req.header("last-event-id") ?? c.req.query("lastEventId");
  const afterSeq = lastEventIdHeader ? Number(lastEventIdHeader) : 0;

  return streamSSE(c, async (stream) => {
    let stopped = false;

    const send = async (env: WorkflowRunEventEnvelope) => {
      await stream.writeSSE({
        id: String(env.seq),
        event: env.type,
        data: JSON.stringify(env),
      });
    };

    const queue: WorkflowRunEventEnvelope[] = [];
    let live = false;

    const unsubscribe = subscribeWorkflow(workflowRunId, (env) => {
      if (!live) {
        queue.push(env);
        return;
      }
      void send(env)
        .then(() => {
          if (isTerminalWorkflowEvent(env)) {
            stopped = true;
            unsubscribe();
            void stream.close();
          }
        })
        .catch((err) =>
          log.warn("workflow-runs: SSE write failed", {
            err: String(err),
            workflowRunId,
          }),
        );
    });

    try {
      const backlog = await readWorkflowBacklog(
        workflowRunId,
        isFinite(afterSeq) ? afterSeq : 0,
      );
      for (const env of backlog) {
        if (stopped) return;
        await send(env);
        if (isTerminalWorkflowEvent(env)) {
          unsubscribe();
          return;
        }
      }
      live = true;
      while (queue.length > 0) {
        const env = queue.shift()!;
        if (env.seq <= (backlog[backlog.length - 1]?.seq ?? afterSeq)) continue;
        await send(env);
        if (isTerminalWorkflowEvent(env)) {
          unsubscribe();
          return;
        }
      }

      const refreshed = await prisma.workflowRun.findUnique({
        where: { id: workflowRunId },
      });
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
      log.warn("workflow-runs: SSE handler error", {
        err: String(err),
        workflowRunId,
      });
      unsubscribe();
    }
  });
});
