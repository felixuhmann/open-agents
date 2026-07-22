import { readFile } from "node:fs/promises";
import type { SandboxLimits } from "@sandbox-broker/client";
import { AgentBackendError } from "../../agent-backend/types.js";
import type { BrokerProviderConfig } from "./index.js";

/**
 * Broker deployment configuration.
 *
 * Unlike the Daytona API key — which admins rotate through the Settings UI and
 * we keep encrypted in Postgres — the broker token is infrastructure: it
 * authenticates one private service to another on a network the browser cannot
 * reach. It therefore comes from the environment or a mounted file, is never
 * written to the database, and is never returned by any route.
 */

/** The subset of `process.env` this module reads. */
export type BrokerEnv = {
  SANDBOX_BROKER_URL?: string | undefined;
  SANDBOX_BROKER_TOKEN?: string | undefined;
  SANDBOX_BROKER_TOKEN_FILE?: string | undefined;
  SANDBOX_BROKER_EXPECTED_VERSION?: string | undefined;
  SANDBOX_BROKER_CPU_CORES?: number | undefined;
  SANDBOX_BROKER_MEMORY_MIB?: number | undefined;
  SANDBOX_BROKER_PIDS?: number | undefined;
  SANDBOX_BROKER_WORKSPACE_MIB?: number | undefined;
};

/**
 * Resolve the bearer token from the environment or the mounted token file.
 *
 * An inline token wins, so a deployment can override a stale shared volume
 * without deleting it.
 */
export async function readBrokerToken(env: BrokerEnv): Promise<string> {
  const inline = env.SANDBOX_BROKER_TOKEN?.trim();
  if (inline) return inline;

  const file = env.SANDBOX_BROKER_TOKEN_FILE?.trim();
  if (!file) {
    throw new AgentBackendError(
      "SANDBOX_BROKER_URL is set but no broker credential is: provide SANDBOX_BROKER_TOKEN or SANDBOX_BROKER_TOKEN_FILE.",
    );
  }

  let contents: string;
  try {
    contents = await readFile(file, "utf8");
  } catch (err) {
    throw new AgentBackendError(
      `Cannot read SANDBOX_BROKER_TOKEN_FILE at ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const token = contents.trim();
  if (!token) {
    throw new AgentBackendError(
      `SANDBOX_BROKER_TOKEN_FILE at ${file} is empty. If the broker generates it, wait for the broker to start once.`,
    );
  }
  return token;
}

function limitsFrom(env: BrokerEnv): SandboxLimits {
  return {
    cpuCores: env.SANDBOX_BROKER_CPU_CORES ?? 2,
    memoryMiB: env.SANDBOX_BROKER_MEMORY_MIB ?? 2048,
    pids: env.SANDBOX_BROKER_PIDS ?? 512,
    workspaceMiB: env.SANDBOX_BROKER_WORKSPACE_MIB ?? 4096,
  };
}

/**
 * `null` means "this deployment has no broker", which is the normal state for
 * a Daytona install and must stay silent. A URL *with* a broken credential is
 * a misconfiguration and is reported loudly instead.
 */
export async function resolveBrokerConfig(
  env: BrokerEnv,
): Promise<BrokerProviderConfig | null> {
  const baseUrl = env.SANDBOX_BROKER_URL?.trim();
  if (!baseUrl) return null;

  const token = await readBrokerToken(env);
  const expected = env.SANDBOX_BROKER_EXPECTED_VERSION?.trim();
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token,
    limits: limitsFrom(env),
    ...(expected ? { expectedBrokerVersion: expected } : {}),
  };
}
