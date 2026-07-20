import { posix as path } from "node:path";
import { AgentBackendError } from "../types.js";
import { SANDBOX_WORKSPACE_DIR } from "./session.js";

export { SANDBOX_WORKSPACE_DIR } from "./session.js";

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Wrap a command so it always runs under bash with a login shell, regardless of
 * the guest's default shell. Mirrors the previous provider's behavior.
 */
export function bashCommand(command: string): string {
  return `/bin/bash -lc ${shellQuote(command)}`;
}

/**
 * Resolve a model-supplied path. Absolute paths are honored as-is (agents may
 * legitimately touch `/tmp`); relative paths are joined onto the workspace.
 * Both are normalized so `.`/`..` segments collapse.
 */
export function resolveSandboxPath(
  input: string,
  workspaceDir: string = SANDBOX_WORKSPACE_DIR,
): string {
  const absolute = input.startsWith("/") ? input : path.join(workspaceDir, input);
  return path.normalize(absolute);
}

/**
 * Resolve a path that MUST stay inside the workspace. Used for host-controlled
 * inputs (attachment mount paths, skill unpack paths, run-file downloads) so a
 * crafted filename or `..` segment cannot read or clobber files outside the
 * agent's workspace. Throws {@link AgentBackendError} on any escape.
 */
export function confineToWorkspace(
  input: string,
  workspaceDir: string = SANDBOX_WORKSPACE_DIR,
): string {
  const root = path.normalize(workspaceDir);
  const resolved = resolveSandboxPath(input, root);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new AgentBackendError(`Path escapes the sandbox workspace: ${input}`);
  }
  return resolved;
}

/** Minimal filesystem surface needed to create a directory tree in the guest. */
export type SandboxDirMaker = {
  mkdirp(remoteDir: string): Promise<void>;
};

/**
 * Idempotently create a directory tree in the guest. OpenSandbox's
 * `createDirectories` creates parents, so a single call suffices; errors are
 * swallowed because a follow-up write will surface any real failure.
 */
export async function ensureSandboxDir(
  fs: SandboxDirMaker,
  remoteDir: string,
): Promise<void> {
  if (!remoteDir || remoteDir === "." || remoteDir === "/") return;
  try {
    await fs.mkdirp(remoteDir);
  } catch {
    // Directory may already exist; the terminal write surfaces real errors.
  }
}
