/** Default working directory for TypeScript Daytona sandboxes. */
export const DAYTONA_WORKSPACE_DIR = "/workspace";

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** TypeScript sandboxes may not ship zsh; always invoke bash explicitly. */
export function bashCommand(command: string): string {
  return `/bin/bash -lc ${shellQuote(command)}`;
}

export type DaytonaSandboxProcess = {
  executeCommand(
    command: string,
    cwd?: string,
    env?: Record<string, string>,
    timeout?: number,
  ): Promise<{ exitCode: number; result: string }>;
};

/**
 * Idempotently create a directory tree in the sandbox. Prefer this over
 * `fs.createFolder` for paths like `/workspace/...` — the Files API expects
 * relative segments and returns HTTP 400 when the target already exists.
 */
export async function ensureSandboxDir(
  process: DaytonaSandboxProcess,
  remoteDir: string,
  cwd: string = DAYTONA_WORKSPACE_DIR,
): Promise<void> {
  if (!remoteDir || remoteDir === "." || remoteDir === "/") return;
  const result = await process.executeCommand(
    bashCommand(`mkdir -p ${shellQuote(remoteDir)}`),
    cwd,
    undefined,
    30,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `mkdir -p failed for ${remoteDir} (exit ${result.exitCode}): ${result.result}`,
    );
  }
}
