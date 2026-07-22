import { Daytona, type Sandbox } from "@daytona/sdk";
import { AgentBackendError } from "../agent-backend/types.js";
import {
  buildSandboxSessionId,
  parseSandboxSessionId,
} from "../sandbox-provider/sessionId.js";
import { SERVICE_KEYS, getServiceSecret } from "../secrets/service.js";

/**
 * Daytona credential access and the Daytona-flavoured session-id helpers.
 * Sandbox mechanics themselves live in `sandbox-provider/daytona/`.
 */

export const DAYTONA_PROVIDER = "daytona";
export const DAYTONA_SESSION_PREFIX = "daytona";

export type DaytonaSessionRef = {
  agentId: string;
  sandboxId: string;
};

export function buildDaytonaSessionId(agentId: string, sandboxId: string): string {
  return buildSandboxSessionId(DAYTONA_PROVIDER, agentId, sandboxId);
}

export function parseDaytonaSessionId(sessionId: string): DaytonaSessionRef {
  const ref = parseSandboxSessionId(sessionId);
  if (ref.provider !== DAYTONA_PROVIDER) {
    throw new AgentBackendError(`Invalid Daytona session id: ${sessionId}`);
  }
  return { agentId: ref.agentId, sandboxId: ref.providerSandboxId };
}

export async function getDaytonaApiKey(): Promise<string | null> {
  return getServiceSecret(SERVICE_KEYS.DAYTONA_API_KEY);
}

export async function createDaytonaClient(): Promise<Daytona> {
  const apiKey = await getDaytonaApiKey();
  if (!apiKey) {
    throw new AgentBackendError("Daytona API key is not configured");
  }
  return new Daytona({ apiKey });
}

export async function fetchDaytonaSandbox(sandboxId: string): Promise<Sandbox> {
  const daytona = await createDaytonaClient();
  return daytona.get(sandboxId);
}

export {
  ensureDaytonaSandboxReady,
  snapshotFromSandbox,
} from "../sandbox-provider/daytona/lifecycle.js";
export type {
  SandboxReadyResult,
  SandboxReadyTransition,
} from "../sandbox-provider/daytona/lifecycle.js";
