import type { SandboxOrphan, SandboxSummaryDto } from "@open-agents/types";
import { AgentBackendError } from "../agent-backend/types.js";
import type { SandboxProviderRegistry } from "../sandbox-provider/registry.js";
import {
  isSandboxProviderId,
  type SandboxProvider,
  type SandboxProviderId,
  type SandboxSnapshot,
} from "../sandbox-provider/types.js";
import { log } from "../log.js";
import {
  ORPHAN_SANDBOX_GRACE_MS,
  STALE_SANDBOX_INACTIVITY_MS,
} from "./sandboxLifecyclePolicy.js";

/**
 * Provider-neutral sandbox lifecycle dispatch.
 *
 * Every operation routes through the *row's own* `provider` column, not the
 * deployment's currently active provider, so sandboxes created before a
 * provider switch stay manageable. Failures are contained per row and per
 * provider: one unreachable provider must not stop reconciling the others.
 *
 * Storage and provider construction are injected so this logic is testable
 * without a database or credentials.
 */

/** Slice of `AgentSandbox` lifecycle decisions need. */
export type SandboxLifecycleRow = {
  id: string;
  provider: string;
  providerSandboxId: string;
  sessionId: string;
  conversationId: string | null;
  threadId: string | null;
  createdAt: Date;
  lastActivityAt: Date;
};

export type SandboxLifecycleRepository = {
  getRow(rowId: string): Promise<SandboxLifecycleRow | null>;
  /** Every non-deleted sandbox row, across providers. */
  listActive(): Promise<SandboxLifecycleRow[]>;
  listKnownProviderSandboxIds(provider: SandboxProviderId): Promise<Set<string>>;
  applySnapshot(rowId: string, snapshot: SandboxSnapshot): Promise<SandboxSummaryDto>;
  markDeleted(rowId: string): Promise<void>;
  clearSessionPointers(row: SandboxLifecycleRow): Promise<void>;
};

export type SandboxLifecycleDeps = {
  registry: SandboxProviderRegistry;
  repository: SandboxLifecycleRepository;
  now?: () => Date;
};

export type ReconcileSandboxesResult = {
  synced: number;
  staleStopped: number;
  orphansStopped: number;
  pointersCleared: number;
  errors: number;
};

export type SandboxLifecycle = {
  syncFromProvider(rowId: string): Promise<SandboxSummaryDto>;
  start(rowId: string): Promise<SandboxSummaryDto>;
  stop(rowId: string): Promise<SandboxSummaryDto>;
  archive(rowId: string): Promise<SandboxSummaryDto>;
  recover(rowId: string): Promise<SandboxSummaryDto>;
  remove(rowId: string): Promise<void>;
  reconcile(): Promise<ReconcileSandboxesResult>;
  listOrphans(): Promise<SandboxOrphan[]>;
};

function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not found|404/i.test(message);
}

