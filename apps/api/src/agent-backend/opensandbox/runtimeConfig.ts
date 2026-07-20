export type OpenSandboxRuntimeConfig = {
  baseUrl: string;
  apiKey?: string;
  image: string;
  resourceLimits?: Record<string, string>;
};

export type OpenSandboxEnv = {
  OPENSANDBOX_BASE_URL?: string;
  OPENSANDBOX_API_KEY?: string;
  OPENSANDBOX_IMAGE: string;
  OPENSANDBOX_CPU_LIMIT?: string;
  OPENSANDBOX_MEMORY_LIMIT?: string;
};

/** True when the deployment env has the OpenSandbox endpoint configured. */
export function isOpenSandboxConfiguredIn(
  env: Pick<OpenSandboxEnv, "OPENSANDBOX_BASE_URL">,
): boolean {
  return Boolean(env.OPENSANDBOX_BASE_URL);
}

/**
 * Pure resolver: validate the OpenSandbox env config and shape it into a
 * runtime config. Throws a clear, actionable error when the endpoint is not
 * configured (mirrors the previous "complete setup" gate, for env config).
 */
export function resolveOpenSandboxRuntimeConfig(
  env: OpenSandboxEnv,
): OpenSandboxRuntimeConfig {
  const baseUrl = env.OPENSANDBOX_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "OpenSandbox is not configured. Set OPENSANDBOX_BASE_URL (and optionally OPENSANDBOX_API_KEY) to the OpenSandbox Server endpoint.",
    );
  }
  const resourceLimits: Record<string, string> = {};
  if (env.OPENSANDBOX_CPU_LIMIT) resourceLimits.cpu = env.OPENSANDBOX_CPU_LIMIT;
  if (env.OPENSANDBOX_MEMORY_LIMIT) resourceLimits.memory = env.OPENSANDBOX_MEMORY_LIMIT;
  return {
    baseUrl,
    apiKey: env.OPENSANDBOX_API_KEY,
    image: env.OPENSANDBOX_IMAGE,
    ...(Object.keys(resourceLimits).length ? { resourceLimits } : {}),
  };
}
