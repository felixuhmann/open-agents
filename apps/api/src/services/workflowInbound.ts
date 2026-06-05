import { prisma } from "../db.js";
import { getBoss } from "../jobs/queue.js";
import { JOB_RUN_WORKFLOW, type RunWorkflowJobData } from "../jobs/types.js";
import { log } from "../log.js";
import type { ParsedAttachment } from "../mailgun/attachments.js";
import type { InboundEmail } from "../mailgun/parse.js";
import { requirePublishedWorkflowVersionId } from "../workflows/service.js";
import { resumeOrCreateWorkflowThread } from "./workflowThreads.js";

export type IngestWorkflowEmailResult =
  | { status: "duplicate"; existingId: string }
  | {
      status: "ingested";
      threadId: string;
      isNewThread: boolean;
      messageId: string;
      workflowRunId: string;
    };

/**
 * Idempotent inbound-email ingestion for a workflow. Persists the message +
 * attachments, creates a WorkflowRun bound to the email thread, and enqueues
 * `run-workflow`.
 */
export async function ingestInboundWorkflowEmail(args: {
  reqId: string;
  workflowId: string;
  workflowSlug: string;
  parsed: InboundEmail;
  attachments: ParsedAttachment[];
}): Promise<IngestWorkflowEmailResult> {
  const { reqId, workflowId, workflowSlug, parsed, attachments } = args;

  const existing = await prisma.workflowEmailMessage.findUnique({
    where: { messageId: parsed.messageId },
  });
  if (existing) {
    log.info("workflow inbound: duplicate message, ignoring", {
      reqId,
      workflowSlug,
      messageId: parsed.messageId,
      existingId: existing.id,
    });
    return { status: "duplicate", existingId: existing.id };
  }

  const { thread, isNew } = await resumeOrCreateWorkflowThread(parsed, workflowId);
  log.info("workflow inbound: thread resolved", {
    reqId,
    workflowSlug,
    threadId: thread.id,
    isNew,
    rootMessageId: thread.rootMessageId,
  });

  const message = await prisma.workflowEmailMessage.create({
    data: {
      threadId: thread.id,
      messageId: parsed.messageId,
      inReplyTo: parsed.inReplyTo,
      direction: "inbound",
      subject: parsed.subject,
      body: parsed.body,
      attachments: {
        create: attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          bytes: Buffer.from(a.bytes),
        })),
      },
    },
  });

  const workflowVersionId = await requirePublishedWorkflowVersionId(workflowId);

  const run = await prisma.workflowRun.create({
    data: {
      workflowId,
      workflowVersionId,
      emailThreadId: thread.id,
      status: "pending",
    },
  });

  const boss = await getBoss();
  const jobData: RunWorkflowJobData = {
    workflowRunId: run.id,
    workflowEmailMessageId: message.id,
  };
  await boss.send(JOB_RUN_WORKFLOW, jobData);

  log.info("workflow inbound: enqueued run-workflow", {
    reqId,
    workflowSlug,
    threadId: thread.id,
    isNew,
    workflowRunId: run.id,
    attachments: attachments.length,
    from: parsed.from,
    subject: parsed.subject,
  });

  return {
    status: "ingested",
    threadId: thread.id,
    isNewThread: isNew,
    messageId: message.id,
    workflowRunId: run.id,
  };
}
