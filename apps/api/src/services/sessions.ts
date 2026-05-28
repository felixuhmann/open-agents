import type { Agent } from "@open-agents/db";
import type { SkillMaterializationManifest } from "@open-agents/types";
import { getAgentBackend } from "../agent-backend/instance.js";
import type { SessionResource } from "../agent-backend/types.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { touchSandboxActivity } from "./sandboxes.js";

export type ResolvedSession = {
  sessionId: string;
  skillsManifest?: SkillMaterializationManifest;
  /** Set when a new Daytona sandbox was created for this run. */
  sandboxCreated?: boolean;
  providerSandboxId?: string;
  workspaceDir?: string;
};

export type EmailThreadSessionInput = {
  id: string;
  sessionId: string | null;
  subject: string;
};

function effectiveForceNewSession(
  backendRuntime: "anthropic" | "daytona",
  forceNewSession: boolean,
): boolean {
  // Daytona can upload attachments into an existing sandbox; only Anthropic
  // Managed Agents require a new session when new files must be mounted.
  if (backendRuntime === "daytona") return false;
  return forceNewSession;
}

/**
 * Resume the email thread's existing session, or create a new one when there's
 * no prior session OR `forceNewSession` is true (Anthropic only for the latter).
 * New sessions get the supplied `resources` mounted; resumed Daytona sessions
 * receive new resources via `mountSessionResources`.
 */
export async function resolveEmailSessionId(
  agent: Pick<
    Agent,
    "id" | "slug" | "anthropicAgentId" | "environmentId" | "currentVersionId"
  >,
  thread: EmailThreadSessionInput,
  resources: SessionResource[],
  forceNewSession: boolean,
  agentVersionId?: string,
  observabilityRunId?: string,
): Promise<ResolvedSession> {
  const backend = await getAgentBackend();
  const forceNew = effectiveForceNewSession(backend.runtime, forceNewSession);

  if (thread.sessionId && !forceNew) {
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
    if (backend.runtime === "daytona") {
      await touchSandboxActivity(thread.sessionId);
    }
    return { sessionId: thread.sessionId, sandboxCreated: false };
  }

  if (!agent.currentVersionId) {
    throw new Error(
      `Agent "${agent.slug}" has no published version. Publish before running.`,
    );
  }

  if (
    backend.runtime === "anthropic" &&
    (!agent.anthropicAgentId || !agent.environmentId)
  ) {
    throw new Error(
      `Agent "${agent.slug}" is not synced with Anthropic (missing agentId or environmentId). ` +
        `The Anthropic backend requires a legacy sync; publish a version for Daytona or contact an admin.`,
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
          agentVersionId: agentVersionId ?? agent.currentVersionId,
          threadId: thread.id,
          surface: "email",
          observability: observabilityRunId ? { runId: observabilityRunId } : undefined,
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
    forceNewSession: forceNew,
    skillsMaterialized: session.skillsManifest?.materialized ?? 0,
  });
  return {
    sessionId: session.id,
    skillsManifest: session.skillsManifest,
    sandboxCreated: backend.runtime === "daytona",
    providerSandboxId: session.providerSandboxId,
    workspaceDir: session.workspaceDir,
  };
}

export type ChatConversationSessionInput = {
  id: string;
  anthropicSessionId: string | null;
  title: string;
};

/**
 * Resume the chat conversation's existing session, or create a new one when
 * there's no prior session OR `forceNewSession` is true (Anthropic only).
 */
export async function resolveChatSessionId(
  agent: Pick<
    Agent,
    "id" | "slug" | "anthropicAgentId" | "environmentId" | "currentVersionId"
  >,
  conversation: ChatConversationSessionInput,
  resources: SessionResource[],
  forceNewSession: boolean,
  agentVersionId?: string,
  observabilityRunId?: string,
): Promise<ResolvedSession> {
  const backend = await getAgentBackend();
  const forceNew = effectiveForceNewSession(backend.runtime, forceNewSession);

  if (conversation.anthropicSessionId && !forceNew) {
    log.info("sessions: resuming chat conversation", {
      conversationId: conversation.id,
      sessionId: conversation.anthropicSessionId,
      mountResources: resources.length,
    });
    if (resources.length > 0) {
      await backend.mountSessionResources(
        conversation.anthropicSessionId,
        resources,
        observabilityRunId ? { runId: observabilityRunId } : undefined,
      );
    }
    if (backend.runtime === "daytona") {
      await touchSandboxActivity(conversation.anthropicSessionId);
    }
    return { sessionId: conversation.anthropicSessionId, sandboxCreated: false };
  }

  if (!agent.currentVersionId) {
    throw new Error(
      `Agent "${agent.slug}" has no published version. Publish before running.`,
    );
  }

  if (
    backend.runtime === "anthropic" &&
    (!agent.anthropicAgentId || !agent.environmentId)
  ) {
    throw new Error(
      `Agent "${agent.slug}" is not synced with Anthropic (missing agentId or environmentId). ` +
        `The Anthropic backend requires a legacy sync; publish a version for Daytona or contact an admin.`,
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
          agentVersionId: agentVersionId ?? agent.currentVersionId,
          conversationId: conversation.id,
          surface: "chat",
          observability: observabilityRunId ? { runId: observabilityRunId } : undefined,
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
    forceNewSession: forceNew,
    skillsMaterialized: session.skillsManifest?.materialized ?? 0,
  });
  return {
    sessionId: session.id,
    skillsManifest: session.skillsManifest,
    sandboxCreated: backend.runtime === "daytona",
    providerSandboxId: session.providerSandboxId,
    workspaceDir: session.workspaceDir,
  };
}
