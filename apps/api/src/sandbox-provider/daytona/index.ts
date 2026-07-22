import { randomUUID } from "node:crypto";
import { posix as path } from "node:path";
import { Daytona } from "@daytona/sdk";
import type { SandboxPolicyBundle } from "@open-agents/types";
import { log } from "../../log.js";
import { toDaytonaNetworkOptions } from "../../services/sandboxPolicy.js";
import type {
  ProviderHealth,
  RemovePathOptions,
  SandboxCreateInput,
  SandboxExecInput,
  SandboxExecResult,
  SandboxHandle,
  SandboxProvider,
  SandboxProviderCapabilities,
  SandboxSearchResult,
  SandboxSnapshot,
} from "../types.js";
import type { DaytonaClientLike, DaytonaSandboxLike } from "./client.js";
import { wrapDaytonaError } from "./errors.js";
import { runSandboxCommand } from "./exec.js";
import { ensureSandboxDir, resolveSandboxWorkspaceDir, toBuffer } from "./files.js";
import { ensureDaytonaSandboxReady, snapshotFromSandbox } from "./lifecycle.js";

export { wrapDaytonaError } from "./errors.js";
export { ensureDaytonaSandboxReady, snapshotFromSandbox } from "./lifecycle.js";
export { ensureSandboxDir, resolveSandboxWorkspaceDir } from "./files.js";

/** Label Open Agents stamps on every sandbox it owns. */
export const DAYTONA_AGENT_ID_LABEL = "open-agents-agent-id";
export const DAYTONA_AGENT_SLUG_LABEL = "open-agents-agent-slug";

const LIFECYCLE_TIMEOUT_SECONDS = 90;
const CREATE_TIMEOUT_SECONDS = 90;

const CAPABILITIES: SandboxProviderCapabilities = {
  networkModes: ["deny-all", "unrestricted", "cidr-allowlist"],
  archive: true,
  recover: true,
};

class DaytonaSandboxHandle implements SandboxHandle {
  readonly provider = "daytona" as const;

  constructor(
    private readonly sandbox: DaytonaSandboxLike,
    readonly workspaceDir: string,
  ) {}

  get providerSandboxId(): string {
    return this.sandbox.id;
  }

  get state(): string {
    return this.sandbox.state ?? "unknown";
  }

  async exec(input: SandboxExecInput): Promise<SandboxExecResult> {
    const result = await runSandboxCommand({
      sandbox: this.sandbox,
      command: input.command,
      cwd: input.cwd ?? this.workspaceDir,
      workspaceDir: this.workspaceDir,
      timeoutSeconds: input.timeoutSeconds,
      policy: input.policy,
      onOutput: input.onOutput,
    });
    return result;
  }

  async readFile(remotePath: string): Promise<Uint8Array> {
    const bytes = await this.sandbox.fs.downloadFile(remotePath);
    return new Uint8Array(bytes);
  }

  async writeFile(remotePath: string, bytes: Uint8Array): Promise<void> {
    await ensureSandboxDir(this.sandbox.fs, path.dirname(remotePath));
    await this.sandbox.fs.uploadFile(toBuffer(bytes), remotePath);
  }

  async makeDir(remotePath: string): Promise<void> {
    await ensureSandboxDir(this.sandbox.fs, remotePath);
  }

  searchFiles(root: string, pattern: string): Promise<SandboxSearchResult> {
    return this.sandbox.fs.searchFiles(root, pattern);
  }

  async removePath(remotePath: string, options?: RemovePathOptions): Promise<void> {
    await this.sandbox.fs.deleteFile(remotePath, options?.recursive ?? false);
  }
}

export type DaytonaSandboxProviderOptions = {
  /** Build (or return) the Daytona client. Injected so tests need no SDK. */
  createClient: () => DaytonaClientLike;
};

/**
 * Daytona implementation of the low-level sandbox contract. Everything the
 * former `DaytonaAgentBackend` did against `@daytona/sdk` lives here; the Pi
 * model/tool loop consumes only {@link SandboxHandle}.
 */
export class DaytonaSandboxProvider implements SandboxProvider {
  readonly id = "daytona" as const;
  readonly capabilities = CAPABILITIES;

  constructor(private readonly options: DaytonaSandboxProviderOptions) {}

  private client(): DaytonaClientLike {
    return this.options.createClient();
  }

