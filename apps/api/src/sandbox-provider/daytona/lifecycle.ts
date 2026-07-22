import { AgentBackendError } from "../../agent-backend/types.js";
import type { SandboxSnapshot } from "../types.js";
import type { DaytonaSandboxLike } from "./client.js";

export function snapshotFromSandbox(sandbox: DaytonaSandboxLike): SandboxSnapshot {
  return {
    provider: "daytona",
    providerSandboxId: sandbox.id,
    state: sandbox.state ?? "unknown",
    lastActivityAt: sandbox.lastActivityAt ? new Date(sandbox.lastActivityAt) : null,
    errorReason: sandbox.errorReason ?? null,
    recoverable: sandbox.recoverable ?? null,
    ...(sandbox.labels?.["open-agents-agent-id"]
      ? { agentId: sandbox.labels["open-agents-agent-id"] }
      : {}),
  };
}

export type SandboxReadyTransition = "recover" | "start";

export type SandboxReadyResult = {
  sandbox: DaytonaSandboxLike;
  previousState: string;
  transitions: SandboxReadyTransition[];
};

/**
 * Ensure the sandbox is runnable: recover from error, start stopped/archived.
 */
export async function ensureDaytonaSandboxReady(
  sandbox: DaytonaSandboxLike,
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
