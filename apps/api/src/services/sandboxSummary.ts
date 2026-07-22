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
