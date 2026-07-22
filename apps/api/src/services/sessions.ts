import type { Agent } from "@open-agents/db";
import type { SkillMaterializationManifest } from "@open-agents/types";
import { getAgentBackend } from "../agent-backend/instance.js";
import type { SessionResource } from "../agent-backend/types.js";
import type { SandboxProviderId } from "../sandbox-provider/types.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { touchSandboxActivity } from "./sandboxes.js";

export type ResolvedSession = {
  sessionId: string;
  skillsManifest?: SkillMaterializationManifest;
  /** Set when a new sandbox was created for this run. */
  sandboxCreated?: boolean;
  /** Provider that owns this session's sandbox. */
  provider?: SandboxProviderId;
  providerSandboxId?: string;
  workspaceDir?: string;
};

export type EmailThreadSessionInput = {
  id: string;
  sessionId: string | null;
  subject: string;
};

/**
 * Resume the email thread's existing session, or create a new one when there's
 * no prior session. New sessions get the supplied `resources` mounted; resumed
 * Daytona sessions receive new resources via `mountSessionResources`.
 */
export async function resolveEmailSessionId(
  agent: Pick<Agent, "id" | "slug" | "currentVersionId">,
  thread: EmailThreadSessionInput,
  resources: SessionResource[],
  _forceNewSession: boolean,
  agentVersionId?: string,
  observabilityRunId?: string,
): Promise<ResolvedSession> {
  const backend = await getAgentBackend();

  if (thread.sessionId) {
    log.info("sessions: resuming email thread", {
      threadId: thread.id,
      sessionId: thread.sessionId,
      mountResources: resources.length,
    });
    if (resources.length > 0) {
      await backend.mountSessionResources(
        thread.sessionId,
        resources,
        observabilityRunId ? { runId: observabilityRunId } : undefined,
      );
    }
    await touchSandboxActivity(thread.sessionId);
    return { sessionId: thread.sessionId, sandboxCreated: false };
  }

  if (!agent.currentVersionId) {
    throw new Error(
      `Agent "${agent.slug}" has no published version. Publish before running.`,
    );
  }

  const session = await backend.createSession({
    agentId: agent.id,
    agentSlug: agent.slug,
    title: thread.subject.slice(0, 120),
    resources: resources.length > 0 ? resources : undefined,
    agentVersionId: agentVersionId ?? agent.currentVersionId,
    threadId: thread.id,
    surface: "email",
    observability: observabilityRunId ? { runId: observabilityRunId } : undefined,
  });
  await prisma.emailThread.update({
    where: { id: thread.id },
    data: { sessionId: session.id },
  });
  log.info("sessions: created email", {
    threadId: thread.id,
    sessionId: session.id,
    resources: resources.length,
    skillsMaterialized: session.skillsManifest?.materialized ?? 0,
  });
  return {
    sessionId: session.id,
    skillsManifest: session.skillsManifest,
    sandboxCreated: true,
    provider: session.provider,
    providerSandboxId: session.providerSandboxId,
    workspaceDir: session.workspaceDir,
  };
}

export type ChatConversationSessionInput = {
  id: string;
  sessionId: string | null;
  title: string;
};

/**
 * Resume the chat conversation's existing session, or create a new one when
 * there's no prior session.
 */
export async function resolveChatSessionId(
  agent: Pick<Agent, "id" | "slug" | "currentVersionId">,
  conversation: ChatConversationSessionInput,
  resources: SessionResource[],
  _forceNewSession: boolean,
  agentVersionId?: string,
  observabilityRunId?: string,
): Promise<ResolvedSession> {
  const backend = await getAgentBackend();

  if (conversation.sessionId) {
    log.info("sessions: resuming chat conversation", {
      conversationId: conversation.id,
      sessionId: conversation.sessionId,
      mountResources: resources.length,
    });
    if (resources.length > 0) {
      await backend.mountSessionResources(
        conversation.sessionId,
        resources,
        observabilityRunId ? { runId: observabilityRunId } : undefined,
      );
    }
    await touchSandboxActivity(conversation.sessionId);
    return { sessionId: conversation.sessionId, sandboxCreated: false };
  }

  if (!agent.currentVersionId) {
    throw new Error(
      `Agent "${agent.slug}" has no published version. Publish before running.`,
    );
  }

  const session = await backend.createSession({
    agentId: agent.id,
    agentSlug: agent.slug,
    title: conversation.title.slice(0, 120),
    resources: resources.length > 0 ? resources : undefined,
    agentVersionId: agentVersionId ?? agent.currentVersionId,
    conversationId: conversation.id,
    surface: "chat",
    observability: observabilityRunId ? { runId: observabilityRunId } : undefined,
  });
  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { sessionId: session.id },
  });
  log.info("sessions: created chat", {
    conversationId: conversation.id,
    sessionId: session.id,
    resources: resources.length,
    skillsMaterialized: session.skillsManifest?.materialized ?? 0,
  });
  return {
    sessionId: session.id,
    skillsManifest: session.skillsManifest,
    sandboxCreated: true,
    provider: session.provider,
    providerSandboxId: session.providerSandboxId,
    workspaceDir: session.workspaceDir,
  };
}
