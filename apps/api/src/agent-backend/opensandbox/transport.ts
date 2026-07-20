import {
  ConnectionConfig,
  Sandbox,
  SandboxManager,
  type NetworkRule,
  type NetworkPolicy,
  type SandboxInfo,
} from "@alibaba-group/opensandbox";

import type { CreateSandboxSpec } from "./createSpec.js";
import type { ExecCommandsHandle } from "./exec.js";
import { planConnectAction } from "./lifecycle.js";
import { mapOpenSandboxState, type CanonicalSandboxState } from "./session.js";

/** Filesystem surface our services need from a connected sandbox. */
export type SandboxFsHandle = {
  writeFile(remotePath: string, data: Buffer | Uint8Array | string): Promise<void>;
  readBytes(remotePath: string): Promise<Uint8Array>;
  mkdirp(remoteDir: string): Promise<void>;
  search(root: string, pattern: string): Promise<Array<{ path: string }>>;
};

/** A connected sandbox: exec + files + per-instance lifecycle controls. */
export type SandboxHandle = {
  readonly id: string;
  readonly fs: SandboxFsHandle;
  readonly commands: ExecCommandsHandle;
  pause(): Promise<void>;
  kill(): Promise<void>;
  getNetworkPolicy(): Promise<NetworkPolicy>;
  patchEgressRules(rules: NetworkRule[]): Promise<void>;
  deleteEgressRules(targets: string[]): Promise<void>;
  close(): Promise<void>;
};

/** Normalized snapshot of provider-side sandbox state. */
export type SandboxInfoSnapshot = {
  id: string;
  state: CanonicalSandboxState;
  rawState: string;
  errorReason: string | null;
  expiresAt: Date | null;
  createdAt: Date | null;
  metadata: Record<string, string>;
};

export type ConnectResult = {
  handle: SandboxHandle;
  previousState: CanonicalSandboxState;
  /** True when the sandbox had to be resumed from a paused state to connect. */
  resumed: boolean;
};

/**
 * Injectable transport abstraction over the OpenSandbox SDK. The adapter and
 * the admin sandbox service depend on this interface, not the SDK directly, so
 * provider behavior can be exercised with an in-memory fake (no Kata host).
 */
export type OpenSandboxTransport = {
  create(
    spec: CreateSandboxSpec,
  ): Promise<{ handle: SandboxHandle; info: SandboxInfoSnapshot }>;
  connect(sandboxId: string): Promise<ConnectResult>;
  getInfo(sandboxId: string): Promise<SandboxInfoSnapshot>;
  listWithLabel(labelKey: string): Promise<SandboxInfoSnapshot[]>;
  pause(sandboxId: string): Promise<void>;
  resume(sandboxId: string): Promise<void>;
  kill(sandboxId: string): Promise<void>;
};

function toSnapshot(info: SandboxInfo): SandboxInfoSnapshot {
  const rawState = info.status?.state ?? "unknown";
  const reason = info.status?.reason ?? info.status?.message ?? null;
  return {
    id: info.id,
    state: mapOpenSandboxState(rawState),
    rawState,
    errorReason: mapOpenSandboxState(rawState) === "error" ? reason : null,
    expiresAt: info.expiresAt ?? null,
    createdAt: info.createdAt ?? null,
    metadata: info.metadata ?? {},
  };
}

function wrapSandbox(sandbox: Sandbox): SandboxHandle {
  const fs: SandboxFsHandle = {
    async writeFile(remotePath, data) {
      await sandbox.files.writeFiles([{ path: remotePath, data }]);
    },
    async readBytes(remotePath) {
      return sandbox.files.readBytes(remotePath);
    },
    async mkdirp(remoteDir) {
      await sandbox.files.createDirectories([{ path: remoteDir }]);
    },
    async search(root, pattern) {
      const found = await sandbox.files.search({ path: root, pattern });
      return found.map((entry) => ({ path: entry.path }));
    },
  };
  const commands: ExecCommandsHandle = {
    id: sandbox.id,
    createSession(workingDirectory) {
      return sandbox.commands.createSession({ workingDirectory });
    },
    runInSession(sessionId, command, options, handlers, signal) {
      return sandbox.commands.runInSession(sessionId, command, options, handlers, signal);
    },
    interrupt(sessionId) {
      return sandbox.commands.interrupt(sessionId);
    },
  };
  return {
    id: sandbox.id,
    fs,
    commands,
    pause: () => sandbox.pause(),
    kill: () => sandbox.kill(),
    getNetworkPolicy: () => sandbox.getEgressPolicy(),
    patchEgressRules: (rules) => sandbox.patchEgressRules(rules),
    deleteEgressRules: (targets) => sandbox.deleteEgressRules(targets),
    close: () => sandbox.close(),
  };
}

