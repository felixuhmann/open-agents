import { posix as path } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static, type TSchema } from "@earendil-works/pi-ai";
import type { SandboxPolicyBundle } from "@open-agents/types";
import type { HydratedAgent } from "../agents/service.js";
import type { SandboxExecResult, SandboxHandle } from "../sandbox-provider/types.js";
import {
  DEFAULT_SHORT_COMMAND_TIMEOUT_SECONDS,
  MAX_READ_FILE_CHARS,
  MAX_TOOL_OUTPUT_CHARS,
  truncateText,
} from "../services/sandboxLimits.js";
import { bashCommand, remapWorkspacePath, shellQuote } from "../services/sandboxShell.js";
import type { AgentEventHandler } from "./types.js";

/**
 * Managed sandbox tools for the shared Pi loop.
 *
 * Every tool talks to a {@link SandboxHandle} — never to a provider SDK — so
 * the same code runs on any provider. Host-side effects (storing a run
 * attachment) are injected so this module stays free of the database.
 */

function truncate(text: string, maxChars: number = MAX_TOOL_OUTPUT_CHARS): string {
  return truncateText(text, maxChars).text;
}

/** Resolve a model-supplied path to an absolute path inside the sandbox. */
export function resolveSandboxPath(input: string, workspaceDir: string): string {
  const absolutePath = input.startsWith("/") ? input : path.join(workspaceDir, input);
  return remapWorkspacePath(absolutePath, workspaceDir);
}

function makeTool<TParams extends TSchema, TDetails = unknown>(tool: {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  executionMode?: "parallel" | "sequential";
  execute: AgentTool<TParams, TDetails>["execute"];
}): AgentTool<TParams, TDetails> {
  return tool;
}

export type StoredRunAttachmentLike = {
  id: string;
  filename: string;
  sizeBytes: number;
};

export type SandboxToolDeps = {
  storeRunAttachment: (
    runId: string,
    filename: string,
    contentType: string,
    bytes: Buffer,
  ) => Promise<StoredRunAttachmentLike>;
};

export type BuildSandboxToolsInput = {
  agent: Pick<HydratedAgent, "toolBindings">;
  handle: SandboxHandle;
  policy: SandboxPolicyBundle;
  onEvent?: AgentEventHandler;
  runId?: string;
  /** Cancels in-flight sandbox commands when the run is aborted. */
  signal?: AbortSignal;
  deps: SandboxToolDeps;
};

function boundManagedTools(agent: Pick<HydratedAgent, "toolBindings">): Set<string> {
  return new Set(
    agent.toolBindings
      .filter((binding) => binding.tool.runtime === "managed")
      .map((binding) => binding.tool.key),
  );
}

export function buildSandboxTools(input: BuildSandboxToolsInput): AgentTool[] {
  const { agent, handle, policy, onEvent, runId, signal, deps } = input;
  const bound = boundManagedTools(agent);
  const tools: AgentTool[] = [];
  const maxOutput = policy.command.maxOutputChars;

  if (runId) tools.push(attachRunFileTool(handle, runId, deps));

  if (bound.has("bash")) tools.push(bashTool(handle, policy, maxOutput, onEvent, signal));
  if (bound.has("read")) tools.push(readTool(handle));
  if (bound.has("write")) tools.push(writeTool(handle));
  if (bound.has("edit")) tools.push(editTool(handle));
  if (bound.has("glob")) tools.push(globTool(handle, maxOutput));
  if (bound.has("grep")) tools.push(grepTool(handle, policy, maxOutput, onEvent, signal));
  if (bound.has("web_fetch")) tools.push(webFetchTool(handle, policy, maxOutput, signal));

  return tools;
}

function emitToolOutput(
  handle: SandboxHandle,
  onEvent: AgentEventHandler | undefined,
  toolName: string,
  callId: string | undefined,
  stream: "stdout" | "stderr",
  text: string,
): void {
  if (!onEvent || !text) return;
  onEvent({
    kind: "tool_output",
    toolName,
    callId,
    stream,
    text,
    // Identifies the provider that actually produced the bytes.
    rawType: `${handle.provider}.command_output`,
  });
}

function formatCommandResult(result: SandboxExecResult): string {
  const parts = [`exitCode: ${result.exitCode}`];
  if (result.policyBlocked) {
    parts.push(`policy: ${result.policyBlocked}`);
  }
  if (result.truncated) {
    parts.push("(output truncated for model)");
  }
  if (result.combined) {
    parts.push("", result.combined);
  }
  return parts.join("\n");
}

