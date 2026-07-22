import type { SkillMaterializationManifest } from "@open-agents/types";
import { tryParseSandboxSessionId } from "../sandbox-provider/sessionId.js";
import type { SandboxProviderId } from "../sandbox-provider/types.js";

/**
 * What a run's session resolution tells the caller, and therefore what
 * `run.started` records. Kept free of database imports so the resumed-session
 * projection can be exercised on its own.
 */
export type ResolvedSession = {
  sessionId: string;
  skillsManifest?: SkillMaterializationManifest;
  /** Set when a new sandbox was created for this run. */
  sandboxCreated?: boolean;
  /** Provider that owns this session's sandbox. */
  provider?: SandboxProviderId;
  providerSandboxId?: string;
  workspaceDir?: string;
};

/**
 * Describe a session that already exists, from the session id alone.
 *
 * A resumed run's `run.started` has to name the provider it actually runs
 * on, not the one that happens to be selected deployment-wide: after a
 * switch most runs resume sessions on the *previous* provider, and a trace
 * that claims otherwise is worse than no trace. The session id records the
 * provider and sandbox authoritatively, so this costs no round trip.
 *
 * `workspaceDir` is only known once something connects, so it is passed in
 * from a mount when the run had resources to materialize and left out
 * otherwise — connecting purely to log a path is not worth a provider call,
 * and the sandbox lifecycle events emitted during the run carry it anyway.
 */
export function describeResumedSession(
  sessionId: string,
  workspaceDir?: string,
): ResolvedSession {
  const ref = tryParseSandboxSessionId(sessionId);
  return {
    sessionId,
    sandboxCreated: false,
    ...(ref ? { provider: ref.provider, providerSandboxId: ref.providerSandboxId } : {}),
    ...(workspaceDir ? { workspaceDir } : {}),
  };
}
