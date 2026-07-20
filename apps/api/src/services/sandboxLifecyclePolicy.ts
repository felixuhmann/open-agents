import type { SandboxLifecyclePolicy } from "@open-agents/types";

/**
 * Default lifecycle policy stored on each `AgentSandbox` row. OpenSandbox has
 * pause/resume but no non-destructive provider TTL. The application reconcile
 * job enforces `autoStopInterval`; cold archive and automatic delete are disabled.
 */
export const DEFAULT_SANDBOX_LIFECYCLE: SandboxLifecyclePolicy = {
  autoStopInterval: 15,
  autoArchiveInterval: -1,
  autoDeleteInterval: -1,
};

export function isPastAutoStopInterval(
  lastActivityAt: Date,
  now: Date,
  policy: SandboxLifecyclePolicy,
): boolean {
  if (policy.autoStopInterval < 0) return false;
  return lastActivityAt.getTime() <= now.getTime() - policy.autoStopInterval * 60_000;
}

/** Orphan sandboxes (no conversation/thread link) older than this may be stopped. */
export const ORPHAN_SANDBOX_GRACE_MS = 24 * 60 * 60 * 1000;