function attachRunFileTool(
  handle: SandboxHandle,
  runId: string,
  deps: SandboxToolDeps,
): AgentTool {
  return makeTool({
    name: "attach_run_file",
    label: "Attach run file",
    description:
      "Upload a file from this sandbox to the current run as a downloadable attachment for chat, email, or workflow. Prefer this over markdown sandbox: links or curl for returning artifacts.",
    parameters: Type.Object({
      path: Type.String({
        description: `Path in the sandbox (absolute or relative to ${handle.workspaceDir}).`,
      }),
      filename: Type.Optional(
        Type.String({ description: "Download filename; defaults to the path basename." }),
      ),
      contentType: Type.Optional(
        Type.String({ description: "MIME type; defaults to application/octet-stream." }),
      ),
    }),
    executionMode: "sequential",
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { path: string; filename?: string; contentType?: string };
      const remotePath = resolveSandboxPath(p.path, handle.workspaceDir);
      const bytes = await handle.readFile(remotePath);
      const buf = Buffer.from(bytes);
      const filename = p.filename?.trim() ?? path.basename(remotePath) ?? "attachment";
      const contentType = p.contentType?.trim() ?? "application/octet-stream";
      const stored = await deps.storeRunAttachment(runId, filename, contentType, buf);
      return {
        content: [
          {
            type: "text",
            text: `Attached ${stored.filename} (${stored.sizeBytes} bytes), id ${stored.id}`,
          },
        ],
        details: stored,
      };
    },
  });
}

function bashTool(
  handle: SandboxHandle,
  policy: SandboxPolicyBundle,
  maxOutput: number,
  onEvent?: AgentEventHandler,
  signal?: AbortSignal,
): AgentTool {
  return makeTool({
    name: "bash",
    label: "Bash",
    description:
      "Execute a command in a persistent shell session (state carries between calls).",
    parameters: Type.Object({
      command: Type.String({ description: "Command to execute." }),
      cwd: Type.Optional(
        Type.String({
          description: `Working directory. Defaults to ${handle.workspaceDir}.`,
        }),
      ),
      timeoutSeconds: Type.Optional(
        Type.Number({ description: "Timeout in seconds (max 600)." }),
      ),
    }),
    executionMode: "sequential",
    execute: async (toolCallId, params: Static<TSchema>) => {
      const p = params as { command: string; cwd?: string; timeoutSeconds?: number };
      const result = await handle.exec({
        command: p.command,
        cwd: p.cwd ? resolveSandboxPath(p.cwd, handle.workspaceDir) : handle.workspaceDir,
        timeoutSeconds: p.timeoutSeconds,
        policy,
        signal,
        onOutput: (chunk) =>
          emitToolOutput(handle, onEvent, "bash", toolCallId, chunk.stream, chunk.text),
      });
      const text = truncate(formatCommandResult(result), maxOutput);
      const failed = result.exitCode !== 0 || Boolean(result.policyBlocked);
      return {
        content: [{ type: "text", text }],
        details: result,
        ...(failed ? { isError: true } : {}),
      };
    },
  });
}

function readTool(handle: SandboxHandle): AgentTool {
  return makeTool({
    name: "read",
    label: "Read file",
    description:
      "Read a text file from the sandbox (UTF-8 text; large files are truncated).",
    parameters: Type.Object({
      path: Type.String({ description: "Path to read." }),
    }),
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { path: string };
      const remotePath = resolveSandboxPath(p.path, handle.workspaceDir);
      const bytes = await handle.readFile(remotePath);
      const raw = Buffer.from(bytes).toString("utf8");
      const { text, truncated } = truncateText(raw, MAX_READ_FILE_CHARS, "file");
      return {
        content: [{ type: "text", text }],
        details: {
          path: remotePath,
          requestedPath: p.path,
          bytes: bytes.byteLength,
          truncated,
        },
      };
    },
  });
}

function writeTool(handle: SandboxHandle): AgentTool {
  return makeTool({
    name: "write",
    label: "Write file",
    description: "Write a text file in the sandbox.",
    parameters: Type.Object({
      path: Type.String({ description: "Path to write." }),
      content: Type.String({ description: "Full file content." }),
    }),
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { path: string; content: string };
      const remotePath = resolveSandboxPath(p.path, handle.workspaceDir);
      await handle.writeFile(remotePath, Buffer.from(p.content, "utf8"));
      return {
        content: [
          { type: "text", text: `Wrote ${p.content.length} chars to ${remotePath}` },
        ],
        details: { path: remotePath, requestedPath: p.path, chars: p.content.length },
      };
    },
  });
}

