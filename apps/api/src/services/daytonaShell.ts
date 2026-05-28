/**
 * Conventional "logical" workspace dir used as a prefix in attachment
 * mountPaths and skill paths. The actual on-disk directory inside a Daytona
 * sandbox is discovered at runtime via {@link resolveSandboxWorkspaceDir}
 * because different sandbox images use different WORKDIRs (e.g. `/workspace`,
 * `/home/daytona`). Code that uploads files or builds prompts MUST translate
 * `/workspace/...` to the resolved workspace dir before talking to the
 * Daytona Files API or describing paths to the agent.
 */
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

/** Minimal subset of `Sandbox` we use to discover the working directory. */
export type DaytonaSandboxInfo = {
  id?: string;
  getWorkDir?(): Promise<string | undefined>;
  getUserHomeDir?(): Promise<string | undefined>;
};

const workspaceDirCache = new Map<string, string>();

/**
 * Discover the absolute path of the sandbox's working directory. Different
 * Daytona images use different WORKDIRs (e.g. the TS sandbox image's WORKDIR
 * can be `/home/daytona` rather than `/workspace`), and writing to a missing
 * `/workspace/...` from the Files API fails with
 *
 *   mkdir /workspace/.../foo: mkdir /workspace: permission denied
 *
 * because `os.MkdirAll` walks up to `/` and the daemon user can't create
 * directories there. We prefer `getWorkDir()` (mirrors the daemon's CWD),
 * fall back to `getUserHomeDir()`, and finally to {@link DAYTONA_WORKSPACE_DIR}.
 * The result is memoized by sandbox id so we only round-trip once per session.
 */
export async function resolveSandboxWorkspaceDir(
  sandbox: DaytonaSandboxInfo,
): Promise<string> {
  const key = sandbox.id ?? "";
  if (key) {
    const cached = workspaceDirCache.get(key);
    if (cached) return cached;
  }

  let resolved: string | undefined;
  try {
    const raw = await sandbox.getWorkDir?.();
    resolved = raw && raw.length > 0 ? raw : undefined;
  } catch {
    resolved = undefined;
  }
  if (!resolved) {
    try {
      const raw = await sandbox.getUserHomeDir?.();
      resolved = raw && raw.length > 0 ? raw : undefined;
    } catch {
      resolved = undefined;
    }
  }
  const final = stripTrailingSlash(resolved ?? DAYTONA_WORKSPACE_DIR);

  if (key) workspaceDirCache.set(key, final);
  return final;
}

function stripTrailingSlash(p: string): string {
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
}

/**
 * Rewrite a conventional `/workspace/...` path so it lives under the
 * sandbox's real working directory. Paths that don't begin with the logical
 * workspace prefix are passed through unchanged so callers can stage things
 * outside the workspace (e.g. `/tmp/...`) when needed.
 */
export function remapWorkspacePath(input: string, workspaceDir: string): string {
  if (!input) return input;
  if (workspaceDir === DAYTONA_WORKSPACE_DIR) return input;
  if (input === DAYTONA_WORKSPACE_DIR) return workspaceDir;
  const prefix = `${DAYTONA_WORKSPACE_DIR}/`;
  if (input.startsWith(prefix)) {
    return `${workspaceDir}/${input.slice(prefix.length)}`;
  }
  return input;
}

/**
 * Idempotently create a directory tree in the sandbox using the Daytona
 * Files API. We iterate parent → child and swallow per-segment errors so
 * "already exists" responses don't abort the walk. This avoids
 * `process.executeCommand` entirely so sandbox images without a working
 * shell (zsh/bash) can still mount skills and attachments.
 *
 * The caller is responsible for translating any conventional `/workspace`
 * prefix to the actual working directory via {@link remapWorkspacePath}.
 * Passing a path the daemon user can't create at the root (e.g. `/workspace`
 * when the sandbox WORKDIR is `/home/daytona`) will silently no-op and the
 * follow-up `uploadFile` will surface the real `permission denied`.
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
      // Parent may already exist or the daemon may reject re-creation; the
      // terminal upload will surface a real error if the leaf was never made.
    }
  }
}
