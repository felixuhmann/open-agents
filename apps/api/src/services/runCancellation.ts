import { prisma } from "../db.js";
import { appendEvent } from "../runs/events.js";
import { appendWorkflowEvent } from "../runs/workflowEvents.js";

export const RUN_CANCELLED_MESSAGE = "Stopped by user";

export class RunCancelledError extends Error {
  constructor(public readonly partialOutput = "") {
    super(RUN_CANCELLED_MESSAGE);
    this.name = "RunCancelledError";
  }
}

export function isRunCancelledError(error: unknown): error is RunCancelledError {
  return error instanceof RunCancelledError;
}

export function throwIfRunCancelled(
  signal: AbortSignal | undefined,
  partialOutput = "",
): void {
  if (signal?.aborted) throw new RunCancelledError(partialOutput);
}

async function appendAgentCancelledEvent(runId: string): Promise<void> {
  const existing = await prisma.runEvent.findFirst({
    where: { runId, type: "run.cancelled" },
    select: { id: true },
  });
  if (existing) return;
  await appendEvent({
    runId,
    type: "run.cancelled",
    payload: { type: "run.cancelled", reason: RUN_CANCELLED_MESSAGE },
  });
}

async function appendWorkflowCancelledEvent(workflowRunId: string): Promise<void> {
  const existing = await prisma.workflowRunEvent.findFirst({
    where: { workflowRunId, type: "workflow.run.cancelled" },
    select: { id: true },
  });
  if (existing) return;
  await appendWorkflowEvent({
    workflowRunId,
    type: "workflow.run.cancelled",
    payload: {
      type: "workflow.run.cancelled",
      reason: RUN_CANCELLED_MESSAGE,
    },
  });
}

export async function requestAgentRunCancellation(
  runId: string,
): Promise<"cancelling" | "cancelled" | "finished"> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  if (!run) throw new Error(`AgentRun not found: ${runId}`);
  if (run.status === "succeeded" || run.status === "failed") return "finished";
  if (run.status === "cancelled") {
    await appendAgentCancelledEvent(runId);
    return "cancelled";
  }
  if (run.status === "cancelling") return "cancelling";

  if (run.status === "pending") {
    const updated = await prisma.agentRun.updateMany({
      where: { id: runId, status: "pending" },
      data: {
        status: "cancelled",
        completedAt: new Date(),
        error: RUN_CANCELLED_MESSAGE,
      },
    });
    if (updated.count > 0) {
      await appendAgentCancelledEvent(runId);
      return "cancelled";
    }
  }

  const updated = await prisma.agentRun.updateMany({
    where: { id: runId, status: "running" },
    data: { status: "cancelling", error: RUN_CANCELLED_MESSAGE },
  });
  if (updated.count > 0) {
    await appendEvent({
      runId,
      type: "run.cancel.requested",
      payload: { type: "run.cancel.requested" },
    });
    return "cancelling";
  }

  const refreshed = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
  if (refreshed.status === "cancelled") {
    await appendAgentCancelledEvent(runId);
    return "cancelled";
  }
  return refreshed.status === "cancelling" ? "cancelling" : "finished";
}

export async function finalizeAgentRunCancellation(
  runId: string,
  partialOutput = "",
): Promise<void> {
  const output = partialOutput.trim();
  await prisma.$transaction(async (tx) => {
    const run = await tx.agentRun.findUnique({
      where: { id: runId },
      select: { conversationId: true, surface: true },
    });
    if (!run) return;

    await tx.agentRun.updateMany({
      where: { id: runId, status: { in: ["pending", "running", "cancelling"] } },
      data: {
        status: "cancelled",
        completedAt: new Date(),
        error: RUN_CANCELLED_MESSAGE,
        ...(output ? { output } : {}),
      },
    });

    if (output && run.surface === "chat" && run.conversationId) {
      const existing = await tx.chatMessage.findFirst({
        where: { runId, role: "assistant" },
        select: { id: true },
      });
      if (!existing) {
        await tx.chatMessage.create({
          data: {
            conversationId: run.conversationId,
            role: "assistant",
            content: output,
            runId,
          },
        });
      }
    }
  });
  await appendAgentCancelledEvent(runId);
}

