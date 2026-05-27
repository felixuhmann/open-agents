/** Default working directory for TypeScript Daytona sandboxes. */
export const DAYTONA_WORKSPACE_DIR = "/workspace";

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * TypeScript sandboxes may not ship zsh; always invoke bash explicitly.
 *
 * Note: even with this wrapper, the Daytona daemon picks the shell it uses
 * to invoke the command from `/etc/shells` (preferring zsh, then bash, then
 * sh — see `apps/daemon/pkg/common/get_shell.go` in `daytonaio/daytona`).
 * On sandbox images that advertise zsh in `/etc/shells` but don't actually
 * have the binary installed, every `executeCommand` call fails with
 * `fork/exec /usr/bin/zsh: no such file or directory` *before* our wrapper
 * runs. For directory creation and file I/O, prefer the FileSystem helpers
 * below; they hit the Daytona Files API directly and don't depend on a shell.
 */
export function bashCommand(command: string): string {
  return `/bin/bash -lc ${shellQuote(command)}`;
}

export type DaytonaSandboxFs = {
  createFolder(path: string, mode: string): Promise<unknown>;
};

/**
 * Idempotently create a directory tree in the sandbox using the Daytona
 * Files API. We iterate parent → child and swallow per-segment errors so
 * "already exists" responses (e.g. for `/workspace`, which is pre-created)
 * don't abort the walk. This avoids `process.executeCommand` entirely so
 * that sandbox images without a working shell (zsh/bash) can still mount
 * skills and attachments.
 */
export async function ensureSandboxDir(
  fs: DaytonaSandboxFs,
  remoteDir: string,
): Promise<void> {
  if (!remoteDir || remoteDir === "." || remoteDir === "/") return;
  const isAbsolute = remoteDir.startsWith("/");
  const segments = remoteDir.split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : isAbsolute ? `/${segment}` : segment;
    try {
      await fs.createFolder(current, "755");
    } catch {
      // Parent may already exist (e.g. /workspace) or the daemon may reject
      // re-creation. The terminal upload will surface a real error if the
      // leaf directory was never created.
    }
  }
}
