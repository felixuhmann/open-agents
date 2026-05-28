import type { AgentSandbox, Prisma } from "@open-agents/db";
import type { SandboxLifecyclePolicy, SandboxSummaryDto } from "@open-agents/types";
import { SandboxLifecyclePolicySchema } from "@open-agents/types";
import type { Sandbox } from "@daytona/sdk";
import { prisma } from "../db.js";
import { log } from "../log.js";
import {
  DAYTONA_PROVIDER,
  buildDaytonaSessionId,
  createDaytonaClient,
  fetchDaytonaSandbox,
  getDaytonaApiKey,
  parseDaytonaSessionId,
  snapshotFromSandbox,
} from "./daytonaSandbox.js";
import { wrapDaytonaError } from "../agent-backend/daytonaErrors.js";
import { AgentBackendError } from "../agent-backend/types.js";
import {
  DEFAULT_DAYTONA_LIFECYCLE,
  ORPHAN_SANDBOX_GRACE_MS,
  STALE_SANDBOX_INACTIVITY_MS,
} from "./sandboxLifecyclePolicy.js";

const sandboxInclude = {
  agent: { select: { slug: true, displayName: true } },
  conversation: { select: { title: true } },
  thread: { select: { subject: true } },
} satisfies Prisma.AgentSandboxInclude;

function parseLifecyclePolicy(raw: unknown): SandboxLifecyclePolicy {
  return SandboxLifecyclePolicySchema.parse(raw);
}

