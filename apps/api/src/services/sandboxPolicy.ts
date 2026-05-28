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

export type DaytonaNetworkCreateOptions = {
  networkBlockAll?: boolean;
  networkAllowList?: string;
};

/**
 * Map agent network policy to Daytona sandbox create/update parameters.
 */
export function toDaytonaNetworkOptions(
  network: SandboxPolicyBundle["network"],
): DaytonaNetworkCreateOptions {
  if (!network.internetEnabled) {
    return { networkBlockAll: true };
  }
  const allowList = network.allowList.trim();
  if (allowList) {
    return { networkAllowList: allowList };
  }
  return {};
}