export async function requestWorkflowRunCancellation(
  workflowRunId: string,
): Promise<"cancelling" | "cancelled" | "finished"> {
  const run = await prisma.workflowRun.findUnique({
    where: { id: workflowRunId },
    select: { status: true },
  });
  if (!run) throw new Error(`WorkflowRun not found: ${workflowRunId}`);
  if (run.status === "succeeded" || run.status === "failed") return "finished";
  if (run.status === "cancelled") {
    await appendWorkflowCancelledEvent(workflowRunId);
    return "cancelled";
  }
  if (run.status === "cancelling") return "cancelling";

  if (run.status === "pending") {
    const updated = await prisma.workflowRun.updateMany({
      where: { id: workflowRunId, status: "pending" },
      data: {
        status: "cancelled",
        completedAt: new Date(),
        error: RUN_CANCELLED_MESSAGE,
      },
    });
    if (updated.count > 0) {
      await appendWorkflowCancelledEvent(workflowRunId);
      return "cancelled";
    }
  }

  const updated = await prisma.workflowRun.updateMany({
    where: { id: workflowRunId, status: "running" },
    data: { status: "cancelling", error: RUN_CANCELLED_MESSAGE },
  });
  if (updated.count > 0) {
    const activeSteps = await prisma.workflowStepRun.findMany({
      where: { workflowRunId, status: "running", runId: { not: null } },
      select: { runId: true },
    });
    for (const step of activeSteps) {
      if (!step.runId) continue;
      const agentUpdated = await prisma.agentRun.updateMany({
        where: { id: step.runId, status: "running" },
        data: { status: "cancelling", error: RUN_CANCELLED_MESSAGE },
      });
      if (agentUpdated.count > 0) {
        await appendEvent({
          runId: step.runId,
          type: "run.cancel.requested",
          payload: { type: "run.cancel.requested" },
        });
      }
    }
    await appendWorkflowEvent({
      workflowRunId,
      type: "workflow.run.cancel.requested",
      payload: { type: "workflow.run.cancel.requested" },
    });
    return "cancelling";
  }

  const refreshed = await prisma.workflowRun.findUniqueOrThrow({
    where: { id: workflowRunId },
  });
  if (refreshed.status === "cancelled") {
    await appendWorkflowCancelledEvent(workflowRunId);
    return "cancelled";
  }
  return refreshed.status === "cancelling" ? "cancelling" : "finished";
}

export async function finalizeWorkflowRunCancellation(
  workflowRunId: string,
): Promise<void> {
  const activeSteps = await prisma.workflowStepRun.findMany({
    where: { workflowRunId, status: "running", runId: { not: null } },
    select: { id: true, position: true, runId: true },
  });
  for (const step of activeSteps) {
    if (!step.runId) continue;
    await finalizeAgentRunCancellation(step.runId);
    await prisma.workflowStepRun.updateMany({
      where: { id: step.id, status: "running" },
      data: { status: "cancelled", error: RUN_CANCELLED_MESSAGE },
    });
    await appendWorkflowEvent({
      workflowRunId,
      type: "workflow.step.cancelled",
      payload: {
        type: "workflow.step.cancelled",
        position: step.position,
        runId: step.runId,
      },
    });
  }

  await prisma.workflowRun.updateMany({
    where: {
      id: workflowRunId,
      status: { in: ["pending", "running", "cancelling"] },
    },
    data: {
      status: "cancelled",
      completedAt: new Date(),
      error: RUN_CANCELLED_MESSAGE,
    },
  });
  await appendWorkflowCancelledEvent(workflowRunId);
}