export function toSandboxSummary(
  row: Prisma.AgentSandboxGetPayload<{
    include: typeof sandboxInclude;
  }>,
): SandboxSummaryDto {
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

export type RegisterSandboxInput = {
  agentId: string;
  providerSandboxId: string;
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
  const sessionId = buildDaytonaSessionId(input.agentId, input.providerSandboxId);
  const lifecyclePolicy = input.lifecyclePolicy ?? DEFAULT_DAYTONA_LIFECYCLE;
  const now = new Date();

  const row = await prisma.agentSandbox.upsert({
    where: {
      provider_providerSandboxId: {
        provider: DAYTONA_PROVIDER,
        providerSandboxId: input.providerSandboxId,
      },
    },
    create: {
      provider: DAYTONA_PROVIDER,
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
    providerSandboxId: input.providerSandboxId,
    sessionId,
    surface: input.surface,
  });
  return row;
}

export async function touchSandboxActivity(sessionId: string): Promise<void> {
  const ref = parseDaytonaSessionId(sessionId);
  await prisma.agentSandbox.updateMany({
    where: {
      provider: DAYTONA_PROVIDER,
      providerSandboxId: ref.sandboxId,
    },
    data: { lastActivityAt: new Date() },
  });
}

export async function syncSandboxFromProvider(
  sandboxRowId: string,
): Promise<SandboxSummaryDto> {
  const row = await prisma.agentSandbox.findUnique({
    where: { id: sandboxRowId },
    include: sandboxInclude,
  });
  if (!row) throw new AgentBackendError(`Sandbox not found: ${sandboxRowId}`);
  if (row.provider !== DAYTONA_PROVIDER) {
    throw new AgentBackendError(`Unsupported sandbox provider: ${row.provider}`);
  }

  try {
    const remote = await fetchDaytonaSandbox(row.providerSandboxId);
    const snapshot = snapshotFromSandbox(remote);
    const updated = await prisma.agentSandbox.update({
      where: { id: row.id },
      data: {
        state: snapshot.state,
        lastActivityAt: snapshot.lastActivityAt ?? row.lastActivityAt,
        lastSyncedAt: new Date(),
        errorReason: snapshot.errorReason,
        recoverable: snapshot.recoverable,
      },
      include: sandboxInclude,
    });
    return toSandboxSummary(updated);
  } catch (err) {
    throw wrapDaytonaError(err, "Failed to sync sandbox state from Daytona");
  }
}

async function getSandboxRowOrThrow(id: string) {
  const row = await prisma.agentSandbox.findUnique({
    where: { id },
    include: sandboxInclude,
  });
  if (!row) throw new AgentBackendError(`Sandbox not found: ${id}`);
  return row;
}

async function applyRemoteSnapshot(
  row: Prisma.AgentSandboxGetPayload<{ include: typeof sandboxInclude }>,
  remote: Sandbox,
): Promise<SandboxSummaryDto> {
  const snapshot = snapshotFromSandbox(remote);
  const updated = await prisma.agentSandbox.update({
    where: { id: row.id },
    data: {
      state: snapshot.state,
      lastActivityAt: snapshot.lastActivityAt ?? row.lastActivityAt,
      lastSyncedAt: new Date(),
      errorReason: snapshot.errorReason,
      recoverable: snapshot.recoverable,
    },
    include: sandboxInclude,
  });
  return toSandboxSummary(updated);
}

async function runDaytonaLifecycleAction(
  id: string,
  action: (remote: Sandbox) => Promise<void>,
): Promise<SandboxSummaryDto> {
  const row = await getSandboxRowOrThrow(id);
  if (row.provider !== DAYTONA_PROVIDER) {
    throw new AgentBackendError(`Unsupported sandbox provider: ${row.provider}`);
  }
  try {
    const remote = await fetchDaytonaSandbox(row.providerSandboxId);
    await action(remote);
    const refreshed = await fetchDaytonaSandbox(row.providerSandboxId);
    return applyRemoteSnapshot(row, refreshed);
  } catch (err) {
    throw wrapDaytonaError(err, `Sandbox ${id} lifecycle action failed`);
  }
}

export function stopSandbox(id: string): Promise<SandboxSummaryDto> {
  return runDaytonaLifecycleAction(id, async (remote) => {
    if (remote.state === "started") {
      await remote.stop(90);
    }
  });
}

export function startSandbox(id: string): Promise<SandboxSummaryDto> {
  return runDaytonaLifecycleAction(id, async (remote) => {
    if (remote.state !== "started") {
      await remote.start(90);
      await remote.refreshActivity();
    }
  });
}

export function archiveSandbox(id: string): Promise<SandboxSummaryDto> {
  return runDaytonaLifecycleAction(id, async (remote) => {
    if (remote.state === "started") {
      await remote.stop(90);
    }
    await remote.archive();
  });
}

export function recoverSandbox(id: string): Promise<SandboxSummaryDto> {
  return runDaytonaLifecycleAction(id, async (remote) => {
    if (remote.state === "error" && remote.recoverable) {
      await remote.recover(90);
    }
  });
}

export async function deleteSandbox(id: string): Promise<void> {
  const row = await getSandboxRowOrThrow(id);
  if (row.provider !== DAYTONA_PROVIDER) {
    throw new AgentBackendError(`Unsupported sandbox provider: ${row.provider}`);
  }
  try {
    const remote = await fetchDaytonaSandbox(row.providerSandboxId);
    await remote.delete(90);
  } catch (err) {
    throw wrapDaytonaError(err, `Failed to delete sandbox ${id}`);
  }

  await clearSandboxSessionPointers(row);
  await prisma.agentSandbox.update({
    where: { id: row.id },
    data: {
      state: "deleted",
      lastSyncedAt: new Date(),
      errorReason: null,
      recoverable: null,
    },
  });
  log.info("sandboxes: deleted", {
    sandboxId: id,
    providerSandboxId: row.providerSandboxId,
  });
}

async function clearSandboxSessionPointers(
  row: Pick<AgentSandbox, "sessionId" | "conversationId" | "threadId">,
): Promise<void> {
  if (row.conversationId) {
    await prisma.chatConversation.updateMany({
      where: { id: row.conversationId, anthropicSessionId: row.sessionId },
      data: { anthropicSessionId: null },
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
    where: { anthropicSessionId: { startsWith: `${DAYTONA_PROVIDER}:` } },
    select: { id: true, agentId: true, anthropicSessionId: true },
  });
  for (const conv of conversations) {
    if (!conv.anthropicSessionId) continue;
    const ref = parseDaytonaSessionId(conv.anthropicSessionId);
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

export type ReconcileSandboxesResult = {
  synced: number;
  staleStopped: number;
  orphansStopped: number;
  pointersCleared: number;
  errors: number;
};

/**
 * Sync provider state, stop long-idle sandboxes, and clear dead session pointers.
 */
export async function reconcileSandboxes(): Promise<ReconcileSandboxesResult> {
  const apiKey = await getDaytonaApiKey();
  if (!apiKey) {
    log.debug("sandboxes: reconcile skipped (no Daytona API key)");
    return {
      synced: 0,
      staleStopped: 0,
      orphansStopped: 0,
      pointersCleared: 0,
      errors: 0,
    };
  }

  const result: ReconcileSandboxesResult = {
    synced: 0,
    staleStopped: 0,
    orphansStopped: 0,
    pointersCleared: 0,
    errors: 0,
  };

  const staleBefore = new Date(Date.now() - STALE_SANDBOX_INACTIVITY_MS);
  const orphanBefore = new Date(Date.now() - ORPHAN_SANDBOX_GRACE_MS);

  const rows = await prisma.agentSandbox.findMany({
    where: { provider: DAYTONA_PROVIDER, state: { not: "deleted" } },
    include: sandboxInclude,
  });

  for (const row of rows) {
    try {
      let remote: Sandbox;
      try {
        remote = await fetchDaytonaSandbox(row.providerSandboxId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/not found|404/i.test(message)) {
          await clearSandboxSessionPointers(row);
          await prisma.agentSandbox.update({
            where: { id: row.id },
            data: { state: "deleted", lastSyncedAt: new Date() },
          });
          result.pointersCleared += 1;
          continue;
        }
        throw err;
      }

      await applyRemoteSnapshot(row, remote);
      result.synced += 1;

      const isOrphan = !row.conversationId && !row.threadId;
      const isStale = row.lastActivityAt < staleBefore;
      const shouldStop =
        remote.state === "started" &&
        (isStale || (isOrphan && row.createdAt < orphanBefore));

      if (shouldStop) {
        await remote.stop(60);
        await applyRemoteSnapshot(row, await fetchDaytonaSandbox(row.providerSandboxId));
        if (isOrphan) result.orphansStopped += 1;
        else result.staleStopped += 1;
        log.info("sandboxes: reconcile stopped idle sandbox", {
          sandboxId: row.id,
          providerSandboxId: row.providerSandboxId,
          isOrphan,
          isStale,
        });
      }
    } catch (err) {
      result.errors += 1;
      log.warn("sandboxes: reconcile row failed", {
        sandboxId: row.id,
        err: String(err),
      });
    }
  }

  log.info("sandboxes: reconcile complete", result);
  return result;
}

/**
 * List sandboxes from Daytona that carry our labels but lack a DB row (orphans).
 */
export async function listUnregisteredDaytonaSandboxes(): Promise<
  Array<{ providerSandboxId: string; state: string; agentId?: string }>
> {
  const daytona = await createDaytonaClient();
  const known = new Set(
    (
      await prisma.agentSandbox.findMany({
        where: { provider: DAYTONA_PROVIDER },
        select: { providerSandboxId: true },
      })
    ).map((r) => r.providerSandboxId),
  );

  const orphans: Array<{ providerSandboxId: string; state: string; agentId?: string }> =
    [];
  for await (const item of daytona.list()) {
    const labels = item.labels ?? {};
    if (!labels["open-agents-agent-id"]) continue;
    if (known.has(item.id)) continue;
    orphans.push({
      providerSandboxId: item.id,
      state: item.state ?? "unknown",
      agentId: labels["open-agents-agent-id"],
    });
  }
  return orphans;
}
