import type { Prisma } from "@open-agents/db";
import type { SandboxLifecyclePolicy, SandboxSummaryDto } from "@open-agents/types";
import { SandboxLifecyclePolicySchema } from "@open-agents/types";

/**
 * Pure `AgentSandbox` → DTO projection. Kept free of Prisma/provider imports
 * so the mapping can be exercised without a database.
 */

export const sandboxInclude = {
  agent: { select: { slug: true, displayName: true } },
  conversation: { select: { title: true } },
  thread: { select: { subject: true } },
} satisfies Prisma.AgentSandboxInclude;

export type SandboxRowWithRelations = Prisma.AgentSandboxGetPayload<{
  include: typeof sandboxInclude;
}>;

export function parseLifecyclePolicy(raw: unknown): SandboxLifecyclePolicy {
  return SandboxLifecyclePolicySchema.parse(raw);
}

/**
 * Which sandbox "the sandbox for this conversation/thread" means.
 *
 * The owner's own session pointer is authoritative. After a provider switch
 * the conversation points at its replacement sandbox while the retired row
 * may still be around, so resolving by the owner link alone can hand the
 * admin UI the obsolete provider's row and let an operator stop or delete a
 * sandbox the agent is not using. The link is only a fallback, for rows that
 * predate a pointer (backfilled history) or an owner whose pointer was
 * cleared.
 */
export async function pickCurrentSandbox<T>(deps: {
  ownerSessionId: () => Promise<string | null>;
  bySessionId: (sessionId: string) => Promise<T | null>;
  byOwnerLink: () => Promise<T | null>;
}): Promise<T | null> {
  const sessionId = await deps.ownerSessionId();
  if (sessionId) {
    const current = await deps.bySessionId(sessionId);
    if (current) return current;
  }
  return deps.byOwnerLink();
}

export function toSandboxSummary(row: SandboxRowWithRelations): SandboxSummaryDto {
  return {
    id: row.id,
    provider: row.provider,
    providerSandboxId: row.providerSandboxId,
    sessionId: row.sessionId,
    state: row.state,
    agentId: row.agentId,
    agentSlug: row.agent?.slug,
    agentDisplayName: row.agent?.displayName,
    surface: row.surface === "chat" || row.surface === "email" ? row.surface : null,
    conversationId: row.conversationId,
    conversationTitle: row.conversation?.title ?? null,
    threadId: row.threadId,
    threadSubject: row.thread?.subject ?? null,
    lifecyclePolicy: parseLifecyclePolicy(row.lifecyclePolicy),
    lastActivityAt: row.lastActivityAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    errorReason: row.errorReason,
    recoverable: row.recoverable,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
