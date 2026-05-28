import type { SandboxLifecyclePolicy } from "@open-agents/types";

/** Default Daytona lifecycle intervals applied at sandbox creation (minutes). */
export const DEFAULT_DAYTONA_LIFECYCLE: SandboxLifecyclePolicy = {
  autoStopInterval: 15,
  autoArchiveInterval: 60 * 24 * 7,
  autoDeleteInterval: -1,
};

/** Sandboxes with no run activity for this long are candidates for reconciliation. */
export const STALE_SANDBOX_INACTIVITY_MS = 14 * 24 * 60 * 60 * 1000;

/** Orphan sandboxes (no conversation/thread link) older than this may be stopped. */
export const ORPHAN_SANDBOX_GRACE_MS = 24 * 60 * 60 * 1000;
