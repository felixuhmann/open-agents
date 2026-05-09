import type { Job } from "pg-boss";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { sendEmail } from "../mailgun/send.js";
import { getServiceSecret, SERVICE_KEYS } from "../secrets/service.js";
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
  const { threadId, runId, body } = job.data;
  const jobStart = Date.now();
  log.info("send-email: start", {
    jobId: job.id,
    threadId,
    runId,
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
  log.info("send-email: prepared", {
    threadId,
    runId,
    agentSlug: thread.agent.slug,
    from,
    to: thread.userEmail,
    subject,
    inReplyTo: lastInbound.messageId,
    referencesCount: references.length,
  });

  const attachments = await prisma.agentAttachment.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
  });
  if (attachments.length > 0) {
    log.info("send-email: attaching agent outputs", {
      threadId,
      runId,
      count: attachments.length,
      totalBytes: attachments.reduce((acc, a) => acc + a.sizeBytes, 0),
      names: attachments.map((a) => a.filename),
    });
  }

  try {
    const html = await renderAgentResponseHtml({
      agentDisplayName: thread.agent.displayName,
      avatarFilename: thread.agent.avatar ?? undefined,
      markdown: body,
      threadId: thread.id,
      recipientEmail: thread.userEmail,
    });

    const sent = await sendEmail({
      from,
      to: thread.userEmail,
      subject,
      html,
      inReplyTo: lastInbound.messageId,
      references,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        bytes: new Uint8Array(a.bytes),
      })),
    });

    const outboundMessageId = sent.id
      ? sent.id.replace(/^<|>$/g, "")
      : await makeOutboundMessageId();

    await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        messageId: outboundMessageId,
        inReplyTo: lastInbound.messageId,
        direction: "outbound",
        subject,
        body,
      },
    });

    log.info("send-email: done", {
      threadId,
      runId,
      to: thread.userEmail,
      mailgunId: sent.id,
      outboundMessageId,
      durationMs: Date.now() - jobStart,
    });
  } catch (err) {
    log.error("send-email: failed", {
      threadId,
      runId,
      to: thread.userEmail,
      durationMs: Date.now() - jobStart,
      err: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    throw err;
  }
}
