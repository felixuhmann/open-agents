/**
 * Provider-neutral shell/path helpers shared by every sandbox provider and
 * by the Pi runtime.
 *
 * {@link LOGICAL_WORKSPACE_DIR} is the conventional prefix used in attachment
 * mount paths, skill paths, and older prompts. The directory a sandbox
 * actually exposes is discovered at runtime (Daytona images use `/workspace`
 * or `/home/daytona`), so code that uploads files or describes paths to the
 * agent MUST translate through {@link remapWorkspacePath} first.
 */
export const LOGICAL_WORKSPACE_DIR = "/workspace";

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Sandbox images may not ship zsh; always invoke bash explicitly.
 *
 * Note: even with this wrapper, the Daytona daemon picks the shell it uses
 * to invoke the command from `/etc/shells` (preferring zsh, then bash, then
 * sh). On images that advertise zsh without shipping the binary, every
 * `executeCommand` call fails with `fork/exec /usr/bin/zsh: no such file or
 * directory` *before* our wrapper runs. For directory creation and file I/O,
 * prefer the provider's file API, which doesn't depend on a shell.
 */
export function bashCommand(command: string): string {
  return `/bin/bash -lc ${shellQuote(command)}`;
}

/**
 * Rewrite a conventional `/workspace/...` path so it lives under the
 * sandbox's real working directory. Paths that don't begin with the logical
 * workspace prefix are passed through unchanged so callers can stage things
 * outside the workspace (e.g. `/tmp/...`) when needed.
 */
export function remapWorkspacePath(input: string, workspaceDir: string): string {
  if (!input) return input;
  if (workspaceDir === LOGICAL_WORKSPACE_DIR) return input;
  if (input === LOGICAL_WORKSPACE_DIR) return workspaceDir;
  const prefix = `${LOGICAL_WORKSPACE_DIR}/`;
  if (input.startsWith(prefix)) {
    return `${workspaceDir}/${input.slice(prefix.length)}`;
  }
  return input;
}
