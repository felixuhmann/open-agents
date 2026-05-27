import type { Agent } from "@open-agents/db";
import { getAgentBackend } from "../agent-backend/instance.js";
import type { SessionResource } from "../agent-backend/types.js";
import { prisma } from "../db.js";
import { log } from "../log.js";

export type EmailThreadSessionInput = {
  id: string;
  sessionId: string | null;
  subject: string;
};

/**
 * Resume the email thread's existing Anthropic session, or create a new one
 * when there's no prior session OR `forceNewSession` is true. New sessions
 * get the supplied `resources` mounted; resumed sessions ignore them
 * (Managed Agents only mounts resources at session-creation, which is why
 * the worker forces a new session whenever there are unhandled attachments).
 */
export async function resolveEmailSessionId(
  agent: Pick<Agent, "id" | "slug" | "anthropicAgentId" | "environmentId">,
  thread: EmailThreadSessionInput,
  resources: SessionResource[],
  forceNewSession: boolean,
): Promise<string> {
  if (thread.sessionId && !forceNewSession) {
    log.info("sessions: resuming email thread", {
      threadId: thread.id,
      sessionId: thread.sessionId,
    });
    return thread.sessionId;
  }

  const backend = await getAgentBackend();
  if (
    backend.runtime === "anthropic" &&
    (!agent.anthropicAgentId || !agent.environmentId)
  ) {
    throw new Error(
      `Agent is not provisioned with Anthropic yet (missing agentId or environmentId)`,
    );
  }
  const session = await backend.createSession(
    backend.runtime === "anthropic"
      ? {
          agentId: agent.anthropicAgentId!,
          environmentId: agent.environmentId!,
          title: thread.subject.slice(0, 120),
          resources: resources.length > 0 ? resources : undefined,
        }
      : {
          agentId: agent.id,
          agentSlug: agent.slug,
          title: thread.subject.slice(0, 120),
          resources: resources.length > 0 ? resources : undefined,
        },
  );
  await prisma.emailThread.update({
    where: { id: thread.id },
    data: { sessionId: session.id },
  });
  log.info("sessions: created email", {
    threadId: thread.id,
    sessionId: session.id,
    resources: resources.length,
    forceNewSession,
  });
  return session.id;
}

export type ChatConversationSessionInput = {
  id: string;
  anthropicSessionId: string | null;
  title: string;
};

/**
 * Resume the chat conversation's existing session, or create a new one when
 * there's no prior session OR `forceNewSession` is true.
 */
export async function resolveChatSessionId(
  agent: Pick<Agent, "id" | "slug" | "anthropicAgentId" | "environmentId">,
  conversation: ChatConversationSessionInput,
  resources: SessionResource[],
  forceNewSession: boolean,
): Promise<string> {
  if (conversation.anthropicSessionId && !forceNewSession) {
    log.info("sessions: resuming chat conversation", {
      conversationId: conversation.id,
      sessionId: conversation.anthropicSessionId,
    });
    return conversation.anthropicSessionId;
  }

  const backend = await getAgentBackend();
  if (
    backend.runtime === "anthropic" &&
    (!agent.anthropicAgentId || !agent.environmentId)
  ) {
    throw new Error(
      `Agent is not provisioned with Anthropic yet (missing agentId or environmentId)`,
    );
  }
  const session = await backend.createSession(
    backend.runtime === "anthropic"
      ? {
          agentId: agent.anthropicAgentId!,
          environmentId: agent.environmentId!,
          title: conversation.title.slice(0, 120),
          resources: resources.length > 0 ? resources : undefined,
        }
      : {
          agentId: agent.id,
          agentSlug: agent.slug,
          title: conversation.title.slice(0, 120),
          resources: resources.length > 0 ? resources : undefined,
        },
  );
  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { anthropicSessionId: session.id },
  });
  log.info("sessions: created chat", {
    conversationId: conversation.id,
    sessionId: session.id,
    resources: resources.length,
    forceNewSession,
  });
  return session.id;
}
