import type { SandboxNetworkPolicy, SandboxPolicyBundle } from "@open-agents/types";
import { AgentBackendError } from "../../agent-backend/types.js";

/**
 * Agent network policy → broker v1 network mode.
 *
 * The broker deliberately supports exactly two modes and no allowlists. A
 * policy it cannot honor is rejected rather than approximated, because every
 * available approximation of a CIDR allowlist is *wider* than what the admin
 * asked for.
 */

export type BrokerNetworkMode = "deny-all" | "unrestricted";

/** The broker's own two modes; `cidr-allowlist` is intentionally absent. */
export const BROKER_NETWORK_MODES = ["deny-all", "unrestricted"] as const;

export const BROKER_CIDR_REJECTION =
  "Broker v1 does not support CIDR allowlists; clear the allowlist or select Daytona";

export function toBrokerNetworkMode(network: SandboxNetworkPolicy): BrokerNetworkMode {
  // Checked first: with the internet off there is nothing an allowlist could
  // widen, and deny-all is strictly narrower than the admin's intent.
  if (!network.internetEnabled) return "deny-all";
  if (network.allowList.trim()) throw new AgentBackendError(BROKER_CIDR_REJECTION);
  return "unrestricted";
}

/** Throws when the broker cannot honor `policy` exactly. */
export function assertBrokerPolicySupported(policy: SandboxPolicyBundle): void {
  toBrokerNetworkMode(policy.network);
}

/**
 * The network policy the shell guardrails see in broker mode.
 *
 * The broker's nftables rules block private, loopback, link-local, metadata,
 * and host addresses unconditionally, so a historical draft that turned
 * `protectInternalNetwork` off does not get a looser command check than the
 * network layer already enforces.
 */
export function brokerEnforcedNetworkPolicy(
  network: SandboxNetworkPolicy | undefined,
): SandboxNetworkPolicy | undefined {
  if (!network) return undefined;
  if (network.protectInternalNetwork) return network;
  return { ...network, protectInternalNetwork: true };
}
