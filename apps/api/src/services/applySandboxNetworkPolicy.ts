import type { Sandbox } from "@daytona/sdk";
import type { SandboxNetworkPolicy } from "@open-agents/types";
import { log } from "../log.js";
import { toDaytonaNetworkOptions } from "./sandboxPolicy.js";

/**
 * Apply network egress settings on a Daytona sandbox at create time or when
 * policy changes on an existing VM.
 */
export async function applySandboxNetworkPolicy(
  sandbox: Sandbox,
  network: SandboxNetworkPolicy,
): Promise<void> {
  const options = toDaytonaNetworkOptions(network);
  if (!("networkBlockAll" in options) && !("networkAllowList" in options)) {
    return;
  }

  try {
    if (typeof sandbox.updateNetworkSettings === "function") {
      await sandbox.updateNetworkSettings(options);
      return;
    }
  } catch (err) {
    log.warn("daytona: updateNetworkSettings failed", {
      sandboxId: sandbox.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  log.debug("daytona: network policy skipped (no updateNetworkSettings)", {
    sandboxId: sandbox.id,
    options,
  });
}
