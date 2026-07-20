import { OpenSandboxAgentBackend } from "./opensandbox.js";
import {
  getOpenSandboxRuntimeConfig,
  getOpenSandboxTransport,
} from "./opensandbox/runtime.js";
import type { AgentBackend } from "./types.js";

/**
 * Lazy AgentBackend factory. The OpenSandbox endpoint is deployment env
 * configuration (`OPENSANDBOX_BASE_URL` / `OPENSANDBOX_API_KEY`), not a
 * setup-wizard credential. `getAgentBackend()` throws a clear error when the
 * runtime is not configured yet.
 *
 * The transport is stateless apart from the endpoint config, so a single
 * backend instance is safe to share; it rebuilds when the endpoint changes.
 */

let cached: AgentBackend | null = null;
let cachedBaseUrl: string | null = null;

export function getAgentBackend(): AgentBackend {
  const runtime = getOpenSandboxRuntimeConfig();
  if (cached && cachedBaseUrl === runtime.baseUrl) {
    return cached;
  }
  cached = new OpenSandboxAgentBackend(getOpenSandboxTransport(), runtime);
  cachedBaseUrl = runtime.baseUrl;
  return cached;
}

/** Force the next `getAgentBackend()` call to rebuild the singleton. */
export function resetAgentBackend(): void {
  cached = null;
  cachedBaseUrl = null;
}