export type SdkTransportOptions = {
  baseUrl: string;
  apiKey?: string;
  requestTimeoutSeconds?: number;
};

/** Production transport: delegates to the installed OpenSandbox SDK. */
export class SdkOpenSandboxTransport implements OpenSandboxTransport {
  private readonly connectionConfig: ConnectionConfig;
  private readonly manager: SandboxManager;

  constructor(opts: SdkTransportOptions) {
    this.connectionConfig = new ConnectionConfig({
      domain: opts.baseUrl,
      apiKey: opts.apiKey,
      useServerProxy: true,
      ...(opts.requestTimeoutSeconds
        ? { requestTimeoutSeconds: opts.requestTimeoutSeconds }
        : {}),
    });
    this.manager = SandboxManager.create({ connectionConfig: this.connectionConfig });
  }

  async create(spec: CreateSandboxSpec) {
    const sandbox = await Sandbox.create({
      connectionConfig: this.connectionConfig,
      image: spec.image,
      entrypoint: spec.entrypoint,
      env: spec.env,
      metadata: spec.metadata,
      networkPolicy: spec.networkPolicy,
      timeoutSeconds: spec.timeoutSeconds,
      ...(spec.resource ? { resource: spec.resource } : {}),
    });
    const info = await sandbox.getInfo();
    return { handle: wrapSandbox(sandbox), info: toSnapshot(info) };
  }

  async connect(sandboxId: string): Promise<ConnectResult> {
    const info = await this.manager.getSandboxInfo(sandboxId);
    const previousState = mapOpenSandboxState(info.status?.state);
    const action = planConnectAction(previousState);
    if (action === "error") {
      throw new Error(
        `Sandbox ${sandboxId} is not connectable (state ${info.status?.state ?? "unknown"}): ${info.status?.reason ?? ""}`.trim(),
      );
    }
    if (action === "resume") {
      const sandbox = await Sandbox.resume({
        connectionConfig: this.connectionConfig,
        sandboxId,
      });
      return { handle: wrapSandbox(sandbox), previousState, resumed: true };
    }
    const sandbox = await Sandbox.connect({
      connectionConfig: this.connectionConfig,
      sandboxId,
    });
    return { handle: wrapSandbox(sandbox), previousState, resumed: false };
  }

  async getInfo(sandboxId: string): Promise<SandboxInfoSnapshot> {
    return toSnapshot(await this.manager.getSandboxInfo(sandboxId));
  }

  async listWithLabel(labelKey: string): Promise<SandboxInfoSnapshot[]> {
    const out: SandboxInfoSnapshot[] = [];
    let page = 1;
    // Paginate defensively; the control plane caps page size server-side.
    for (; page <= 100; page += 1) {
      const res = await this.manager.listSandboxInfos({ page, pageSize: 100 });
      for (const item of res.items) {
        if (item.metadata && labelKey in item.metadata) out.push(toSnapshot(item));
      }
      if (!res.pagination?.hasNextPage) break;
    }
    return out;
  }

  async pause(sandboxId: string): Promise<void> {
    await this.manager.pauseSandbox(sandboxId);
  }

  async resume(sandboxId: string): Promise<void> {
    await this.manager.resumeSandbox(sandboxId);
  }

  async kill(sandboxId: string): Promise<void> {
    await this.manager.killSandbox(sandboxId);
  }
}
