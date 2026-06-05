import type { WorkflowEmailThread } from "@open-agents/db";
import { prisma } from "../db.js";
import type { InboundEmail } from "../mailgun/parse.js";

/**
 * Resume a workflow email thread via In-Reply-To / References, scoped to one
 * workflow so threads never collide across workflows.
 */
export async function findWorkflowThreadForReply(
  email: InboundEmail,
  workflowId: string,
): Promise<WorkflowEmailThread | null> {
  const candidateIds = new Set<string>();
  if (email.inReplyTo) candidateIds.add(email.inReplyTo);
  for (const ref of email.references) candidateIds.add(ref);
  if (candidateIds.size === 0) return null;

  const ids = [...candidateIds];

  const rootMatch = await prisma.workflowEmailThread.findFirst({
    where: { rootMessageId: { in: ids }, workflowId },
  });
  if (rootMatch) return rootMatch;

  const prior = await prisma.workflowEmailMessage.findFirst({
    where: { messageId: { in: ids }, thread: { workflowId } },
    include: { thread: true },
  });
  return prior?.thread ?? null;
}

export async function resumeOrCreateWorkflowThread(
  email: InboundEmail,
  workflowId: string,
): Promise<{ thread: WorkflowEmailThread; isNew: boolean }> {
  const existing = await findWorkflowThreadForReply(email, workflowId);
  if (existing) return { thread: existing, isNew: false };

  if (!email.messageId) {
    throw new Error("Inbound email has no Message-Id; cannot create workflow thread");
  }

  const thread = await prisma.workflowEmailThread.create({
    data: {
      workflowId,
      userEmail: email.from,
      inboundAddress: email.to || null,
      subject: email.subject,
      rootMessageId: email.messageId,
    },
  });
  return { thread, isNew: true };
}
