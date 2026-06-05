import type { Job } from "pg-boss";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { sendEmail } from "../mailgun/send.js";
import { getServiceSecret, SERVICE_KEYS } from "../secrets/service.js";
import { APP_SETTING_KEYS, getAppSetting } from "../services/appSettings.js";
import { renderAgentResponseHtml } from "../services/renderEmail.js";
import { getBoss } from "./queue.js";
import { JOB_SEND_EMAIL, type SendEmailJobData } from "./types.js";

export async function registerSendEmailWorker(): Promise<void> {
  const boss = await getBoss();
  await boss.work<SendEmailJobData>(JOB_SEND_EMAIL, async (jobs) => {
    for (const job of jobs) {
      await handleSendEmail(job);
    }
  });
  log.info("worker registered", { queue: JOB_SEND_EMAIL });
}

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

async function makeOutboundMessageId(): Promise<string> {
  const domain =
    (await getServiceSecret(SERVICE_KEYS.MAILGUN_DOMAIN)) ?? "open-agents.local";
  return `${randomUUID()}@${domain}`;
}

function parseAddressHeader(raw: string): { displayName?: string; address: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  if (match?.[2]) {
    const name = (match[1] ?? "").trim().replace(/^"|"$/g, "");
    return { displayName: name || undefined, address: match[2].trim() };
  }
  return { address: raw.trim() };
}

export function buildFromHeader(args: {
  inboundAddress: string | null;
  displayName?: string;
  fallbackFrom: string;
}): string {
  const fallback = parseAddressHeader(args.fallbackFrom);
  const trimmedInbound = args.inboundAddress?.trim() ?? "";
  const address = trimmedInbound.length > 0 ? trimmedInbound : fallback.address;
  const displayName = args.displayName ?? fallback.displayName;
  return displayName ? `${displayName} <${address}>` : address;
}

async function handleSendEmail(job: Job<SendEmailJobData>): Promise<void> {
  const { agentRunId, body } = job.data;
  const jobStart = Date.now();

  if (job.data.workflowThreadId) {
    await sendWorkflowReply({
      workflowThreadId: job.data.workflowThreadId,
      agentRunId,
      body,
      jobId: job.id,
      jobStart,
    });
    return;
  }

  if (!job.data.threadId) {
    throw new Error("send-email: threadId or workflowThreadId required");
  }

  await sendAgentReply({
    threadId: job.data.threadId,
    agentRunId,
    body,
    jobId: job.id,
    jobStart,
  });
}

