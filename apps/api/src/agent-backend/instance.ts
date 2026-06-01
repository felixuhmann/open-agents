import { getServiceSecret, SERVICE_KEYS } from "../secrets/service.js";
import { DaytonaAgentBackend } from "./daytona.js";
import type { AgentBackend } from "./types.js";

/**
 * Lazy AgentBackend factory. The Daytona API key lives in the encrypted
 * Secret store, so the backend can only be constructed after setup has
 * populated it. Callers go through `getAgentBackend()` and get an error if
 * the deployment isn't configured yet.
 *
 * The underlying SDK client is stateless apart from the API key, so a single
 * instance is safe to share. We rebuild it after credential rotation.
 */

let cached: AgentBackend | null = null;
let cachedDaytonaApiKey: string | null = null;

export async function getAgentBackend(): Promise<AgentBackend> {
  const daytonaApiKey = await getServiceSecret(SERVICE_KEYS.DAYTONA_API_KEY);
  if (!daytonaApiKey) {
    throw new Error("Daytona API key is not configured. Complete setup at /setup.");
  }

  if (cached && cachedDaytonaApiKey === daytonaApiKey) {
    return cached;
  }

  cached = new DaytonaAgentBackend(daytonaApiKey);
  cachedDaytonaApiKey = daytonaApiKey;
  return cached;
}

/** Force the next `getAgentBackend()` call to rebuild the singleton. */
export function resetAgentBackend(): void {
  cached = null;
  cachedDaytonaApiKey = null;
}
