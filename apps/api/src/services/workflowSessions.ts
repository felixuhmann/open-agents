import { getAgentBackend } from "../agent-backend/instance.js";
import type { AgentBackend, SessionResource } from "../agent-backend/types.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { touchSandboxActivity } from "./sandboxes.js";
import { isSessionProviderMismatch } from "./sandboxProviderSettings.js";
import { getActiveSandboxProviderId } from "./sandboxProviderSettingsInstance.js";
import { claimSandboxSession } from "./sandboxSessionClaim.js";
import { prismaSandboxSessionClaimStore } from "./sandboxSessionClaimStore.js";
import { describeResumedSession, type ResolvedSession } from "./resolvedSession.js";

export type { WorkflowSessionScope } from "./sandboxSessionClaim.js";
import type { WorkflowSessionScope } from "./sandboxSessionClaim.js";

/**
 * Resolve the sandbox session for one workflow step. Sessions are keyed per
 * (workflow conversation or email thread, agent) so each agent keeps its own
 * sandbox + memory across turns.
 *
 * The mapping is unique on that key, so two steps starting together race for
 * it; the claim elects one and destroys the loser's sandbox.
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
    return resume(backend, existing.sessionId, resources, observabilityRunId);
  }

  const session = await backend.createSession({
    agentId: agent.id,
    agentSlug: agent.slug,
    title: `workflow:${agent.slug}`,
    resources: resources.length > 0 ? resources : undefined,
    agentVersionId,
    observability: { runId: observabilityRunId },
  });

  const claim = await claimSandboxSession(
    { store: prismaSandboxSessionClaimStore, discard: (id) => backend.discardSession(id) },
    {
      owner: { surface: "workflow", agentId: agent.id, scope },
      expectedSessionId: existing?.sessionId ?? null,
      sessionId: session.id,
    },
  );

  if (!claim.claimed) {
    // Another step already bound this slot; run on its sandbox.
    return resume(backend, claim.sessionId, resources, observabilityRunId);
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

async function resume(
  backend: AgentBackend,
  sessionId: string,
  resources: SessionResource[],
  runId: string,
): Promise<ResolvedSession> {
  const mounted =
    resources.length > 0
      ? await backend.mountSessionResources(sessionId, resources, { runId })
      : {};
  await touchSandboxActivity(sessionId);
  return describeResumedSession(sessionId, mounted.workspaceDir);
}