export function createSandboxLifecycle(deps: SandboxLifecycleDeps): SandboxLifecycle {
  const now = deps.now ?? (() => new Date());

  async function providerForRow(row: SandboxLifecycleRow): Promise<SandboxProvider> {
    if (!isSandboxProviderId(row.provider)) {
      throw new AgentBackendError(
        `Unsupported sandbox provider "${row.provider}" on sandbox ${row.id}`,
      );
    }
    return deps.registry.get(row.provider);
  }

  async function requireRow(rowId: string): Promise<SandboxLifecycleRow> {
    const row = await deps.repository.getRow(rowId);
    if (!row) throw new AgentBackendError(`Sandbox not found: ${rowId}`);
    return row;
  }

  async function act(
    rowId: string,
    action: (
      provider: SandboxProvider,
      row: SandboxLifecycleRow,
    ) => Promise<SandboxSnapshot>,
  ): Promise<SandboxSummaryDto> {
    const row = await requireRow(rowId);
    const provider = await providerForRow(row);
    const snapshot = await action(provider, row);
    return deps.repository.applySnapshot(row.id, snapshot);
  }

  /**
   * Optional capabilities (archive/recover) must fail locally and clearly
   * rather than silently doing nothing.
   */
  function requireCapability(
    provider: SandboxProvider,
    capability: "archive" | "recover",
  ): NonNullable<SandboxProvider["archive"]> {
    const method = provider[capability];
    if (!provider.capabilities[capability] || !method) {
      throw new AgentBackendError(
        `Sandbox provider "${provider.id}" does not support ${capability}.`,
      );
    }
    return method.bind(provider);
  }

  return {
    syncFromProvider: (rowId) =>
      act(rowId, (provider, row) => provider.inspect(row.providerSandboxId)),

    start: (rowId) =>
      act(rowId, (provider, row) => provider.start(row.providerSandboxId)),

    stop: (rowId) => act(rowId, (provider, row) => provider.stop(row.providerSandboxId)),

    archive: (rowId) =>
      act(rowId, (provider, row) =>
        requireCapability(provider, "archive")(row.providerSandboxId),
      ),

    recover: (rowId) =>
      act(rowId, (provider, row) =>
        requireCapability(provider, "recover")(row.providerSandboxId),
      ),

    async remove(rowId: string): Promise<void> {
      const row = await requireRow(rowId);
      const provider = await providerForRow(row);
      await provider.delete(row.providerSandboxId);
      await deps.repository.clearSessionPointers(row);
      await deps.repository.markDeleted(row.id);
      log.info("sandboxes: deleted", {
        sandboxId: row.id,
        provider: row.provider,
        providerSandboxId: row.providerSandboxId,
      });
    },

    async reconcile(): Promise<ReconcileSandboxesResult> {
      const result: ReconcileSandboxesResult = {
        synced: 0,
        staleStopped: 0,
        orphansStopped: 0,
        pointersCleared: 0,
        errors: 0,
      };
      const staleBefore = new Date(now().getTime() - STALE_SANDBOX_INACTIVITY_MS);
      const orphanBefore = new Date(now().getTime() - ORPHAN_SANDBOX_GRACE_MS);

      const rows = await deps.repository.listActive();
      // Resolve each provider once so an unavailable one costs a single
      // failed lookup rather than one per row.
      const providers = new Map<string, SandboxProvider | null>();

      for (const row of rows) {
        try {
          if (!providers.has(row.provider)) {
            providers.set(
              row.provider,
              isSandboxProviderId(row.provider)
                ? await deps.registry.tryGet(row.provider)
                : null,
            );
          }
          const provider = providers.get(row.provider) ?? null;
          if (!provider) {
            result.errors += 1;
            log.warn("sandboxes: reconcile skipped row (provider unavailable)", {
              sandboxId: row.id,
              provider: row.provider,
            });
            continue;
          }

          let snapshot: SandboxSnapshot;
          try {
            snapshot = await provider.inspect(row.providerSandboxId);
          } catch (err) {
            if (isNotFoundError(err)) {
              await deps.repository.clearSessionPointers(row);
              await deps.repository.markDeleted(row.id);
              result.pointersCleared += 1;
              continue;
            }
            throw err;
          }

          await deps.repository.applySnapshot(row.id, snapshot);
          result.synced += 1;

          const isOrphan = !row.conversationId && !row.threadId;
          const isStale = row.lastActivityAt < staleBefore;
          const shouldStop =
            snapshot.state === "started" &&
            (isStale || (isOrphan && row.createdAt < orphanBefore));

          if (shouldStop) {
            const stopped = await provider.stop(row.providerSandboxId);
            await deps.repository.applySnapshot(row.id, stopped);
            if (isOrphan) result.orphansStopped += 1;
            else result.staleStopped += 1;
            log.info("sandboxes: reconcile stopped idle sandbox", {
              sandboxId: row.id,
              provider: row.provider,
              providerSandboxId: row.providerSandboxId,
              isOrphan,
              isStale,
            });
          }
        } catch (err) {
          result.errors += 1;
          log.warn("sandboxes: reconcile row failed", {
            sandboxId: row.id,
            provider: row.provider,
            err: String(err),
          });
        }
      }

      log.info("sandboxes: reconcile complete", result);
      return result;
    },

    async listOrphans(): Promise<SandboxOrphan[]> {
      const orphans: SandboxOrphan[] = [];
      for (const id of deps.registry.registeredIds()) {
        const provider = await deps.registry.tryGet(id);
        if (!provider) continue;
        const known = await deps.repository.listKnownProviderSandboxIds(id);
        try {
          for await (const snapshot of provider.listOwned()) {
            if (known.has(snapshot.providerSandboxId)) continue;
            orphans.push({
              provider: id,
              providerSandboxId: snapshot.providerSandboxId,
              state: snapshot.state,
              ...(snapshot.agentId ? { agentId: snapshot.agentId } : {}),
            });
          }
        } catch (err) {
          log.warn("sandboxes: orphan listing failed for provider", {
            provider: id,
            err: String(err),
          });
        }
      }
      return orphans;
    },
  };
}
