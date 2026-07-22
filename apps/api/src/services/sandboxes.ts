import type { AgentSandbox, Prisma } from "@open-agents/db";
import type {
  SandboxLifecyclePolicy,
  SandboxOrphan,
  SandboxSummaryDto,
} from "@open-agents/types";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { DAYTONA_PROVIDER, parseDaytonaSessionId } from "./daytonaSandbox.js";
import {
  buildSandboxSessionId,
  tryParseSandboxSessionId,
} from "../sandbox-provider/sessionId.js";
import { sandboxProviderRegistry } from "../sandbox-provider/instance.js";
import type { SandboxProviderId } from "../sandbox-provider/types.js";
import { DEFAULT_DAYTONA_LIFECYCLE } from "./sandboxLifecyclePolicy.js";
import {
  createSandboxLifecycle,
  type ReconcileSandboxesResult,
  type SandboxLifecycleRepository,
} from "./sandboxLifecycle.js";
import { sandboxInclude, toSandboxSummary } from "./sandboxSummary.js";

export { toSandboxSummary };

export type RegisterSandboxInput = {
  /** Provider that owns the sandbox. Defaults to Daytona for legacy callers. */
  provider?: SandboxProviderId;
  agentId: string;
  providerSandboxId: string;
  /** Session id the caller already built. Derived when omitted. */
  sessionId?: string;
  lifecyclePolicy?: SandboxLifecyclePolicy;
  surface?: "chat" | "email";
  conversationId?: string;
  threadId?: string;
  state?: string;
};

/**
 * Upsert first-class sandbox metadata after the provider creates a sandbox.
 */
