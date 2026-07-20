import { z } from "zod";

/** Outbound network defaults for OpenSandbox sandboxes (and draft agent config). */
export const SandboxNetworkPolicySchema = z.object({
  /** When false, outbound traffic from the sandbox is blocked (`networkBlockAll`). */
  internetEnabled: z.boolean(),
  /**
   * Comma-separated FQDN or wildcard-domain entries. Used only when
   * `internetEnabled` is true. Empty means unrestricted public egress; the
   * platform-level private/metadata deny overlay still applies.
   */
  allowList: z.string(),
  /**
   * When true and the internet is enabled, shell commands that target private,
   * link-local, or loopback addresses are rejected before execution.
   */
  protectInternalNetwork: z.boolean(),
});
export type SandboxNetworkPolicy = z.infer<typeof SandboxNetworkPolicySchema>;

/** Shell execution limits and guardrails for sandbox commands. */
export const SandboxCommandPolicySchema = z.object({
  /** Extra regex patterns (case-insensitive) evaluated before built-in deny rules. */
  denyRules: z.array(z.string().min(1).max(500)),
  /**
   * Regex patterns that require operator approval. Until approval workflow exists,
   * matching commands are blocked with an explanatory message.
   */
  approvalGatePatterns: z.array(z.string().min(1).max(500)),
  /** Default and maximum wall-clock timeout per command (seconds). */
  maxRuntimeSeconds: z.number().int().min(1).max(3600),
  /** Max combined stdout/stderr characters returned to the model per command. */
  maxOutputChars: z.number().int().min(1000).max(500_000),
  /** Hard ceiling for async session commands (seconds). */
  maxBackgroundProcessLifetimeSeconds: z.number().int().min(1).max(86_400),
});
export type SandboxCommandPolicy = z.infer<typeof SandboxCommandPolicySchema>;

export const SandboxPolicyBundleSchema = z.object({
  network: SandboxNetworkPolicySchema,
  command: SandboxCommandPolicySchema,
});
export type SandboxPolicyBundle = z.infer<typeof SandboxPolicyBundleSchema>;

export const DEFAULT_SANDBOX_NETWORK_POLICY: SandboxNetworkPolicy = {
  internetEnabled: true,
  allowList: "",
  protectInternalNetwork: true,
};

export const DEFAULT_SANDBOX_COMMAND_POLICY: SandboxCommandPolicy = {
  denyRules: [],
  approvalGatePatterns: [],
  maxRuntimeSeconds: 60,
  maxOutputChars: 20_000,
  maxBackgroundProcessLifetimeSeconds: 600,
};

export const DEFAULT_SANDBOX_POLICY: SandboxPolicyBundle = {
  network: DEFAULT_SANDBOX_NETWORK_POLICY,
  command: DEFAULT_SANDBOX_COMMAND_POLICY,
};

/** Validate regex strings admins enter in the UI. */
export function parseRegexPatterns(patterns: string[], label: string): RegExp[] {
  const compiled: RegExp[] = [];
  for (const raw of patterns) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      compiled.push(new RegExp(trimmed, "i"));
    } catch {
      throw new Error(`Invalid ${label} regex: ${trimmed}`);
    }
  }
  return compiled;
}