  async health(): Promise<ProviderHealth> {
    try {
      const iterator = this.client().list()[Symbol.asyncIterator]();
      await iterator.next();
      await iterator.return?.(undefined);
      return { available: true };
    } catch (err) {
      return {
        available: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Daytona supports every network mode we model, so nothing is rejected. */
  validatePolicy(_policy: SandboxPolicyBundle): void {
    // Intentionally permissive: deny-all, unrestricted, and CIDR allowlists
    // are all expressible as Daytona create/update network settings.
  }

  async create(input: SandboxCreateInput): Promise<SandboxHandle> {
    try {
      const slug = (input.agentSlug ?? input.agentId).replace(/[^a-z0-9-]/gi, "-");
      const sandbox = await this.client().create(
        {
          name: `oa-${slug.slice(0, 32)}-${randomUUID().slice(0, 8)}`,
          language: "typescript",
          ...(input.lifecycle
            ? {
                autoStopInterval: input.lifecycle.autoStopInterval,
                autoArchiveInterval: input.lifecycle.autoArchiveInterval,
                autoDeleteInterval: input.lifecycle.autoDeleteInterval,
              }
            : {}),
          labels: {
            [DAYTONA_AGENT_ID_LABEL]: input.agentId,
            [DAYTONA_AGENT_SLUG_LABEL]: input.agentSlug ?? "",
            ...input.labels,
          },
          ...toDaytonaNetworkOptions(input.policy.network),
        },
        { timeout: CREATE_TIMEOUT_SECONDS },
      );
      await applyNetworkPolicy(sandbox, input.policy);
      const workspaceDir = await resolveSandboxWorkspaceDir(sandbox);
      return new DaytonaSandboxHandle(sandbox, workspaceDir);
    } catch (err) {
      throw wrapDaytonaError(err, "Failed to create Daytona sandbox session");
    }
  }

  async connect(providerSandboxId: string): Promise<SandboxHandle> {
    try {
      const sandbox = await this.client().get(providerSandboxId);
      const { sandbox: ready } = await ensureDaytonaSandboxReady(sandbox);
      const workspaceDir = await resolveSandboxWorkspaceDir(ready);
      return new DaytonaSandboxHandle(ready, workspaceDir);
    } catch (err) {
      throw wrapDaytonaError(err, `Failed to connect to Daytona sandbox ${providerSandboxId}`);
    }
  }

  /**
   * Like {@link connect}, but also reports which lifecycle transitions were
   * needed so the caller can emit `sandbox.recovered` / `sandbox.started`
   * run events.
   */
  async connectWithTransitions(providerSandboxId: string): Promise<{
    handle: SandboxHandle;
    previousState: string;
    transitions: ("recover" | "start")[];
  }> {
    try {
      const sandbox = await this.client().get(providerSandboxId);
      const { sandbox: ready, previousState, transitions } =
        await ensureDaytonaSandboxReady(sandbox);
      const workspaceDir = await resolveSandboxWorkspaceDir(ready);
      return {
        handle: new DaytonaSandboxHandle(ready, workspaceDir),
        previousState,
        transitions,
      };
    } catch (err) {
      throw wrapDaytonaError(err, `Failed to connect to Daytona sandbox ${providerSandboxId}`);
    }
  }

  async inspect(providerSandboxId: string): Promise<SandboxSnapshot> {
    try {
      return snapshotFromSandbox(await this.client().get(providerSandboxId));
    } catch (err) {
      throw wrapDaytonaError(err, `Failed to inspect Daytona sandbox ${providerSandboxId}`);
    }
  }

  start(providerSandboxId: string): Promise<SandboxSnapshot> {
    return this.lifecycleAction(providerSandboxId, "start", async (remote) => {
      if (remote.state !== "started") {
        await remote.start(LIFECYCLE_TIMEOUT_SECONDS);
        await remote.refreshActivity();
      }
    });
  }

  stop(providerSandboxId: string): Promise<SandboxSnapshot> {
    return this.lifecycleAction(providerSandboxId, "stop", async (remote) => {
      if (remote.state === "started") {
        await remote.stop(LIFECYCLE_TIMEOUT_SECONDS);
      }
    });
  }

  archive(providerSandboxId: string): Promise<SandboxSnapshot> {
    return this.lifecycleAction(providerSandboxId, "archive", async (remote) => {
      if (remote.state === "started") {
        await remote.stop(LIFECYCLE_TIMEOUT_SECONDS);
      }
      await remote.archive();
    });
  }

  recover(providerSandboxId: string): Promise<SandboxSnapshot> {
    return this.lifecycleAction(providerSandboxId, "recover", async (remote) => {
      if (remote.state === "error" && remote.recoverable) {
        await remote.recover(LIFECYCLE_TIMEOUT_SECONDS);
      }
    });
  }

  async delete(providerSandboxId: string): Promise<void> {
    try {
      const remote = await this.client().get(providerSandboxId);
      await remote.delete(LIFECYCLE_TIMEOUT_SECONDS);
    } catch (err) {
      throw wrapDaytonaError(err, `Failed to delete sandbox ${providerSandboxId}`);
    }
  }

  async *listOwned(): AsyncIterable<SandboxSnapshot> {
    for await (const item of this.client().list()) {
      if (!item.labels?.[DAYTONA_AGENT_ID_LABEL]) continue;
      yield snapshotFromSandbox(item);
    }
  }

  private async lifecycleAction(
    providerSandboxId: string,
    label: string,
    action: (remote: DaytonaSandboxLike) => Promise<void>,
  ): Promise<SandboxSnapshot> {
    try {
      const remote = await this.client().get(providerSandboxId);
      await action(remote);
      const refreshed = await this.client().get(providerSandboxId);
      return snapshotFromSandbox(refreshed);
    } catch (err) {
      throw wrapDaytonaError(
        err,
        `Sandbox ${providerSandboxId} lifecycle action failed (${label})`,
      );
    }
  }
}

/**
 * Apply network egress settings on a live sandbox. Create-time options
 * already carry the policy; this re-asserts it (and is the path used when a
 * policy changes on an existing VM).
 */
async function applyNetworkPolicy(
  sandbox: DaytonaSandboxLike,
  policy: SandboxPolicyBundle,
): Promise<void> {
  const options = toDaytonaNetworkOptions(policy.network);
  if (!("networkBlockAll" in options) && !("networkAllowList" in options)) {
    return;
  }
  try {
    if (typeof sandbox.updateNetworkSettings === "function") {
      await sandbox.updateNetworkSettings(options);
      return;
    }
  } catch (err) {
    log.warn("daytona: updateNetworkSettings failed", {
      sandboxId: sandbox.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  log.debug("daytona: network policy skipped (no updateNetworkSettings)", {
    sandboxId: sandbox.id,
    options,
  });
}

/** Build the real, SDK-backed Daytona provider for an API key. */
export function createDaytonaSandboxProvider(apiKey: string): DaytonaSandboxProvider {
  return new DaytonaSandboxProvider({
    createClient: (): DaytonaClientLike => new Daytona({ apiKey }),
  });
}
