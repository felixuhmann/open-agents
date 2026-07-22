import { randomUUID } from "node:crypto";
import {
  BROKER_API_VERSION,
  WORKSPACE_ROOT,
  type Sandbox,
  type SandboxLimits,
} from "@sandbox-broker/client";
import type { SandboxPolicyBundle } from "@open-agents/types";
import { AgentBackendError } from "../../agent-backend/types.js";
import { DEFAULT_SHORT_COMMAND_TIMEOUT_SECONDS } from "../../services/sandboxLimits.js";
import { log } from "../../log.js";
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
import { createBrokerClient, type BrokerClientLike } from "./client.js";
import { runBrokerCommand, runInternalCommand } from "./exec.js";
import { filterByGlob, findCommand, makeDirCommand } from "./files.js";
import { describeBrokerFailure, wrapBrokerError } from "./errors.js";
import { assertBrokerPolicySupported, toBrokerNetworkMode } from "./policy.js";

export { BROKER_CIDR_REJECTION, toBrokerNetworkMode } from "./policy.js";
export type { BrokerClientLike } from "./client.js";

/**
 * Prefix for the `ownerRef` the broker hashes into a container label. It never
 * stores the plaintext, so this only has to be stable and non-colliding.
 */
const OWNER_REF_PREFIX = "open-agents";

/**
 * Broker v1 is deliberately narrower than Daytona: two network modes, no cold
 * storage. Reported statically so an unreachable broker still describes what
 * it *would* do; refreshed from `/v1/capabilities` on every health check.
 */
const DEFAULT_CAPABILITIES: SandboxProviderCapabilities = {
  networkModes: ["deny-all", "unrestricted"],
  archive: false,
  recover: false,
};

class BrokerSandboxHandle implements SandboxHandle {
  readonly provider = "broker" as const;
  readonly workspaceDir = WORKSPACE_ROOT;

  constructor(
    private readonly client: BrokerClientLike,
    private sandbox: Sandbox,
    private readonly restartWaitMs?: number,
  ) {}

  get providerSandboxId(): string {
    return this.sandbox.id;
  }

  get state(): string {
    return this.sandbox.state;
  }

  exec(input: SandboxExecInput): Promise<SandboxExecResult> {
    return runBrokerCommand({
      client: this.client,
      sandboxId: this.sandbox.id,
      command: input.command,
      cwd: input.cwd ?? this.workspaceDir,
      workspaceDir: this.workspaceDir,
      timeoutSeconds: input.timeoutSeconds,
      policy: input.policy,
      onOutput: input.onOutput,
      signal: input.signal,
      restartWaitMs: this.restartWaitMs,
    });
  }

  async readFile(remotePath: string): Promise<Uint8Array> {
    try {
      return await this.client.readFile(this.sandbox.id, remotePath);
    } catch (err) {
      throw wrapBrokerError(err, `Failed to read ${remotePath}`);
    }
  }

  async writeFile(remotePath: string, bytes: Uint8Array): Promise<void> {
    try {
      // The broker creates parent directories as part of its atomic write.
      await this.client.writeFile(this.sandbox.id, remotePath, bytes);
    } catch (err) {
      throw wrapBrokerError(err, `Failed to write ${remotePath}`);
    }
  }

  async makeDir(remotePath: string): Promise<void> {
    const result = await runInternalCommand({
      client: this.client,
      sandboxId: this.sandbox.id,
      command: makeDirCommand(remotePath),
      cwd: this.workspaceDir,
      timeoutSeconds: DEFAULT_SHORT_COMMAND_TIMEOUT_SECONDS,
      context: `Failed to create directory ${remotePath}`,
      restartWaitMs: this.restartWaitMs,
    });
    if (result.exitCode !== 0) {
      throw new AgentBackendError(
        `Failed to create directory ${remotePath}: ${result.stderr || `exit ${result.exitCode}`}`,
      );
    }
  }

  async searchFiles(root: string, pattern: string): Promise<SandboxSearchResult> {
    const result = await runInternalCommand({
      client: this.client,
      sandboxId: this.sandbox.id,
      command: findCommand(root),
      cwd: this.workspaceDir,
      timeoutSeconds: DEFAULT_SHORT_COMMAND_TIMEOUT_SECONDS,
      context: `Failed to search ${root}`,
      restartWaitMs: this.restartWaitMs,
    });
    return { files: filterByGlob(result.stdout, root, pattern) };
  }

