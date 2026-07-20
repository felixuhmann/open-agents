import type { AgentConfigSnapshot, SandboxPolicyBundle } from "@open-agents/types";
import {
  DEFAULT_SANDBOX_COMMAND_POLICY,
  DEFAULT_SANDBOX_NETWORK_POLICY,
  SandboxCommandPolicySchema,
  SandboxNetworkPolicySchema,
  parseRegexPatterns,
} from "@open-agents/types";

export {
  DEFAULT_SANDBOX_COMMAND_POLICY,
  DEFAULT_SANDBOX_NETWORK_POLICY,
  DEFAULT_SANDBOX_POLICY,
} from "@open-agents/types";

export function parseSandboxNetworkPolicy(raw: unknown) {
  if (raw == null) return { ...DEFAULT_SANDBOX_NETWORK_POLICY };
  return SandboxNetworkPolicySchema.parse(raw);
}

export function parseSandboxCommandPolicy(raw: unknown) {
  if (raw == null) return { ...DEFAULT_SANDBOX_COMMAND_POLICY };
  const parsed = SandboxCommandPolicySchema.parse(raw);
  parseRegexPatterns(parsed.denyRules, "deny rule");
  parseRegexPatterns(parsed.approvalGatePatterns, "approval gate");
  return parsed;
}

export function resolveDraftSandboxPolicy(agent: {
  sandboxNetworkPolicy: unknown;
  sandboxCommandPolicy: unknown;
}): SandboxPolicyBundle {
  return {
    network: parseSandboxNetworkPolicy(agent.sandboxNetworkPolicy),
    command: parseSandboxCommandPolicy(agent.sandboxCommandPolicy),
  };
}

export function resolvePublishedSandboxPolicy(
  snapshot: AgentConfigSnapshot,
): SandboxPolicyBundle {
  if (snapshot.runtime.sandbox) {
    return {
      network: snapshot.runtime.sandbox.network,
      command: snapshot.runtime.sandbox.command,
    };
  }
  return {
    network: { ...DEFAULT_SANDBOX_NETWORK_POLICY },
    command: { ...DEFAULT_SANDBOX_COMMAND_POLICY },
  };
}

// Network policy translation now lives in the OpenSandbox module
// (`agent-backend/opensandbox/networkPolicy.ts`, `buildNetworkPolicy`), which
// maps this bundle to an OpenSandbox `NetworkPolicy` (default-deny + allow rules).
