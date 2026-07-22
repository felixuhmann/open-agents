import { Daytona, type Sandbox } from "@daytona/sdk";
import { wrapDaytonaError } from "../agent-backend/daytonaErrors.js";
import { AgentBackendError } from "../agent-backend/types.js";
import {
  buildSandboxSessionId,
  parseSandboxSessionId,
} from "../sandbox-provider/sessionId.js";
import { SERVICE_KEYS, getServiceSecret } from "../secrets/service.js";

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

export type DaytonaSandboxSnapshot = {
  state: string;
  lastActivityAt: Date | null;
  errorReason: string | null;
  recoverable: boolean | null;
};

export function snapshotFromSandbox(sandbox: Sandbox): DaytonaSandboxSnapshot {
  const lastActivityAt = sandbox.lastActivityAt ? new Date(sandbox.lastActivityAt) : null;
  return {
    state: sandbox.state ?? "unknown",
    lastActivityAt,
    errorReason: sandbox.errorReason ?? null,
    recoverable: sandbox.recoverable ?? null,
  };
}

export type SandboxReadyTransition = "recover" | "start";

export type SandboxReadyResult = {
  sandbox: Sandbox;
  previousState: string;
  transitions: SandboxReadyTransition[];
};

/**
 * Ensure the sandbox is runnable: recover from error, start stopped/archived.
 */
export async function ensureDaytonaSandboxReady(
  sandbox: Sandbox,
  timeoutSeconds = 90,
): Promise<SandboxReadyResult> {
  const previousState = sandbox.state ?? "unknown";
  const transitions: SandboxReadyTransition[] = [];

  if (sandbox.state === "error") {
    if (sandbox.recoverable) {
      await sandbox.recover(timeoutSeconds);
      transitions.push("recover");
    } else {
      throw new AgentBackendError(
        `Daytona sandbox is in error state and not recoverable: ${sandbox.errorReason ?? "unknown"}`,
      );
    }
  }
  if (sandbox.state !== "started") {
    await sandbox.start(timeoutSeconds);
    transitions.push("start");
  }
  await sandbox.refreshActivity();
  return { sandbox, previousState, transitions };
}

export async function withDaytonaSandbox<T>(
  sessionId: string,
  fn: (sandbox: Sandbox) => Promise<T>,
): Promise<T> {
  try {
    const session = parseDaytonaSessionId(sessionId);
    const sandbox = await fetchDaytonaSandbox(session.sandboxId);
    const { sandbox: ready } = await ensureDaytonaSandboxReady(sandbox);
    return await fn(ready);
  } catch (err) {
    throw wrapDaytonaError(err, "Daytona sandbox operation failed");
  }
}
