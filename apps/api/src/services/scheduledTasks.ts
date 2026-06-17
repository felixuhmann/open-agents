import { prisma } from "../db.js";
import { getBoss } from "../jobs/queue.js";
import { JOB_RUN_SCHEDULED_TASK, type RunScheduledTaskJobData } from "../jobs/types.js";
import { enqueueChatTurn } from "./chat.js";
import { enqueueWorkflowTurn } from "./workflowChat.js";

function matchesCronField(
  field: string,
  value: number,
  min: number,
  max: number,
): boolean {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const step = Number(field.slice(2));
    return Number.isInteger(step) && step > 0 && (value - min) % step === 0;
  }
  return field.split(",").some((part) => {
    const parsed = Number(part);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max && parsed === value;
  });
}

function matchesCron(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron must have five fields");
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  return (
    matchesCronField(minute, date.getUTCMinutes(), 0, 59) &&
    matchesCronField(hour, date.getUTCHours(), 0, 23) &&
    matchesCronField(dayOfMonth, date.getUTCDate(), 1, 31) &&
    matchesCronField(month, date.getUTCMonth() + 1, 1, 12) &&
    matchesCronField(dayOfWeek, date.getUTCDay(), 0, 6)
  );
}

export function nextCronDate(cron: string, currentDate = new Date()): Date {
  const next = new Date(currentDate);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    if (matchesCron(cron, next)) return next;
    next.setUTCMinutes(next.getUTCMinutes() + 1);
  }
  throw new Error("Cron did not match any time in the next year");
}

function titleFromTask(name: string): string {
  return `Scheduled: ${name}`.slice(0, 120);
}

export async function enqueueScheduledTask(taskId: string, scheduledFor = new Date()) {
  const run = await prisma.scheduledTaskRun.create({
    data: { scheduledTaskId: taskId, scheduledFor, status: "pending" },
  });
  const boss = await getBoss();
  const data: RunScheduledTaskJobData = { scheduledTaskRunId: run.id };
  await boss.send(JOB_RUN_SCHEDULED_TASK, data);
  return run.id;
}

export async function executeScheduledTaskRun(scheduledTaskRunId: string): Promise<void> {
  const run = await prisma.scheduledTaskRun.findUnique({
    where: { id: scheduledTaskRunId },
    include: { scheduledTask: { include: { agent: true, workflow: true } } },
  });
  if (!run) throw new Error(`Scheduled task run not found: ${scheduledTaskRunId}`);
  const task = run.scheduledTask;
  await prisma.scheduledTaskRun.update({
    where: { id: run.id },
    data: { status: "running", startedAt: new Date() },
  });

  try {
    if (task.targetType === "agent") {
      if (!task.agent) throw new Error("Scheduled task agent no longer exists");
      const conv = await prisma.chatConversation.create({
        data: {
          agentId: task.agent.id,
          userId: task.userId,
          title: titleFromTask(task.name),
        },
      });
      const message = await prisma.chatMessage.create({
        data: { conversationId: conv.id, role: "user", content: task.prompt },
      });
      const agentRunId = await enqueueChatTurn({
        conversationId: conv.id,
        userMessageId: message.id,
      });
      await prisma.scheduledTaskRun.update({
        where: { id: run.id },
        data: { conversationId: conv.id, agentRunId },
      });
      return;
    }

    if (!task.workflow) throw new Error("Scheduled task workflow no longer exists");
    const conv = await prisma.workflowConversation.create({
      data: {
        workflowId: task.workflow.id,
        userId: task.userId,
        title: titleFromTask(task.name),
      },
    });
    await prisma.workflowMessage.create({
      data: { conversationId: conv.id, role: "user", content: task.prompt },
    });
    const workflowRunId = await enqueueWorkflowTurn({ conversationId: conv.id });
    await prisma.scheduledTaskRun.update({
      where: { id: run.id },
      data: { workflowConversationId: conv.id, workflowRunId },
    });
  } catch (err) {
    await prisma.scheduledTaskRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      },
    });
  }
}

export async function syncScheduledTaskRunStatuses(): Promise<void> {
  const running = await prisma.scheduledTaskRun.findMany({
    where: { status: "running" },
    select: { id: true, agentRunId: true, workflowRunId: true },
    take: 200,
  });
  for (const item of running) {
    if (item.agentRunId) {
      const agentRun = await prisma.agentRun.findUnique({
        where: { id: item.agentRunId },
      });
      if (agentRun && ["succeeded", "failed"].includes(agentRun.status)) {
        await prisma.scheduledTaskRun.update({
          where: { id: item.id },
          data: {
            status: agentRun.status,
            error: agentRun.error,
            completedAt: agentRun.completedAt ?? new Date(),
          },
        });
      }
    } else if (item.workflowRunId) {
      const workflowRun = await prisma.workflowRun.findUnique({
        where: { id: item.workflowRunId },
      });
      if (workflowRun && ["succeeded", "failed"].includes(workflowRun.status)) {
        await prisma.scheduledTaskRun.update({
          where: { id: item.id },
          data: {
            status: workflowRun.status,
            error: workflowRun.error,
            completedAt: workflowRun.completedAt ?? new Date(),
          },
        });
      }
    }
  }
}
