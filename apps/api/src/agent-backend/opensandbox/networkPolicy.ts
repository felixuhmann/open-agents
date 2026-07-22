import { createHash } from "node:crypto";
import type { NetworkPolicy, NetworkRule } from "@alibaba-group/opensandbox";
import type { SandboxNetworkPolicy } from "@open-agents/types";

/**
 * Split a comma-separated allowlist into supported FQDN/wildcard targets and
 * unsupported IP/CIDR entries. The lower-level nftables component understands
 * CIDRs for static platform rules, but the per-sandbox NetworkPolicy API does not.
 */
export function parseAllowListTargets(allowList: string): {
  targets: string[];
  rejected: string[];
} {
  const targets: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const raw of allowList.split(",")) {
    const target = raw.trim();
    if (!target || seen.has(target)) continue;
    seen.add(target);
    const withoutPrefix = target.split("/")[0] ?? target;
    const isIpOrCidr =
      /^\d{1,3}(\.\d{1,3}){3}$/.test(withoutPrefix) ||
      (withoutPrefix.includes(":") && /^[0-9a-fA-F:]+$/.test(withoutPrefix));
    (isIpOrCidr ? rejected : targets).push(target);
  }
  return { targets, rejected };
}

export type BuiltNetworkPolicy = {
  policy: NetworkPolicy;
  /** Unsupported per-sandbox IP/CIDR targets. */
  rejectedEntries: string[];
};

export type NetworkPolicyUpdatePlan =
  | { kind: "noop" }
  | { kind: "recreate" }
  | { kind: "patch"; deleteTargets: string[]; addRules: NetworkRule[] };

export const NETWORK_POLICY_METADATA_KEY = "open-agents-network-policy";

export function serializeNetworkPolicy(policy: NetworkPolicy): string {
  return JSON.stringify({
    defaultAction: policy.defaultAction ?? "deny",
    egress: (policy.egress ?? []).map((rule) => ({
      action: rule.action,
      target: rule.target,
    })),
  });
}

export function fingerprintNetworkPolicy(policy: NetworkPolicy): string {
  const digest = createHash("sha256")
    .update(serializeNetworkPolicy(policy))
    .digest("hex");
  return `sha256-${digest.slice(0, 40)}`;
}

export function planNetworkPolicyFromMetadata(
  metadata: Record<string, string>,
  desired: NetworkPolicy,
): "noop" | "recreate" {
  return metadata[NETWORK_POLICY_METADATA_KEY] === fingerprintNetworkPolicy(desired)
    ? "noop"
    : "recreate";
}

export function planNetworkPolicyUpdate(
  current: NetworkPolicy,
  desired: NetworkPolicy,
): NetworkPolicyUpdatePlan {
  const currentDefault = current.defaultAction ?? "deny";
  const desiredDefault = desired.defaultAction ?? "deny";
  if (currentDefault !== desiredDefault) return { kind: "recreate" };

  const currentRules = current.egress ?? [];
  const desiredRules = desired.egress ?? [];
  const key = (rule: NetworkRule) => `${rule.action}:${rule.target}`;
  const currentKeys = new Set(currentRules.map(key));
  const desiredKeys = new Set(desiredRules.map(key));
  if (
    currentKeys.size === desiredKeys.size &&
    [...currentKeys].every((entry) => desiredKeys.has(entry))
  ) {
    return { kind: "noop" };
  }
  if (desiredDefault === "allow") return { kind: "recreate" };
  return {
    kind: "patch",
    deleteTargets: [...new Set(currentRules.map((rule) => rule.target))],
    addRules: desiredRules,
  };
}

/**
 * Translate the frozen agent network policy into an OpenSandbox egress policy.
 *
 * - internet disabled -> default deny with no allow rules;
 * - non-empty allowlist -> default deny plus each supported FQDN/wildcard rule;
 * - internet enabled without an allowlist -> default allow. Infrastructure and
 *   metadata protection for this mode is enforced by the server-side hardened
 *   egress configuration, outside guest control.
 */
export function buildNetworkPolicy(network: SandboxNetworkPolicy): BuiltNetworkPolicy {
  if (!network.internetEnabled) {
    return { policy: { defaultAction: "deny", egress: [] }, rejectedEntries: [] };
  }

  const { targets, rejected } = parseAllowListTargets(network.allowList);
  if (targets.length > 0 || rejected.length > 0) {
    const egress: NetworkRule[] = targets.map((target) => ({ action: "allow", target }));
    return { policy: { defaultAction: "deny", egress }, rejectedEntries: rejected };
  }

  return { policy: { defaultAction: "allow", egress: [] }, rejectedEntries: [] };
}
