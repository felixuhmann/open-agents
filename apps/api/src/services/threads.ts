import type { EmailThread } from "@open-agents/db";
import { prisma } from "../db.js";
import type { InboundEmail } from "../mailgun/parse.js";

/**
 * Look up an existing EmailThread for this inbound message via In-Reply-To
 * or References headers, scoped to a single agent so threads from different
 * agents never collide.
 */
export async function findThreadForReply(
  email: InboundEmail,
  agentId: string,
): Promise<EmailThread | null> {
  const candidateIds = new Set<string>();
  if (email.inReplyTo) candidateIds.add(email.inReplyTo);
  for (const ref of email.references) candidateIds.add(ref);
  if (candidateIds.size === 0) return null;

  const ids = [...candidateIds];

  const rootMatch = await prisma.emailThread.findFirst({
    where: { rootMessageId: { in: ids }, agentId },
  });
  if (rootMatch) return rootMatch;

  const prior = await prisma.emailMessage.findFirst({
    where: { messageId: { in: ids }, thread: { agentId } },
    include: { thread: true },
  });
  return prior?.thread ?? null;
}

/**
 * Resume an existing thread (by In-Reply-To/References lookup) or create a
 * fresh one rooted at this incoming message.
 */
export async function resumeOrCreateThread(
  email: InboundEmail,
  agentId: string,
): Promise<{ thread: EmailThread; isNew: boolean }> {
  const existing = await findThreadForReply(email, agentId);
  if (existing) return { thread: existing, isNew: false };

  if (!email.messageId) {
    throw new Error("Inbound email has no Message-Id; cannot create thread");
  }

  const thread = await prisma.emailThread.create({
    data: {
      agentId,
      userEmail: email.from,
      inboundAddress: email.to || null,
      subject: email.subject,
      rootMessageId: email.messageId,
    },
  });
  return { thread, isNew: true };
}
