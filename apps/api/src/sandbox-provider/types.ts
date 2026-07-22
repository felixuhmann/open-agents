import type { SandboxPolicyBundle } from "@open-agents/types";

/**
 * Low-level, provider-neutral sandbox contract.
 *
 * This layer owns sandbox *mechanics* only — create/connect/exec/files/
 * lifecycle. It knows nothing about Pi, models, tools, prompts, or run
 * events; that all lives in the shared agent runtime
 * (`agent-backend/pi.ts`), which consumes a {@link SandboxHandle}.
 */

export const SANDBOX_PROVIDER_IDS = ["daytona", "broker"] as const;
export type SandboxProviderId = (typeof SANDBOX_PROVIDER_IDS)[number];

export function isSandboxProviderId(value: unknown): value is SandboxProviderId {
  return (
    typeof value === "string" &&
    (SANDBOX_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

/** Egress shapes a provider can enforce. */
export type SandboxNetworkMode = "deny-all" | "unrestricted" | "cidr-allowlist";

export type SandboxProviderCapabilities = {
  networkModes: readonly SandboxNetworkMode[];
  /** Provider can archive a stopped sandbox to cold storage. */
  archive: boolean;
  /** Provider can recover a sandbox from an error state. */
  recover: boolean;
};

export type ProviderHealth = {
  available: boolean;
  /** Human-readable reason shown in Settings when `available` is false. */
  detail?: string;
};

/** Normalized provider-side view of one sandbox. */
export type SandboxSnapshot = {
  provider: SandboxProviderId;
  providerSandboxId: string;
  state: string;
  lastActivityAt: Date | null;
  errorReason: string | null;
  recoverable: boolean | null;
  /** Owning agent, when the provider records it (labels/metadata). */
  agentId?: string;
};

export type SandboxCommandStream = "stdout" | "stderr";

export type SandboxCommandOutputChunk = {
  stream: SandboxCommandStream;
  text: string;
};

export type SandboxExecInput = {
  command: string;
  /** Absolute directory to run in. Defaults to the handle's workspace dir. */
  cwd?: string;
  timeoutSeconds?: number;
  /** Command/network policy enforced before and while running. */
  policy?: SandboxPolicyBundle;
  onOutput?: (chunk: SandboxCommandOutputChunk) => void;
};

export type SandboxExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
  truncated: boolean;
  /** Set when the deployment's shell policy refused to run the command. */
  policyBlocked?: string;
};

export type SandboxSearchResult = {
  files: string[];
};

export type RemovePathOptions = {
  recursive?: boolean;
};

/**
 * A live connection to one sandbox. Paths are absolute inside the sandbox;
 * callers resolve relative paths against {@link SandboxHandle.workspaceDir}.
 */
export interface SandboxHandle {
  provider: SandboxProviderId;
  providerSandboxId: string;
  /** Absolute working directory the provider actually gave us. */
  workspaceDir: string;
  state: string;
  exec(input: SandboxExecInput): Promise<SandboxExecResult>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** Idempotently create a directory tree. */
  makeDir(path: string): Promise<void>;
  /** Glob for files beneath `root`. */
  searchFiles(root: string, pattern: string): Promise<SandboxSearchResult>;
  removePath(path: string, options?: RemovePathOptions): Promise<void>;
}

export type SandboxCreateInput = {
  agentId: string;
  agentSlug?: string;
  policy: SandboxPolicyBundle;
  /** Provider-side lifecycle hints (auto-stop/archive/delete minutes). */
  lifecycle?: {
    autoStopInterval: number;
    autoArchiveInterval: number;
    autoDeleteInterval: number;
  };
  labels?: Record<string, string>;
};

export interface SandboxProvider {
  id: SandboxProviderId;
  capabilities: SandboxProviderCapabilities;
  health(): Promise<ProviderHealth>;
  /**
   * Reject a policy this provider cannot honor. Must fail closed rather than
   * silently widening access.
   */
  validatePolicy(policy: SandboxPolicyBundle): void;
  create(input: SandboxCreateInput): Promise<SandboxHandle>;
  connect(providerSandboxId: string): Promise<SandboxHandle>;
  inspect(providerSandboxId: string): Promise<SandboxSnapshot>;
  start(providerSandboxId: string): Promise<SandboxSnapshot>;
  stop(providerSandboxId: string): Promise<SandboxSnapshot>;
  archive?(providerSandboxId: string): Promise<SandboxSnapshot>;
  recover?(providerSandboxId: string): Promise<SandboxSnapshot>;
  delete(providerSandboxId: string): Promise<void>;
  listOwned(): AsyncIterable<SandboxSnapshot>;
}
