import { getAgentBackend } from "../agent-backend/instance.js";
import type { SessionResource } from "../agent-backend/types.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { touchSandboxActivity } from "./sandboxes.js";
import { isSessionProviderMismatch } from "./sandboxProviderSettings.js";
import { getActiveSandboxProviderId } from "./sandboxProviderSettingsInstance.js";
import type { ResolvedSession } from "./sessions.js";

export type WorkflowSessionScope = { conversationId: string } | { emailThreadId: string };

/**
 * Resolve the Daytona session for one workflow step. Sessions are keyed per
 * (workflow conversation or email thread, agent) so each agent keeps its own
 * sandbox + memory across turns.
 */
export async function resolveWorkflowStepSession(
  agent: { id: string; slug: string },
  scope: WorkflowSessionScope,
  agentVersionId: string,
  resources: SessionResource[],
  observabilityRunId: string,
): Promise<ResolvedSession> {
  const backend = await getAgentBackend();

  const existing =
    "conversationId" in scope
      ? await prisma.workflowAgentSession.findUnique({
          where: {
            conversationId_agentId: {
              conversationId: scope.conversationId,
              agentId: agent.id,
            },
          },
        })
      : await prisma.workflowAgentSession.findUnique({
          where: {
            emailThreadId_agentId: {
              emailThreadId: scope.emailThreadId,
              agentId: agent.id,
            },
          },
        });

  const activeProvider = await getActiveSandboxProviderId();
  const providerChanged =
    existing !== null && isSessionProviderMismatch(existing.sessionId, activeProvider);
  if (providerChanged) {
    log.warn("workflow-sessions: replacing session after provider change", {
      ...scope,
      agentId: agent.id,
      previousSessionId: existing?.sessionId,
      activeProvider,
    });
  }

  if (existing && !providerChanged) {
    if (resources.length > 0) {
      await backend.mountSessionResources(existing.sessionId, resources, {
        runId: observabilityRunId,
      });
    }
    await touchSandboxActivity(existing.sessionId);
    return { sessionId: existing.sessionId, sandboxCreated: false };
  }

  const session = await backend.createSession({
    agentId: agent.id,
    agentSlug: agent.slug,
    title: `workflow:${agent.slug}`,
    resources: resources.length > 0 ? resources : undefined,
    agentVersionId,
    observability: { runId: observabilityRunId },
  });
  if (existing) {
    // Repoint the existing row; the old sandbox row stays for audit.
    await prisma.workflowAgentSession.update({
      where: { id: existing.id },
      data: { sessionId: session.id },
    });
  } else {
    await prisma.workflowAgentSession.create({
      data: {
        ...("conversationId" in scope
          ? { conversationId: scope.conversationId }
          : { emailThreadId: scope.emailThreadId }),
        agentId: agent.id,
        sessionId: session.id,
      },
    });
  }
  log.info("workflow-sessions: created", {
    ...scope,
    agentId: agent.id,
    sessionId: session.id,
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
