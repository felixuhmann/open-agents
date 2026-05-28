import { prisma } from "../db.js";
import { requirePublishedVersionId } from "../agents/snapshot.js";
import { getBoss } from "../jobs/queue.js";
import { JOB_RUN_AGENT, type RunAgentJobData } from "../jobs/types.js";
import { log } from "../log.js";
import type { ParsedAttachment } from "../mailgun/attachments.js";
import type { InboundEmail } from "../mailgun/parse.js";
import { resumeOrCreateThread } from "./threads.js";

export type IngestResult =
  | { status: "duplicate"; existingId: string }
  | {
      status: "ingested";
      threadId: string;
      isNewThread: boolean;
      messageId: string;
      runId: string;
    };

/**
 * Idempotent inbound-email ingestion. Looks up the message by Message-Id;
 * if it's already on disk the call is a no-op. Otherwise: resume or
 * create the EmailThread, persist the EmailMessage + attachments, and
 * enqueue a `run-agent` job (creating the placeholder AgentRun row first
 * so the worker has somewhere to attach RunEvents).
 */
export async function ingestInboundEmail(args: {
  reqId: string;
  agentId: string;
  agentSlug: string;
  parsed: InboundEmail;
  attachments: ParsedAttachment[];
}): Promise<IngestResult> {
  const { reqId, agentId, agentSlug, parsed, attachments } = args;

  const existing = await prisma.emailMessage.findUnique({
    where: { messageId: parsed.messageId },
  });
  if (existing) {
    log.info("inbound: duplicate message, ignoring", {
      reqId,
      agentSlug,
      messageId: parsed.messageId,
      existingId: existing.id,
    });
    return { status: "duplicate", existingId: existing.id };
  }

  const { thread, isNew } = await resumeOrCreateThread(parsed, agentId);
  log.info("inbound: thread resolved", {
    reqId,
    agentSlug,
    threadId: thread.id,
    isNew,
    sessionId: thread.sessionId,
    rootMessageId: thread.rootMessageId,
  });

  const message = await prisma.emailMessage.create({
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

  const agentVersionId = await requirePublishedVersionId(agentId);

  const run = await prisma.agentRun.create({
    data: {
      agentId,
      agentVersionId,
      threadId: thread.id,
      surface: "email",
      sessionId: thread.sessionId ?? "",
      status: "pending",
    },
  });

  const boss = await getBoss();
  const jobData: RunAgentJobData = {
    runId: run.id,
    surface: "email",
    emailMessageId: message.id,
  };
  await boss.send(JOB_RUN_AGENT, jobData);

  log.info("inbound: enqueued run-agent", {
    reqId,
    agentSlug,
    threadId: thread.id,
    isNew,
    runId: run.id,
    attachments: attachments.length,
    from: parsed.from,
    subject: parsed.subject,
  });

  return {
    status: "ingested",
    threadId: thread.id,
    isNewThread: isNew,
    messageId: message.id,
    runId: run.id,
  };
}
