import type { Agent } from "@open-agents/db";
import { getAgentBackend } from "../agent-backend/instance.js";
import type { AgentBackend, SessionResource } from "../agent-backend/types.js";
import { log } from "../log.js";
import { describeResumedSession, type ResolvedSession } from "./resolvedSession.js";
import { touchSandboxActivity } from "./sandboxes.js";
import { isSessionProviderMismatch } from "./sandboxProviderSettings.js";
import { getActiveSandboxProviderId } from "./sandboxProviderSettingsInstance.js";
import { claimSandboxSession, type SandboxOwnerRef } from "./sandboxSessionClaim.js";
import { prismaSandboxSessionClaimStore } from "./sandboxSessionClaimStore.js";

export type { ResolvedSession };

export type EmailThreadSessionInput = {
  id: string;
  sessionId: string | null;
  subject: string;
};

type SessionOwner = {
  ref: Extract<SandboxOwnerRef, { surface: "chat" | "email" }>;
  /** Owner row id, for logging. */
  id: string;
  sessionId: string | null;
  title: string;
};

/**
 * Resume the owner's existing session, or put it on a new sandbox.
 *
 * A session recorded on a provider that is no longer active — or a pointer
 * nothing can parse — is not resumed: a fresh sandbox is created on the
 * active provider and the owner is repointed at it. Pi conversation context
 * lives in Postgres and survives that; workspace files do not.
 */
async function resolveOwnedSession(
  backend: AgentBackend,
  agent: Pick<Agent, "id" | "slug" | "currentVersionId">,
  owner: SessionOwner,
  resources: SessionResource[],
  agentVersionId?: string,
  observabilityRunId?: string,
): Promise<ResolvedSession> {
  const surface = owner.ref.surface;
  const activeProvider = await getActiveSandboxProviderId();
  const providerChanged = isSessionProviderMismatch(owner.sessionId, activeProvider);
  if (providerChanged) {
    log.warn(`sessions: replacing ${surface} session after provider change`, {
      ownerId: owner.id,
      previousSessionId: owner.sessionId,
      activeProvider,
    });
  }

  if (owner.sessionId && !providerChanged) {
    log.info(`sessions: resuming ${surface}`, {
      ownerId: owner.id,
      sessionId: owner.sessionId,
      mountResources: resources.length,
    });
    return resume(backend, owner.sessionId, resources, observabilityRunId);
  }

  if (!agent.currentVersionId) {
    throw new Error(
      `Agent "${agent.slug}" has no published version. Publish before running.`,
    );
  }

  const session = await backend.createSession({
    agentId: agent.id,
    agentSlug: agent.slug,
    title: owner.title.slice(0, 120),
    resources: resources.length > 0 ? resources : undefined,
    agentVersionId: agentVersionId ?? agent.currentVersionId,
    surface,
    observability: observabilityRunId ? { runId: observabilityRunId } : undefined,
  });

  // The owner link and the pointer move together: both are unique, so a
  // replacement can only take them by releasing them from its predecessor.
  const claim = await claimSandboxSession(
    {
      store: prismaSandboxSessionClaimStore,
      discard: (id) => backend.discardSession(id),
    },
    {
      owner: owner.ref,
      expectedSessionId: owner.sessionId,
      sessionId: session.id,
    },
  );

  if (!claim.claimed) {
    // Another run created the replacement first. Adopt its sandbox and mount
    // this turn's resources there so nothing is silently missing.
    return resume(backend, claim.sessionId, resources, observabilityRunId);
  }

  log.info(`sessions: created ${surface}`, {
    ownerId: owner.id,
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

async function resume(
  backend: AgentBackend,
  sessionId: string,
  resources: SessionResource[],
  observabilityRunId?: string,
): Promise<ResolvedSession> {
  const mounted =
    resources.length > 0
      ? await backend.mountSessionResources(
          sessionId,
          resources,
          observabilityRunId ? { runId: observabilityRunId } : undefined,
        )
      : {};
  await touchSandboxActivity(sessionId);
  return describeResumedSession(sessionId, mounted.workspaceDir);
}

/**
 * Resume the email thread's existing session, or create a new one when
 * there's no prior session. New sessions get the supplied `resources`
 * mounted; resumed sessions receive them via `mountSessionResources`.
 */
export async function resolveEmailSessionId(
  agent: Pick<Agent, "id" | "slug" | "currentVersionId">,
  thread: EmailThreadSessionInput,
  resources: SessionResource[],
  _forceNewSession: boolean,
  agentVersionId?: string,
  observabilityRunId?: string,
): Promise<ResolvedSession> {
  return resolveOwnedSession(
    await getAgentBackend(),
    agent,
    {
      ref: { surface: "email", threadId: thread.id },
      id: thread.id,
      sessionId: thread.sessionId,
      title: thread.subject,
    },
    resources,
    agentVersionId,
    observabilityRunId,
  );
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
  return resolveOwnedSession(
    await getAgentBackend(),
    agent,
    {
      ref: { surface: "chat", conversationId: conversation.id },
      id: conversation.id,
      sessionId: conversation.sessionId,
      title: conversation.title,
    },
    resources,
    agentVersionId,
    observabilityRunId,
  );
}