  async removePath(remotePath: string, options?: RemovePathOptions): Promise<void> {
    try {
      await this.client.deleteFile(this.sandbox.id, remotePath, {
        recursive: options?.recursive ?? false,
      });
    } catch (err) {
      throw wrapBrokerError(err, `Failed to remove ${remotePath}`);
    }
  }

  /** Adopt a fresher server-side view after a lifecycle transition. */
  refresh(sandbox: Sandbox): void {
    this.sandbox = sandbox;
  }
}

function snapshotFromSandbox(sandbox: Sandbox): SandboxSnapshot {
  return {
    provider: "broker",
    providerSandboxId: sandbox.id,
    state: sandbox.state,
    lastActivityAt: new Date(sandbox.updatedAt),
    errorReason: sandbox.state === "error" ? (sandbox.message ?? "unknown") : null,
    // Broker v1 has no recover endpoint, so an errored sandbox is never
    // recoverable in place — the caller must create a new one.
    recoverable: false,
  };
}

export type BrokerSandboxProviderOptions = {
  /** Build (or return) the broker client. Injected so tests need no HTTP. */
  createClient: () => BrokerClientLike;
  /** Fixed resource shape every sandbox this deployment creates receives. */
  limits: SandboxLimits;
  /**
   * Exact broker build this deployment was pinned against. When set, a broker
   * reporting anything else fails readiness instead of being used blindly.
   */
  expectedBrokerVersion?: string;
  /**
   * How long a command waits out the sandbox restart the broker performs
   * after a cancellation. Overridable so tests need not wait a real minute.
   */
  restartWaitMs?: number;
};

/**
 * Self-hosted Docker broker implementation of the low-level sandbox contract.
 *
 * Nothing broker-specific escapes this directory: the Pi runtime only ever
 * sees a {@link SandboxHandle}.
 */
export class BrokerSandboxProvider implements SandboxProvider {
  readonly id = "broker" as const;

  #capabilities: SandboxProviderCapabilities = DEFAULT_CAPABILITIES;

  constructor(private readonly options: BrokerSandboxProviderOptions) {}

  get capabilities(): SandboxProviderCapabilities {
    return this.#capabilities;
  }

  private client(): BrokerClientLike {
    return this.options.createClient();
  }

