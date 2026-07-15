import type {
  WorkflowRunEventEnvelope,
  WorkflowRunEventPayload,
  WorkflowRunEventTypes,
} from "@open-agents/types";
import { prisma } from "../db.js";
import { createDurableEventLog } from "./eventLog.js";

/**
 * Per-workflow-run event log. Uses its own NOTIFY channel + table so the
 * workflow chat SSE can replay (`Last-Event-ID`) and switch to live events
 * independent of the per-agent run streams.
 */
export const WORKFLOW_NOTIFY_CHANNEL = "workflow_run_events";

export type WorkflowLiveEvent = WorkflowRunEventEnvelope & { workflowRunId: string };

export type AppendWorkflowEventInput = {
  workflowRunId: string;
  type: WorkflowRunEventTypes;
  payload: WorkflowRunEventPayload;
};

const workflowEventLog = createDurableEventLog<
  "workflowRunId",
  WorkflowRunEventTypes,
  WorkflowRunEventPayload,
  WorkflowRunEventEnvelope
>({
  name: "workflow-events",
  notifyChannel: WORKFLOW_NOTIFY_CHANNEL,
  idKey: "workflowRunId",
  emitterPrefix: "wf",
  terminalTypes: ["workflow.run.succeeded", "workflow.run.failed"],
  readRow: (workflowRunId, seq) =>
    prisma.workflowRunEvent.findUnique({
      where: { workflowRunId_seq: { workflowRunId, seq } },
    }),
  readRows: (workflowRunId, afterSeq) =>
    prisma.workflowRunEvent.findMany({
      where: { workflowRunId, seq: { gt: afterSeq } },
      orderBy: { seq: "asc" },
    }),
  insertRow: async (tx, input) => {
    // Use advisory lock seed 1 to keep workflow-run locks separate from
    // AgentRun locks if both ids ever collide.
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
  },
});

export async function stopWorkflowEventsListener(): Promise<void> {
  await workflowEventLog.stop();
}

export async function appendWorkflowEvent(
  input: AppendWorkflowEventInput,
): Promise<WorkflowRunEventEnvelope> {
  return workflowEventLog.append(input);
}

export async function readWorkflowBacklog(
  workflowRunId: string,
  afterSeq: number,
): Promise<WorkflowRunEventEnvelope[]> {
  return workflowEventLog.readBacklog(workflowRunId, afterSeq);
}

export function subscribeWorkflow(
  workflowRunId: string,
  handler: (env: WorkflowRunEventEnvelope) => void | Promise<void>,
): () => void {
  return workflowEventLog.subscribe(workflowRunId, handler);
}

export function isTerminalWorkflowEvent(env: WorkflowRunEventEnvelope): boolean {
  return workflowEventLog.isTerminalEvent(env);
}
