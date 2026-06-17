import { CreateScheduledTaskInput, UpdateScheduledTaskInput } from "@open-agents/types";
import { Hono } from "hono";
import {
  HttpError,
  requireAgentAccess,
  requireAgentOperator,
  requireUser,
  requireWorkflowAccess,
} from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";
import { getAgentBySlug } from "../../agents/service.js";
import { getWorkflowBySlug } from "../../workflows/service.js";
import { enqueueScheduledTask, nextCronDate } from "../../services/scheduledTasks.js";

export const scheduledTasksRoutes = new Hono<{ Variables: AppVariables }>();

function toTaskDto(task: Awaited<ReturnType<typeof loadTask>>) {
  if (!task) throw new HttpError(404, "scheduled task not found");
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    targetType: task.targetType,
    agent: task.agent,
    workflow: task.workflow,
    cron: task.cron,
    prompt: task.prompt,
    status: task.status,
    timezone: task.timezone,
    lastRunAt: task.lastRunAt?.toISOString() ?? null,
    nextRunAt: task.nextRunAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

async function loadTask(id: string) {
  return prisma.scheduledTask.findUnique({
    where: { id },
    include: {
      agent: { select: { id: true, slug: true, displayName: true, avatar: true } },
      workflow: { select: { id: true, slug: true, displayName: true } },
    },
  });
}

function runDto(run: {
  id: string;
  status: string;
  error: string | null;
  scheduledFor: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  conversationId: string | null;
  workflowConversationId: string | null;
  agentRunId: string | null;
  workflowRunId: string | null;
  createdAt: Date;
}) {
  return {
    id: run.id,
    status: run.status,
    error: run.error,
    scheduledFor: run.scheduledFor.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    conversationId: run.conversationId,
    workflowConversationId: run.workflowConversationId,
    agentRunId: run.agentRunId,
    workflowRunId: run.workflowRunId,
    createdAt: run.createdAt.toISOString(),
  };
}

scheduledTasksRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const tasks = await prisma.scheduledTask.findMany({
    where: { userId: user.id },
    include: {
      agent: { select: { id: true, slug: true, displayName: true, avatar: true } },
      workflow: { select: { id: true, slug: true, displayName: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return c.json({ tasks: tasks.map(toTaskDto) });
});

scheduledTasksRoutes.post("/", async (c) => {
  const user = requireUser(c);
  const body = CreateScheduledTaskInput.parse(await c.req.json());
  let agentId: string | undefined;
  let workflowId: string | undefined;
  if (body.targetType === "agent") {
    const agent = await getAgentBySlug(body.agentSlug!);
    if (!agent) throw new HttpError(404, "agent not found");
    await requireAgentAccess(c, agent.id);
    agentId = agent.id;
  } else {
    const workflow = await getWorkflowBySlug(body.workflowSlug!);
    if (!workflow) throw new HttpError(404, "workflow not found");
    await requireWorkflowAccess(c, workflow.id);
    workflowId = workflow.id;
  }
  const task = await prisma.scheduledTask.create({
    data: {
      name: body.name,
      description: body.description ?? null,
      targetType: body.targetType,
      agentId,
      workflowId,
      userId: user.id,
      cron: body.cron,
      prompt: body.prompt,
      timezone: body.timezone,
      status: body.status,
      nextRunAt: body.status === "active" ? nextCronDate(body.cron) : null,
    },
  });
  return c.json(toTaskDto(await loadTask(task.id)));
});

scheduledTasksRoutes.get("/:id", async (c) => {
  const user = requireUser(c);
  const task = await loadTask(c.req.param("id"));
  if (!task) throw new HttpError(404, "scheduled task not found");
  if (task.userId !== user.id) requireAgentOperator(c);
  return c.json(toTaskDto(task));
});

scheduledTasksRoutes.patch("/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const existing = await loadTask(id);
  if (!existing) throw new HttpError(404, "scheduled task not found");
  if (existing.userId !== user.id) throw new HttpError(403, "not your scheduled task");
  const body = UpdateScheduledTaskInput.parse(await c.req.json());
  const cron = body.cron ?? existing.cron;
  const status = body.status ?? existing.status;
  await prisma.scheduledTask.update({
    where: { id },
    data: {
      name: body.name,
      description: body.description,
      cron: body.cron,
      prompt: body.prompt,
      timezone: body.timezone,
      status: body.status,
      nextRunAt: status === "active" ? nextCronDate(cron) : null,
    },
  });
  return c.json(toTaskDto(await loadTask(id)));
});

scheduledTasksRoutes.delete("/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const existing = await loadTask(id);
  if (!existing) throw new HttpError(404, "scheduled task not found");
  if (existing.userId !== user.id) throw new HttpError(403, "not your scheduled task");
  await prisma.scheduledTask.delete({ where: { id } });
  return c.json({ ok: true });
});

scheduledTasksRoutes.post("/:id/run", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const existing = await loadTask(id);
  if (!existing) throw new HttpError(404, "scheduled task not found");
  if (existing.userId !== user.id) throw new HttpError(403, "not your scheduled task");
  const runId = await enqueueScheduledTask(id);
  return c.json({ runId });
});

scheduledTasksRoutes.get("/:id/runs", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const existing = await loadTask(id);
  if (!existing) throw new HttpError(404, "scheduled task not found");
  if (existing.userId !== user.id) requireAgentOperator(c);
  const runs = await prisma.scheduledTaskRun.findMany({
    where: { scheduledTaskId: id },
    orderBy: { scheduledFor: "desc" },
    take: 100,
  });
  return c.json({ runs: runs.map(runDto) });
});
