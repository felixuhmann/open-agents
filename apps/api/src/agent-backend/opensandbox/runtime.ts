import { config } from "../../config.js";
import {
  isOpenSandboxConfiguredIn,
  resolveOpenSandboxRuntimeConfig,
  type OpenSandboxRuntimeConfig,
} from "./runtimeConfig.js";
import { SdkOpenSandboxTransport, type OpenSandboxTransport } from "./transport.js";

export type { OpenSandboxRuntimeConfig } from "./runtimeConfig.js";
export { resolveOpenSandboxRuntimeConfig } from "./runtimeConfig.js";

/** True when the deployment env has the OpenSandbox endpoint configured. */
export function isOpenSandboxConfigured(): boolean {
  return isOpenSandboxConfiguredIn(config);
}

/** Resolve the OpenSandbox runtime config from deployment env. */
export function getOpenSandboxRuntimeConfig(): OpenSandboxRuntimeConfig {
  return resolveOpenSandboxRuntimeConfig(config);
}

let cachedTransport: OpenSandboxTransport | null = null;
let cachedBaseUrl: string | null = null;
let injectedTransport: OpenSandboxTransport | null = null;

/**
 * Shared transport accessor used by the backend adapter and the admin sandbox
 * service. Rebuilds when the endpoint changes; tests inject a fake.
 */
export function getOpenSandboxTransport(): OpenSandboxTransport {
  if (injectedTransport) return injectedTransport;
  const runtime = getOpenSandboxRuntimeConfig();
  if (cachedTransport && cachedBaseUrl === runtime.baseUrl) return cachedTransport;
  cachedTransport = new SdkOpenSandboxTransport({
    baseUrl: runtime.baseUrl,
    apiKey: runtime.apiKey,
  });
  cachedBaseUrl = runtime.baseUrl;
  return cachedTransport;
}

/** Test hook: inject a fake transport (pass null to clear). */
export function setOpenSandboxTransportForTesting(
  transport: OpenSandboxTransport | null,
): void {
  injectedTransport = transport;
  cachedTransport = null;
  cachedBaseUrl = null;
}
