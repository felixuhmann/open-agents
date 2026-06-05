import { prisma } from "../db.js";
import { getBoss } from "../jobs/queue.js";
import { JOB_RUN_WORKFLOW, type RunWorkflowJobData } from "../jobs/types.js";
import { requirePublishedWorkflowVersionId } from "../workflows/service.js";

export type EnqueueWorkflowTurnArgs = {
  conversationId: string;
};

/**
 * Create a WorkflowRun for the latest user turn and enqueue the pipeline
 * worker. Returns the workflowRunId so the SSE handler can subscribe.
 */
export async function enqueueWorkflowTurn(
  args: EnqueueWorkflowTurnArgs,
): Promise<string> {
  const conversation = await prisma.workflowConversation.findUnique({
    where: { id: args.conversationId },
  });
  if (!conversation) {
    throw new Error(`Workflow conversation not found: ${args.conversationId}`);
  }

  const workflowVersionId = await requirePublishedWorkflowVersionId(
    conversation.workflowId,
  );

  const run = await prisma.workflowRun.create({
    data: {
      workflowId: conversation.workflowId,
      workflowVersionId,
      conversationId: conversation.id,
      status: "pending",
    },
  });

  const boss = await getBoss();
  const data: RunWorkflowJobData = { workflowRunId: run.id };
  await boss.send(JOB_RUN_WORKFLOW, data);

  return run.id;
}