async function sendAgentReply(args: {
  threadId: string;
  agentRunId: string;
  body: string;
  jobId: string | undefined;
  jobStart: number;
}): Promise<void> {
  const { threadId, agentRunId, body, jobId, jobStart } = args;
  log.info("send-email: start (agent)", {
    jobId,
    threadId,
    agentRunId,
    bodyChars: body.length,
  });

  const thread = await prisma.emailThread.findUnique({
    where: { id: threadId },
    include: {
      agent: true,
      messages: {
        where: { direction: "inbound" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!thread) {
    log.error("send-email: thread not found", { threadId });
    throw new Error(`Thread not found: ${threadId}`);
  }

  const lastInbound = thread.messages[0];
  if (!lastInbound) {
    log.error("send-email: no inbound message to reply to", { threadId });
    throw new Error(`No inbound message to reply to for thread ${threadId}`);
  }

  const allPriorMessageIds = await prisma.emailMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "asc" },
    select: { messageId: true },
  });
  const references = allPriorMessageIds.map((m) => m.messageId);

  const subject = replySubject(thread.subject);
  const fallbackFrom =
    (await getAppSetting(APP_SETTING_KEYS.INBOUND_FROM)) ??
    (await getServiceSecret(SERVICE_KEYS.INBOUND_FROM)) ??
    `${thread.agent.displayName} <${thread.agent.inboundLocalPart}@example.com>`;

  const mailgunDomain = await getServiceSecret(SERVICE_KEYS.MAILGUN_DOMAIN);
  const fullInbound = mailgunDomain
    ? `${thread.agent.inboundLocalPart}@${mailgunDomain}`
    : thread.inboundAddress;

  const from = buildFromHeader({
    inboundAddress: fullInbound,
    displayName: thread.agent.displayName,
    fallbackFrom,
  });

  await deliverEmailReply({
    from,
    to: thread.userEmail,
    subject,
    inReplyTo: lastInbound.messageId,
    references,
    displayName: thread.agent.displayName,
    avatarFilename: thread.agent.avatar ?? undefined,
    threadIdForRender: thread.id,
    recipientEmail: thread.userEmail,
    agentRunId,
    body,
    persistOutbound: async (outboundMessageId, outboundSubject) => {
      await prisma.emailMessage.create({
        data: {
          threadId: thread.id,
          messageId: outboundMessageId,
          inReplyTo: lastInbound.messageId,
          direction: "outbound",
          subject: outboundSubject,
          body,
        },
      });
    },
    logContext: { threadId, agentRunId, agentSlug: thread.agent.slug },
    jobStart,
  });
}

async function sendWorkflowReply(args: {
  workflowThreadId: string;
  agentRunId: string;
  body: string;
  jobId: string | undefined;
  jobStart: number;
}): Promise<void> {
  const { workflowThreadId, agentRunId, body, jobId, jobStart } = args;
  log.info("send-email: start (workflow)", {
    jobId,
    workflowThreadId,
    agentRunId,
    bodyChars: body.length,
  });

  const thread = await prisma.workflowEmailThread.findUnique({
    where: { id: workflowThreadId },
    include: {
      workflow: true,
      messages: {
        where: { direction: "inbound" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!thread) {
    log.error("send-email: workflow thread not found", { workflowThreadId });
    throw new Error(`Workflow thread not found: ${workflowThreadId}`);
  }

  const lastInbound = thread.messages[0];
  if (!lastInbound) {
    log.error("send-email: no inbound message to reply to", { workflowThreadId });
    throw new Error(
      `No inbound message to reply to for workflow thread ${workflowThreadId}`,
    );
  }

  const allPriorMessageIds = await prisma.workflowEmailMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "asc" },
    select: { messageId: true },
  });
  const references = allPriorMessageIds.map((m) => m.messageId);

  const subject = replySubject(thread.subject);
  const fallbackFrom =
    (await getAppSetting(APP_SETTING_KEYS.INBOUND_FROM)) ??
    (await getServiceSecret(SERVICE_KEYS.INBOUND_FROM)) ??
    `${thread.workflow.displayName} <${thread.workflow.inboundLocalPart}@example.com>`;

  const mailgunDomain = await getServiceSecret(SERVICE_KEYS.MAILGUN_DOMAIN);
  const fullInbound = mailgunDomain
    ? `${thread.workflow.inboundLocalPart}@${mailgunDomain}`
    : thread.inboundAddress;

  const from = buildFromHeader({
    inboundAddress: fullInbound,
    displayName: thread.workflow.displayName,
    fallbackFrom,
  });

  await deliverEmailReply({
    from,
    to: thread.userEmail,
    subject,
    inReplyTo: lastInbound.messageId,
    references,
    displayName: thread.workflow.displayName,
    avatarFilename: undefined,
    threadIdForRender: thread.id,
    recipientEmail: thread.userEmail,
    agentRunId,
    body,
    persistOutbound: async (outboundMessageId, outboundSubject) => {
      await prisma.workflowEmailMessage.create({
        data: {
          threadId: thread.id,
          messageId: outboundMessageId,
          inReplyTo: lastInbound.messageId,
          direction: "outbound",
          subject: outboundSubject,
          body,
        },
      });
    },
    logContext: {
      workflowThreadId,
      agentRunId,
      workflowSlug: thread.workflow.slug,
    },
    jobStart,
  });
}

async function deliverEmailReply(args: {
  from: string;
  to: string;
  subject: string;
  inReplyTo: string;
  references: string[];
  displayName: string;
  avatarFilename?: string;
  threadIdForRender: string;
  recipientEmail: string;
  agentRunId: string;
  body: string;
  persistOutbound: (messageId: string, subject: string) => Promise<void>;
  logContext: Record<string, unknown>;
  jobStart: number;
}): Promise<void> {
  const attachments = await prisma.agentAttachment.findMany({
    where: { runId: args.agentRunId },
    orderBy: { createdAt: "asc" },
  });
  if (attachments.length > 0) {
    log.info("send-email: attaching outputs", {
      ...args.logContext,
      count: attachments.length,
      totalBytes: attachments.reduce((acc, a) => acc + a.sizeBytes, 0),
      names: attachments.map((a) => a.filename),
    });
  }

  try {
    const html = await renderAgentResponseHtml({
      agentDisplayName: args.displayName,
      avatarFilename: args.avatarFilename,
      markdown: args.body,
      threadId: args.threadIdForRender,
      recipientEmail: args.recipientEmail,
    });

    const sent = await sendEmail({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html,
      inReplyTo: args.inReplyTo,
      references: args.references,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        bytes: new Uint8Array(a.bytes),
      })),
    });

    const outboundMessageId = sent.id
      ? sent.id.replace(/^<|>$/g, "")
      : await makeOutboundMessageId();

    await args.persistOutbound(outboundMessageId, args.subject);

    log.info("send-email: done", {
      ...args.logContext,
      to: args.to,
      mailgunId: sent.id,
      outboundMessageId,
      durationMs: Date.now() - args.jobStart,
    });
  } catch (err) {
    log.error("send-email: failed", {
      ...args.logContext,
      to: args.to,
      durationMs: Date.now() - args.jobStart,
      err: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    throw err;
  }
}
