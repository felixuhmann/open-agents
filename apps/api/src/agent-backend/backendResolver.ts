/**
 * Credential-keyed lazy singleton used by `instance.ts`.
 *
 * Backends are constructed from a credential that lives in the encrypted
 * Secret store, so they can only exist after setup has populated it. The
 * resolver caches one instance per credential value, rebuilds when the
 * credential rotates, and can be reset explicitly (setup / settings writes).
 *
 * The dependencies are injected so the caching contract can be tested
 * without a database.
 */
export type AgentBackendResolverDeps<T> = {
  /** Resolve the current credential; `null` means "not configured yet". */
  loadCredentialKey: () => Promise<string | null>;
  /** Build a fresh backend for the given credential. */
  build: (credentialKey: string) => T;
  /** Error message thrown when no credential is configured. */
  missingCredentialMessage: string;
};

export type AgentBackendResolver<T> = {
  get: () => Promise<T>;
  reset: () => void;
};

export function createAgentBackendResolver<T>(
  deps: AgentBackendResolverDeps<T>,
): AgentBackendResolver<T> {
  let cached: T | null = null;
  let cachedKey: string | null = null;

  return {
    async get(): Promise<T> {
      const credentialKey = await deps.loadCredentialKey();
      if (!credentialKey) {
        cached = null;
        cachedKey = null;
        throw new Error(deps.missingCredentialMessage);
      }
      if (cached !== null && cachedKey === credentialKey) {
        return cached;
      }
      cached = deps.build(credentialKey);
      cachedKey = credentialKey;
      return cached;
    },
    reset(): void {
      cached = null;
      cachedKey = null;
    },
  };
}
