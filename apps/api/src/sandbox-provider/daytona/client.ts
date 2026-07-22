/**
 * Structural view of the `@daytona/sdk` surface this adapter uses.
 *
 * Declaring it here (instead of importing `Sandbox`/`Daytona` types
 * everywhere) keeps the adapter injectable: tests supply a fake client and
 * never need credentials, network access, or the SDK itself. The real SDK
 * types satisfy these shapes structurally.
 */

export type DaytonaFsLike = {
  createFolder(path: string, mode: string): Promise<unknown>;
  uploadFile(content: Buffer, remotePath: string): Promise<unknown>;
  downloadFile(remotePath: string): Promise<Buffer>;
  deleteFile(remotePath: string, recursive?: boolean): Promise<unknown>;
  searchFiles(path: string, pattern: string): Promise<{ files: string[] }>;
};

export type DaytonaSessionCommandLike = {
  cmdId?: string;
  exitCode?: number;
};

export type DaytonaProcessLike = {
  getSession(sessionId: string): Promise<unknown>;
  createSession(sessionId: string): Promise<unknown>;
  executeSessionCommand(
    sessionId: string,
    request: { command: string; runAsync?: boolean },
    timeoutSeconds?: number,
  ): Promise<DaytonaSessionCommandLike>;
  getSessionCommandLogs(
    sessionId: string,
    cmdId: string,
    onStdout: (chunk: string) => void,
    onStderr: (chunk: string) => void,
  ): Promise<unknown>;
  getSessionCommand(sessionId: string, cmdId: string): Promise<DaytonaSessionCommandLike>;
};

export type DaytonaNetworkSettings = {
  networkBlockAll?: boolean;
  networkAllowList?: string;
};

export type DaytonaSandboxLike = {
  id: string;
  state?: string;
  errorReason?: string | null;
  recoverable?: boolean;
  lastActivityAt?: string;
  labels?: Record<string, string>;
  fs: DaytonaFsLike;
  process: DaytonaProcessLike;
  getWorkDir?(): Promise<string | undefined>;
  getUserHomeDir?(): Promise<string | undefined>;
  start(timeout?: number): Promise<void>;
  stop(timeout?: number): Promise<void>;
  archive(): Promise<void>;
  recover(timeout?: number): Promise<void>;
  delete(timeout?: number): Promise<void>;
  refreshActivity(): Promise<void>;
  updateNetworkSettings?(settings: DaytonaNetworkSettings): Promise<void>;
};

export type DaytonaCreateParams = {
  name: string;
  language: string;
  autoStopInterval?: number;
  autoArchiveInterval?: number;
  autoDeleteInterval?: number;
  labels?: Record<string, string>;
  networkBlockAll?: boolean;
  networkAllowList?: string;
};

export type DaytonaClientLike = {
  create(
    params: DaytonaCreateParams,
    options?: { timeout?: number },
  ): Promise<DaytonaSandboxLike>;
  get(sandboxIdOrName: string): Promise<DaytonaSandboxLike>;
  list(): AsyncIterable<DaytonaSandboxLike>;
};
