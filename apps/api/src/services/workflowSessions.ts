import { getAgentBackend } from "../agent-backend/instance.js";
import type { SessionResource } from "../agent-backend/types.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { touchSandboxActivity } from "./sandboxes.js";
import type { ResolvedSession } from "./sessions.js";

/**
 * Resolve the Daytona session for one workflow step. Sessions are keyed per
 * (workflow conversation, agent) so each agent keeps its own sandbox + memory
 * across turns, independent of sibling agents in the pipeline.
 */
export async function resolveWorkflowStepSession(
  agent: { id: string; slug: string },
  conversationId: string,
  agentVersionId: string,
  resources: SessionResource[],
  observabilityRunId: string,
): Promise<ResolvedSession> {
  const backend = await getAgentBackend();

  const existing = await prisma.workflowAgentSession.findUnique({
    where: { conversationId_agentId: { conversationId, agentId: agent.id } },
  });

  if (existing) {
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
  await prisma.workflowAgentSession.create({
    data: { conversationId, agentId: agent.id, sessionId: session.id },
  });
  log.info("workflow-sessions: created", {
    conversationId,
    agentId: agent.id,
    sessionId: session.id,
  });
  return {
    sessionId: session.id,
    skillsManifest: session.skillsManifest,
    sandboxCreated: true,
    providerSandboxId: session.providerSandboxId,
    workspaceDir: session.workspaceDir,
  };
}