function editTool(handle: SandboxHandle): AgentTool {
  return makeTool({
    name: "edit",
    label: "Edit file",
    description: "Replace one exact string occurrence in a text file.",
    parameters: Type.Object({
      path: Type.String(),
      oldString: Type.String(),
      newString: Type.String(),
    }),
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { path: string; oldString: string; newString: string };
      const remotePath = resolveSandboxPath(p.path, handle.workspaceDir);
      const original = Buffer.from(await handle.readFile(remotePath)).toString("utf8");
      const index = original.indexOf(p.oldString);
      if (index === -1) {
        throw new Error(`oldString was not found in ${remotePath}`);
      }
      if (original.slice(index + p.oldString.length).includes(p.oldString)) {
        throw new Error(
          `oldString occurs more than once in ${remotePath}; provide more context`,
        );
      }
      const updated =
        original.slice(0, index) +
        p.newString +
        original.slice(index + p.oldString.length);
      await handle.writeFile(remotePath, Buffer.from(updated, "utf8"));
      return {
        content: [{ type: "text", text: `Edited ${remotePath}` }],
        details: { path: remotePath, requestedPath: p.path },
      };
    },
  });
}

function globTool(handle: SandboxHandle, maxOutput: number): AgentTool {
  return makeTool({
    name: "glob",
    label: "Glob",
    description: "Find files by glob pattern under a root directory.",
    parameters: Type.Object({
      pattern: Type.String(),
      root: Type.Optional(
        Type.String({
          description: `Root directory. Defaults to ${handle.workspaceDir}.`,
        }),
      ),
    }),
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { pattern: string; root?: string };
      const root = p.root
        ? resolveSandboxPath(p.root, handle.workspaceDir)
        : handle.workspaceDir;
      const result = await handle.searchFiles(root, p.pattern);
      return {
        content: [
          {
            type: "text",
            text: truncate(JSON.stringify(result.files ?? result, null, 2), maxOutput),
          },
        ],
        details: result,
      };
    },
  });
}

function grepTool(
  handle: SandboxHandle,
  policy: SandboxPolicyBundle,
  maxOutput: number,
  onEvent?: AgentEventHandler,
  signal?: AbortSignal,
): AgentTool {
  return makeTool({
    name: "grep",
    label: "Grep",
    description: "Search text in files under a root directory.",
    parameters: Type.Object({
      pattern: Type.String(),
      root: Type.Optional(
        Type.String({
          description: `Root directory. Defaults to ${handle.workspaceDir}.`,
        }),
      ),
    }),
    execute: async (toolCallId, params: Static<TSchema>) => {
      const p = params as { pattern: string; root?: string };
      const root = p.root
        ? resolveSandboxPath(p.root, handle.workspaceDir)
        : handle.workspaceDir;
      const command = `grep -RIn --exclude-dir=.git -e ${shellQuote(p.pattern)} ${shellQuote(root)} || true`;
      const result = await handle.exec({
        command,
        cwd: handle.workspaceDir,
        timeoutSeconds: DEFAULT_SHORT_COMMAND_TIMEOUT_SECONDS,
        policy,
        signal,
        onOutput: (chunk) =>
          emitToolOutput(handle, onEvent, "grep", toolCallId, chunk.stream, chunk.text),
      });
      return {
        content: [
          { type: "text", text: truncate(formatCommandResult(result), maxOutput) },
        ],
        details: result,
      };
    },
  });
}

function webFetchTool(
  handle: SandboxHandle,
  policy: SandboxPolicyBundle,
  maxOutput: number,
  signal?: AbortSignal,
): AgentTool {
  return makeTool({
    name: "web_fetch",
    label: "Web fetch",
    description: "Fetch a URL from inside the sandbox.",
    parameters: Type.Object({
      url: Type.String(),
    }),
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { url: string };
      const command = bashCommand(
        `python3 - <<'PY'\nimport urllib.request\nurl = ${JSON.stringify(p.url)}\nwith urllib.request.urlopen(url, timeout=20) as r:\n    print(r.read().decode('utf-8', 'replace'))\nPY`,
      );
      const result = await handle.exec({
        command,
        cwd: handle.workspaceDir,
        timeoutSeconds: DEFAULT_SHORT_COMMAND_TIMEOUT_SECONDS,
        policy,
        signal,
      });
      return {
        content: [
          { type: "text", text: truncate(formatCommandResult(result), maxOutput) },
        ],
        details: result,
      };
    },
  });
}

export { formatCommandResult };
