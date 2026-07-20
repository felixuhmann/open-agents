import type { AgentSandbox, Prisma } from "@open-agents/db";
import type { SandboxLifecyclePolicy, SandboxSummaryDto } from "@open-agents/types";
import { SandboxLifecyclePolicySchema } from "@open-agents/types";
import { prisma } from "../db.js";
import { log } from "../log.js";
import {
  OPENSANDBOX_PROVIDER,
  buildOpenSandboxSessionId,
  parseOpenSandboxSessionId,
} from "../agent-backend/opensandbox/session.js";
import {
  getOpenSandboxTransport,
  isOpenSandboxConfigured,
} from "../agent-backend/opensandbox/runtime.js";
import type { SandboxInfoSnapshot } from "../agent-backend/opensandbox/transport.js";
import { planReconcileAction } from "../agent-backend/opensandbox/lifecycle.js";
import { wrapOpenSandboxError } from "../agent-backend/opensandboxErrors.js";
import { AgentBackendError } from "../agent-backend/types.js";
import {
  DEFAULT_SANDBOX_LIFECYCLE,
  ORPHAN_SANDBOX_GRACE_MS,
  isPastAutoStopInterval,
} from "./sandboxLifecyclePolicy.js";

const LABEL_AGENT_ID = "open-agents-agent-id";

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
  const sessionId = buildOpenSandboxSessionId(input.agentId, input.providerSandboxId);
  const lifecyclePolicy = input.lifecyclePolicy ?? DEFAULT_SANDBOX_LIFECYCLE;
  const now = new Date();

  const row = await prisma.agentSandbox.upsert({
    where: {
      provider_providerSandboxId: {
        provider: OPENSANDBOX_PROVIDER,
        providerSandboxId: input.providerSandboxId,
      },
    },
    create: {
      provider: OPENSANDBOX_PROVIDER,
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
  const ref = parseOpenSandboxSessionId(sessionId);
  await prisma.agentSandbox.updateMany({
    where: {
      provider: OPENSANDBOX_PROVIDER,
      providerSandboxId: ref.sandboxId,
    },
    data: { lastActivityAt: new Date() },
  });
}

async function getSandboxRowOrThrow(id: string) {
  const row = await prisma.agentSandbox.findUnique({
    where: { id },
    include: sandboxInclude,
  });
  if (!row) throw new AgentBackendError(`Sandbox not found: ${id}`);
  return row;
}

function requireOpenSandboxRow(row: Pick<AgentSandbox, "provider">): void {
  if (row.provider !== OPENSANDBOX_PROVIDER) {
    throw new AgentBackendError(`Unsupported sandbox provider: ${row.provider}`);
  }
}

async function applySnapshot(
  row: Prisma.AgentSandboxGetPayload<{ include: typeof sandboxInclude }>,
  snapshot: SandboxInfoSnapshot,
): Promise<SandboxSummaryDto> {
  const updated = await prisma.agentSandbox.update({
    where: { id: row.id },
    data: {
      state: snapshot.state,
      lastSyncedAt: new Date(),
      errorReason: snapshot.errorReason,
      recoverable: null,
    },
    include: sandboxInclude,
  });
  return toSandboxSummary(updated);
}

export async function syncSandboxFromProvider(
  sandboxRowId: string,
): Promise<SandboxSummaryDto> {
  const row = await prisma.agentSandbox.findUnique({
    where: { id: sandboxRowId },
    include: sandboxInclude,
  });
  if (!row) throw new AgentBackendError(`Sandbox not found: ${sandboxRowId}`);
  requireOpenSandboxRow(row);

  try {
    const snapshot = await getOpenSandboxTransport().getInfo(row.providerSandboxId);
    return await applySnapshot(row, snapshot);
  } catch (err) {
    throw wrapOpenSandboxError(err, "Failed to sync sandbox state from OpenSandbox");
  }
}

/** Stop = pause the sandbox (OpenSandbox has no separate stop primitive). */
export async function stopSandbox(id: string): Promise<SandboxSummaryDto> {
  const row = await getSandboxRowOrThrow(id);
  requireOpenSandboxRow(row);
  try {
    const transport = getOpenSandboxTransport();
    const info = await transport.getInfo(row.providerSandboxId);
    if (info.state === "started") await transport.pause(row.providerSandboxId);
    return await applySnapshot(row, await transport.getInfo(row.providerSandboxId));
  } catch (err) {
    throw wrapOpenSandboxError(err, `Sandbox ${id} stop failed`);
  }
}

/** Start = resume a paused sandbox. */
export async function startSandbox(id: string): Promise<SandboxSummaryDto> {
  const row = await getSandboxRowOrThrow(id);
  requireOpenSandboxRow(row);
  try {
    const transport = getOpenSandboxTransport();
    const info = await transport.getInfo(row.providerSandboxId);
    if (info.state === "stopped") await transport.resume(row.providerSandboxId);
    return await applySnapshot(row, await transport.getInfo(row.providerSandboxId));
  } catch (err) {
    throw wrapOpenSandboxError(err, `Sandbox ${id} start failed`);
  }
}

/** Compatibility alias: OpenSandbox archive is represented by a durable pause. */
export function archiveSandbox(id: string): Promise<SandboxSummaryDto> {
  return stopSandbox(id);
}

/** Compatibility alias: recovering a paused sandbox resumes it. */
export function recoverSandbox(id: string): Promise<SandboxSummaryDto> {
  return startSandbox(id);
}

export async function deleteSandbox(id: string): Promise<void> {
  const row = await getSandboxRowOrThrow(id);
  requireOpenSandboxRow(row);
  try {
    await getOpenSandboxTransport().kill(row.providerSandboxId);
  } catch (err) {
    throw wrapOpenSandboxError(err, `Failed to delete sandbox ${id}`);
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
    retiredAt: null,
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
 * Backfill `AgentSandbox` rows for existing OpenSandbox session ids on
 * conversations/threads.
 */
export async function backfillSandboxesFromSessions(): Promise<number> {
  let created = 0;
  const conversations = await prisma.chatConversation.findMany({
    where: { sessionId: { startsWith: `${OPENSANDBOX_PROVIDER}:` } },
    select: { id: true, agentId: true, sessionId: true },
  });
  for (const conv of conversations) {
    if (!conv.sessionId) continue;
    const ref = parseOpenSandboxSessionId(conv.sessionId);
    const existing = await prisma.agentSandbox.findUnique({
      where: {
        provider_providerSandboxId: {
          provider: OPENSANDBOX_PROVIDER,
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
    where: { sessionId: { startsWith: `${OPENSANDBOX_PROVIDER}:` } },
    select: { id: true, agentId: true, sessionId: true },
  });
  for (const thread of threads) {
    if (!thread.sessionId) continue;
    const ref = parseOpenSandboxSessionId(thread.sessionId);
    const existing = await prisma.agentSandbox.findUnique({
      where: {
        provider_providerSandboxId: {
          provider: OPENSANDBOX_PROVIDER,
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
 * Sync provider state, pause long-idle sandboxes, and clear dead session
 * pointers for sandboxes the provider no longer has.
 */
export async function reconcileSandboxes(): Promise<ReconcileSandboxesResult> {
  const result: ReconcileSandboxesResult = {
    synced: 0,
    staleStopped: 0,
    orphansStopped: 0,
    pointersCleared: 0,
    errors: 0,
  };

  if (!isOpenSandboxConfigured()) {
    log.debug("sandboxes: reconcile skipped (OpenSandbox not configured)");
    return result;
  }
  const transport = getOpenSandboxTransport();

  const now = new Date();
  const orphanBefore = new Date(now.getTime() - ORPHAN_SANDBOX_GRACE_MS);

  const rows = await prisma.agentSandbox.findMany({
    where: { provider: OPENSANDBOX_PROVIDER, state: { not: "deleted" } },
    include: sandboxInclude,
  });

  for (const row of rows) {
    try {
      let snapshot: SandboxInfoSnapshot;
      try {
        snapshot = await transport.getInfo(row.providerSandboxId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/not found|404|deleted/i.test(message)) {
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

      const isOrphan = !row.conversationId && !row.threadId;
      const isStale = isPastAutoStopInterval(
        row.lastActivityAt,
        now,
        parseLifecyclePolicy(row.lifecyclePolicy),
      );
      const action = planReconcileAction({
        state: snapshot.state,
        isOrphan,
        isStale,
        orphanExpired: row.createdAt < orphanBefore,
      });

      if (action === "clear") {
        await clearSandboxSessionPointers(row);
        await prisma.agentSandbox.update({
          where: { id: row.id },
          data: { state: "deleted", lastSyncedAt: new Date() },
        });
        result.pointersCleared += 1;
        continue;
      }

      await applySnapshot(row, snapshot);
      result.synced += 1;

      if (action === "pause") {
        await transport.pause(row.providerSandboxId);
        await applySnapshot(row, await transport.getInfo(row.providerSandboxId));
        if (isOrphan) result.orphansStopped += 1;
        else result.staleStopped += 1;
        log.info("sandboxes: reconcile paused idle sandbox", {
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
 * List sandboxes in OpenSandbox that carry our label but lack a DB row (orphans).
 */
export async function listUnregisteredSandboxes(): Promise<
  Array<{ providerSandboxId: string; state: string; agentId?: string }>
> {
  if (!isOpenSandboxConfigured()) return [];
  const known = new Set(
    (
      await prisma.agentSandbox.findMany({
        where: { provider: OPENSANDBOX_PROVIDER },
        select: { providerSandboxId: true },
      })
    ).map((r) => r.providerSandboxId),
  );

  const orphans: Array<{ providerSandboxId: string; state: string; agentId?: string }> =
    [];
  const items = await getOpenSandboxTransport().listWithLabel(LABEL_AGENT_ID);
  for (const item of items) {
    if (known.has(item.id)) continue;
    orphans.push({
      providerSandboxId: item.id,
      state: item.state,
      agentId: item.metadata[LABEL_AGENT_ID],
    });
  }
  return orphans;
}
