import type { DaytonaFsLike, DaytonaSandboxLike } from "./client.js";
import { LOGICAL_WORKSPACE_DIR } from "../../services/sandboxShell.js";

/**
 * Daytona Files API helpers.
 *
 * These deliberately avoid `process.executeCommand`: some sandbox images
 * advertise zsh in `/etc/shells` without shipping the binary, so every
 * shell-based `mkdir`/`cat` fails before our wrapper runs. The Files API has
 * no such dependency.
 */

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
 * fall back to `getUserHomeDir()`, and finally to the logical workspace dir.
 * The result is memoized by sandbox id so we only round-trip once per session.
 */
export async function resolveSandboxWorkspaceDir(
  sandbox: Pick<DaytonaSandboxLike, "id" | "getWorkDir" | "getUserHomeDir">,
): Promise<string> {
  const key = sandbox.id;
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
  const final = stripTrailingSlash(resolved ?? LOGICAL_WORKSPACE_DIR);

  if (key) workspaceDirCache.set(key, final);
  return final;
}

function stripTrailingSlash(p: string): string {
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
}

/**
 * Idempotently create a directory tree using the Daytona Files API. We
 * iterate parent → child and swallow per-segment errors so "already exists"
 * responses don't abort the walk; the follow-up write surfaces the real error
 * if the leaf was never created.
 */
export async function ensureSandboxDir(
  fs: Pick<DaytonaFsLike, "createFolder">,
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

/** Copy a `Uint8Array` view into a Node `Buffer` without reallocating. */
export function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