  /**
   * Readiness, API-major agreement, and (when pinned) exact build agreement.
   * Never throws: an unavailable provider is a reportable state, not a fault.
   */
  async health(): Promise<ProviderHealth> {
    try {
      const client = this.client();
      const ready = await client.ready();

      // The pinned client already validates `apiVersion` as a literal `v1`, so
      // a broker on another major fails inside `ready()`. This second check is
      // defence in depth against that validation ever being relaxed, and is
      // typed as a string because the contract narrows it to a literal.
      const apiVersion: string = ready.apiVersion;
      if (apiVersion !== BROKER_API_VERSION) {
        return {
          available: false,
          detail: `Broker speaks API ${apiVersion}; this deployment is pinned to ${BROKER_API_VERSION}.`,
        };
      }
      const expected = this.options.expectedBrokerVersion;
      if (expected && expected !== ready.brokerVersion) {
        return {
          available: false,
          detail: `Broker reports version ${ready.brokerVersion}; this deployment is pinned to ${expected}.`,
        };
      }
      if (!ready.ready) {
        const failed = ready.checks
          .filter((check) => !check.ok)
          .map((check) =>
            check.detail ? `${check.name} (${check.detail})` : check.name,
          );
        return {
          available: false,
          detail: `Broker is not ready: ${failed.join(", ") || "no detail reported"}.`,
        };
      }

      const capabilities = await client.capabilities();
      this.#capabilities = {
        networkModes: [...capabilities.networkModes],
        archive: capabilities.archive,
        recover: capabilities.recover,
      };
      return { available: true };
    } catch (err) {
      return { available: false, detail: describeBrokerFailure(err) };
    }
  }

  validatePolicy(policy: SandboxPolicyBundle): void {
    assertBrokerPolicySupported(policy);
  }

  async create(input: SandboxCreateInput): Promise<SandboxHandle> {
    // Before any network call: a policy the broker cannot honor must never
    // reach it, or a rejected agent would still leave a sandbox behind.
    const networkMode = toBrokerNetworkMode(input.policy.network);
    const client = this.client();
    try {
      const { sandbox } = await client.createSandbox({
        idempotencyKey: randomUUID(),
        ownerRef: `${OWNER_REF_PREFIX}:${input.agentId}`,
        networkMode,
        limits: this.options.limits,
      });
      return new BrokerSandboxHandle(client, sandbox, this.options.restartWaitMs);
    } catch (err) {
      throw wrapBrokerError(err, "Failed to create broker sandbox session");
    }
  }

  async connect(providerSandboxId: string): Promise<SandboxHandle> {
    return (await this.connectWithTransitions(providerSandboxId)).handle;
  }

  /**
   * `start` returns only once the broker re-applied and verified the network
   * policy, so a started handle is always safe to exec in.
   */
  async connectWithTransitions(providerSandboxId: string): Promise<{
    handle: SandboxHandle;
    previousState: string;
    transitions: ("recover" | "start")[];
  }> {
    try {
      const client = this.client();
      let sandbox = await client.getSandbox(providerSandboxId);
      const previousState = sandbox.state;
      const transitions: ("recover" | "start")[] = [];

      if (sandbox.state === "error") {
        throw new AgentBackendError(
          `Broker sandbox ${providerSandboxId} is in error state and broker v1 cannot recover it: ${sandbox.message ?? "unknown"}`,
        );
      }
      if (sandbox.state !== "started") {
        sandbox = await client.startSandbox(providerSandboxId);
        transitions.push("start");
      }
      return {
        handle: new BrokerSandboxHandle(client, sandbox, this.options.restartWaitMs),
        previousState,
        transitions,
      };
    } catch (err) {
      throw wrapBrokerError(
        err,
        `Failed to connect to broker sandbox ${providerSandboxId}`,
      );
    }
  }

  async inspect(providerSandboxId: string): Promise<SandboxSnapshot> {
    try {
      return snapshotFromSandbox(await this.client().getSandbox(providerSandboxId));
    } catch (err) {
      throw wrapBrokerError(err, `Failed to inspect broker sandbox ${providerSandboxId}`);
    }
  }

  async start(providerSandboxId: string): Promise<SandboxSnapshot> {
    try {
      return snapshotFromSandbox(await this.client().startSandbox(providerSandboxId));
    } catch (err) {
      throw wrapBrokerError(err, `Failed to start broker sandbox ${providerSandboxId}`);
    }
  }

  async stop(providerSandboxId: string): Promise<SandboxSnapshot> {
    try {
      return snapshotFromSandbox(await this.client().stopSandbox(providerSandboxId));
    } catch (err) {
      throw wrapBrokerError(err, `Failed to stop broker sandbox ${providerSandboxId}`);
    }
  }

  async delete(providerSandboxId: string): Promise<void> {
    try {
      await this.client().deleteSandbox(providerSandboxId);
    } catch (err) {
      throw wrapBrokerError(err, `Failed to delete broker sandbox ${providerSandboxId}`);
    }
  }

  /** The broker only ever lists resources inside its own ownership namespace. */
  async *listOwned(): AsyncIterable<SandboxSnapshot> {
    let sandboxes: Sandbox[];
    try {
      sandboxes = await this.client().listSandboxes();
    } catch (err) {
      throw wrapBrokerError(err, "Failed to list broker sandboxes");
    }
    for (const sandbox of sandboxes) {
      yield snapshotFromSandbox(sandbox);
    }
  }
}

export type BrokerProviderConfig = {
  baseUrl: string;
  token: string;
  limits: SandboxLimits;
  expectedBrokerVersion?: string;
};

/** Build the real, HTTP-backed broker provider. */
export function createBrokerSandboxProvider(
  config: BrokerProviderConfig,
): BrokerSandboxProvider {
  const client = createBrokerClient({ baseUrl: config.baseUrl, token: config.token });
  log.debug("broker: provider configured", {
    baseUrl: config.baseUrl,
    limits: config.limits,
  });
  return new BrokerSandboxProvider({
    createClient: () => client,
    limits: config.limits,
    ...(config.expectedBrokerVersion
      ? { expectedBrokerVersion: config.expectedBrokerVersion }
      : {}),
  });
}

/** Absolute workspace root every broker sandbox exposes. */
export { WORKSPACE_ROOT as BROKER_WORKSPACE_ROOT };
