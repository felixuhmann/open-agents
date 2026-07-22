import type { NetworkPolicy } from "@alibaba-group/opensandbox";
import type { SandboxNetworkPolicy } from "@open-agents/types";
import { AgentBackendError } from "../types.js";
import {
  buildNetworkPolicy,
  fingerprintNetworkPolicy,
  NETWORK_POLICY_METADATA_KEY,
} from "./networkPolicy.js";
import { SANDBOX_WORKSPACE_DIR } from "./session.js";

/** Keep the guest alive so we can exec into it for the session lifetime. */
export const KEEP_ALIVE_ENTRYPOINT = ["tail", "-f", "/dev/null"];

export type BuildCreateSpecInput = {
  agentId: string;
  agentSlug?: string;
  /** Pinned guest OCI image (from OPENSANDBOX_IMAGE). */
  image: string;
  networkPolicy: SandboxNetworkPolicy;
  /** Optional container resource limits (cpu/memory). Omitted → server defaults. */
  resourceLimits?: Record<string, string>;
  env?: Record<string, string>;
};

/**
 * Normalized sandbox creation specification. The transport maps this onto the
 * SDK's `SandboxCreateOptions`; keeping it as our own shape lets us unit-test
 * the mapping (image/resources/metadata/timeout/network policy) without the SDK.
 */
export type CreateSandboxSpec = {
  image: string;
  entrypoint: string[];
  workingDir: string;
  env: Record<string, string>;
  metadata: Record<string, string>;
  networkPolicy: NetworkPolicy;
  resource?: Record<string, string>;
  /** No provider TTL: idle policy pauses the sandbox without deleting files. */
  timeoutSeconds: null;
  /** Persisted targets rejected by the transport mapper (normally empty). */
  rejectedNetworkEntries: string[];
};

export function buildCreateSpec(input: BuildCreateSpecInput): CreateSandboxSpec {
  const { policy, rejectedEntries } = buildNetworkPolicy(input.networkPolicy);
  if (rejectedEntries.length > 0) {
    throw new AgentBackendError(
      `OpenSandbox does not support IP/CIDR egress targets in per-sandbox policies: ${rejectedEntries.join(", ")}. Replace them with FQDN or wildcard-domain entries.`,
    );
  }
  return {
    image: input.image,
    entrypoint: [...KEEP_ALIVE_ENTRYPOINT],
    workingDir: SANDBOX_WORKSPACE_DIR,
    env: input.env ?? {},
    metadata: {
      "open-agents-agent-id": input.agentId,
      "open-agents-agent-slug": input.agentSlug ?? "",
      [NETWORK_POLICY_METADATA_KEY]: fingerprintNetworkPolicy(policy),
    },
    networkPolicy: policy,
    ...(input.resourceLimits ? { resource: input.resourceLimits } : {}),
    timeoutSeconds: null,
    rejectedNetworkEntries: rejectedEntries,
  };
}