export async function registerAgentSandbox(
  input: RegisterSandboxInput,
): Promise<AgentSandbox> {
  const provider = input.provider ?? DAYTONA_PROVIDER;
  const sessionId =
    input.sessionId ??
    buildSandboxSessionId(provider, input.agentId, input.providerSandboxId);
  const lifecyclePolicy = input.lifecyclePolicy ?? DEFAULT_DAYTONA_LIFECYCLE;
  const now = new Date();

  const row = await prisma.agentSandbox.upsert({
    where: {
      provider_providerSandboxId: {
        provider,
        providerSandboxId: input.providerSandboxId,
      },
    },
    create: {
      provider,
      providerSandboxId: input.providerSandboxId,
      sessionId,
      state: input.state ?? "started",
      agentId: input.agentId,
      surface: input.surface ?? null,
      conversationId: input.conversationId ?? null,
      threadId: input.threadId ?? null,
      lifecyclePolicy,
      lastActivityAt: now,
      lastSyncedAt: now,
    },
    update: {
      sessionId,
      lastActivityAt: now,
      ...(input.state ? { state: input.state } : {}),
      ...(input.surface ? { surface: input.surface } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
    },
  });

  log.info("sandboxes: registered", {
    sandboxId: row.id,
    provider,
    providerSandboxId: input.providerSandboxId,
    sessionId,
    surface: input.surface,
  });
  return row;
}

export async function touchSandboxActivity(sessionId: string): Promise<void> {
  const ref = tryParseSandboxSessionId(sessionId);
  if (!ref) return;
  await prisma.agentSandbox.updateMany({
    where: {
      provider: ref.provider,
      providerSandboxId: ref.providerSandboxId,
    },
    data: { lastActivityAt: new Date() },
  });
}

/**
 * Prisma-backed storage for the provider-neutral lifecycle dispatcher.
 */
const lifecycleRepository: SandboxLifecycleRepository = {
  async getRow(rowId) {
    return prisma.agentSandbox.findUnique({
      where: { id: rowId },
      select: {
        id: true,
        provider: true,
        providerSandboxId: true,
        sessionId: true,
        conversationId: true,
        threadId: true,
        createdAt: true,
        lastActivityAt: true,
      },
    });
  },
  async listActive() {
    return prisma.agentSandbox.findMany({
      where: { state: { not: "deleted" } },
      select: {
        id: true,
        provider: true,
        providerSandboxId: true,
        sessionId: true,
        conversationId: true,
        threadId: true,
        createdAt: true,
        lastActivityAt: true,
      },
    });
  },
  async listKnownProviderSandboxIds(provider) {
    const rows = await prisma.agentSandbox.findMany({
      where: { provider },
      select: { providerSandboxId: true },
    });
    return new Set(rows.map((r) => r.providerSandboxId));
  },
  async applySnapshot(rowId, snapshot) {
    const updated = await prisma.agentSandbox.update({
      where: { id: rowId },
      data: {
        state: snapshot.state,
        ...(snapshot.lastActivityAt ? { lastActivityAt: snapshot.lastActivityAt } : {}),
        lastSyncedAt: new Date(),
        errorReason: snapshot.errorReason,
        recoverable: snapshot.recoverable,
      },
      include: sandboxInclude,
    });
    return toSandboxSummary(updated);
  },
  async markDeleted(rowId) {
    await prisma.agentSandbox.update({
      where: { id: rowId },
      data: {
        state: "deleted",
        lastSyncedAt: new Date(),
        errorReason: null,
        recoverable: null,
      },
    });
  },
  clearSessionPointers: (row) => clearSandboxSessionPointers(row),
};

const lifecycle = createSandboxLifecycle({
  registry: sandboxProviderRegistry,
  repository: lifecycleRepository,
});

export function syncSandboxFromProvider(id: string): Promise<SandboxSummaryDto> {
  return lifecycle.syncFromProvider(id);
}

export function stopSandbox(id: string): Promise<SandboxSummaryDto> {
  return lifecycle.stop(id);
}

export function startSandbox(id: string): Promise<SandboxSummaryDto> {
  return lifecycle.start(id);
}

export function archiveSandbox(id: string): Promise<SandboxSummaryDto> {
  return lifecycle.archive(id);
}

export function recoverSandbox(id: string): Promise<SandboxSummaryDto> {
  return lifecycle.recover(id);
}

export function deleteSandbox(id: string): Promise<void> {
  return lifecycle.remove(id);
}

async function clearSandboxSessionPointers(
  row: Pick<AgentSandbox, "sessionId" | "conversationId" | "threadId">,
): Promise<void> {
  if (row.conversationId) {
    await prisma.chatConversation.updateMany({
      where: { id: row.conversationId, sessionId: row.sessionId },
      data: { sessionId: null },
    });
  }
  if (row.threadId) {
    await prisma.emailThread.updateMany({
      where: { id: row.threadId, sessionId: row.sessionId },
      data: { sessionId: null },
    });
  }
}

export type ListSandboxesQuery = {
  agentId?: string;
  state?: string;
  surface?: "chat" | "email";
  limit?: number;
  offset?: number;
};

export async function listSandboxes(
  query: ListSandboxesQuery,
): Promise<{ sandboxes: SandboxSummaryDto[]; total: number }> {
  const where: Prisma.AgentSandboxWhereInput = {
    ...(query.agentId ? { agentId: query.agentId } : {}),
    ...(query.surface ? { surface: query.surface } : {}),
    state: query.state ?? { not: "deleted" },
  };
  const limit = Math.min(query.limit ?? 50, 200);
  const offset = query.offset ?? 0;
  const [rows, total] = await Promise.all([
    prisma.agentSandbox.findMany({
      where,
      include: sandboxInclude,
      orderBy: { lastActivityAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.agentSandbox.count({ where }),
  ]);
  return { sandboxes: rows.map(toSandboxSummary), total };
}

export async function getSandboxById(id: string): Promise<SandboxSummaryDto | null> {
  const row = await prisma.agentSandbox.findUnique({
    where: { id },
    include: sandboxInclude,
  });
  return row ? toSandboxSummary(row) : null;
}

export async function getSandboxForConversation(
  conversationId: string,
): Promise<SandboxSummaryDto | null> {
  const row = await prisma.agentSandbox.findFirst({
    where: { conversationId },
    include: sandboxInclude,
  });
  return row ? toSandboxSummary(row) : null;
}

export async function getSandboxForThread(
  threadId: string,
): Promise<SandboxSummaryDto | null> {
  const row = await prisma.agentSandbox.findFirst({
    where: { threadId },
    include: sandboxInclude,
  });
  return row ? toSandboxSummary(row) : null;
}

/**
 * Backfill `AgentSandbox` rows for existing Daytona session ids on conversations/threads.
 */
export async function backfillSandboxesFromSessions(): Promise<number> {
  let created = 0;
  const conversations = await prisma.chatConversation.findMany({
    where: { sessionId: { startsWith: `${DAYTONA_PROVIDER}:` } },
    select: { id: true, agentId: true, sessionId: true },
  });
  for (const conv of conversations) {
    if (!conv.sessionId) continue;
    const ref = parseDaytonaSessionId(conv.sessionId);
    const existing = await prisma.agentSandbox.findUnique({
      where: {
        provider_providerSandboxId: {
          provider: DAYTONA_PROVIDER,
          providerSandboxId: ref.sandboxId,
        },
      },
    });
    if (!existing) {
      await registerAgentSandbox({
        agentId: ref.agentId,
        providerSandboxId: ref.sandboxId,
        surface: "chat",
        conversationId: conv.id,
        state: "unknown",
      });
      created += 1;
    } else if (!existing.conversationId) {
      await prisma.agentSandbox.update({
        where: { id: existing.id },
        data: { conversationId: conv.id, surface: "chat" },
      });
    }
  }

  const threads = await prisma.emailThread.findMany({
    where: { sessionId: { startsWith: `${DAYTONA_PROVIDER}:` } },
    select: { id: true, agentId: true, sessionId: true },
  });
  for (const thread of threads) {
    if (!thread.sessionId) continue;
    const ref = parseDaytonaSessionId(thread.sessionId);
    const existing = await prisma.agentSandbox.findUnique({
      where: {
        provider_providerSandboxId: {
          provider: DAYTONA_PROVIDER,
          providerSandboxId: ref.sandboxId,
        },
      },
    });
    if (!existing) {
      await registerAgentSandbox({
        agentId: ref.agentId,
        providerSandboxId: ref.sandboxId,
        surface: "email",
        threadId: thread.id,
        state: "unknown",
      });
      created += 1;
    } else if (!existing.threadId) {
      await prisma.agentSandbox.update({
        where: { id: existing.id },
        data: { threadId: thread.id, surface: "email" },
      });
    }
  }
  return created;
}

export type { ReconcileSandboxesResult };

/**
 * Sync provider state, stop long-idle sandboxes, and clear dead session
 * pointers — across every configured provider. An unavailable provider is
 * counted as an error for its own rows and does not block the others.
 */
export function reconcileSandboxes(): Promise<ReconcileSandboxesResult> {
  return lifecycle.reconcile();
}

/**
 * List sandboxes any configured provider still owns that have no
 * `AgentSandbox` row.
 */
export function listOrphanedSandboxes(): Promise<SandboxOrphan[]> {
  return lifecycle.listOrphans();
}
