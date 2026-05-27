import { randomUUID } from "node:crypto";
import { posix as path } from "node:path";
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import {
  Type,
  getModels,
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
  type Static,
  type TSchema,
} from "@earendil-works/pi-ai";
import { Daytona, type Sandbox } from "@daytona/sdk";
import { wrapDaytonaError } from "./daytonaErrors.js";
import type { HydratedAgent } from "../agents/service.js";
import { getAgentById } from "../agents/service.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import {
  SKILL_SANDBOX_ROOT,
  materializeAgentSkills,
  skillSlugFromName,
} from "../services/materializeSkills.js";
import { SERVICE_KEYS, getServiceSecret } from "../secrets/service.js";
import {
  AgentBackendError,
  type AgentBackend,
  type AgentEventHandler,
  type AgentFile,
  type AgentRunContext,
  type AgentSession,
  type CreateSessionInput,
  type SessionResource,
  type UploadFileInput,
} from "./types.js";

const DAYTONA_SESSION_PREFIX = "daytona";
const DEFAULT_WORKSPACE_DIR = "/workspace";
const DEFAULT_SHELL_TIMEOUT_SECONDS = 60;
const MAX_TOOL_OUTPUT_CHARS = 20_000;
const MAX_READ_CHARS = 80_000;

type DaytonaSessionRef = {
  agentId: string;
  sandboxId: string;
};

function buildDaytonaSessionId(agentId: string, sandboxId: string): string {
  return `${DAYTONA_SESSION_PREFIX}:${agentId}:${sandboxId}`;
}

function parseDaytonaSessionId(sessionId: string): DaytonaSessionRef {
  const [prefix, agentId, sandboxId] = sessionId.split(":");
  if (prefix !== DAYTONA_SESSION_PREFIX || !agentId || !sandboxId) {
    throw new AgentBackendError(`Invalid Daytona session id: ${sessionId}`);
  }
  return { agentId, sandboxId };
}

function truncate(text: string, maxChars = MAX_TOOL_OUTPUT_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function readTextBlocks(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    message.role === "assistant"
  );
}

function normalizeModelId(modelId: string): Model<Api> {
  const anthropicModels = getModels("anthropic");
  const model = anthropicModels.find((m) => m.id === modelId);
  if (!model) {
    throw new AgentBackendError(
      `Daytona MVP currently supports Anthropic model ids known to pi-ai; unknown model: ${modelId}`,
    );
  }
  return model;
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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

/**
 * Repo-owned agent runtime backed by Pi for the model/tool loop and Daytona
 * for workspace execution. This is intentionally small: enough to make web
 * chat work without Anthropic Managed Agents while preserving the existing
 * RunEvent/SSE surface.
 */
export class DaytonaAgentBackend implements AgentBackend {
  readonly runtime = "daytona" as const;

  constructor(private readonly apiKey: string) {}

  async createSession(input: CreateSessionInput): Promise<AgentSession> {
    try {
      const daytona = new Daytona({ apiKey: this.apiKey });
      const sandbox = await daytona.create(
        {
          name: `oa-${(input.agentSlug ?? input.agentId).replace(/[^a-z0-9-]/gi, "-").slice(0, 32)}-${randomUUID().slice(0, 8)}`,
          language: "typescript",
          autoStopInterval: 15,
          autoArchiveInterval: 60 * 24 * 7,
          autoDeleteInterval: -1,
          labels: {
            "open-agents-agent-id": input.agentId,
            "open-agents-agent-slug": input.agentSlug ?? "",
          },
        },
        { timeout: 90 },
      );

      await sandbox.process.executeCommand(
        `mkdir -p ${shellQuote(DEFAULT_WORKSPACE_DIR)}`,
      );
      await this.materializeResources(sandbox, input.resources ?? []);

      let skillsManifest;
      const agent = await getAgentById(input.agentId);
      if (agent?.skillBindings.length) {
        skillsManifest = await materializeAgentSkills(sandbox, agent.skillBindings);
      }

      log.info("daytona: session created", {
        agentId: input.agentId,
        sandboxId: sandbox.id,
        resources: input.resources?.length ?? 0,
        skillsMaterialized: skillsManifest?.materialized ?? 0,
        skillsFailed: skillsManifest?.failed ?? 0,
      });
      return {
        id: buildDaytonaSessionId(input.agentId, sandbox.id),
        skillsManifest,
      };
    } catch (err) {
      throw wrapDaytonaError(err, "Failed to create Daytona sandbox session");
    }
  }

  async mountSessionResources(
    sessionId: string,
    resources: SessionResource[],
  ): Promise<void> {
    if (!resources.length) return;
    try {
      await this.withSandbox(sessionId, async (sandbox) => {
        await this.materializeResources(sandbox, resources);
      });
      log.info("daytona: mounted session resources", {
        sessionId,
        resourceCount: resources.length,
      });
    } catch (err) {
      throw wrapDaytonaError(err, "Failed to mount files in Daytona sandbox");
    }
  }

  async streamUntilIdle(
    sessionId: string,
    userMessage: string,
    onEvent?: AgentEventHandler,
    context?: AgentRunContext,
  ): Promise<string> {
    try {
      const session = parseDaytonaSessionId(sessionId);
      const agentId = context?.agentId ?? session.agentId;
      const agent = await getAgentById(agentId);
      if (!agent) throw new AgentBackendError(`Agent not found: ${agentId}`);

      return await this.withSandbox(sessionId, async (sandbox) => {
        const priorMessages = context
          ? await loadPriorMessages(context)
          : ([] satisfies Message[]);
        const tools = buildTools(agent, sandbox);
        const model = normalizeModelId(agent.model);
        const anthropicApiKey = await getServiceSecret(SERVICE_KEYS.ANTHROPIC_API_KEY);
        let finalText = "";
        let deltaText = "";

        const runtimePrompt = buildRuntimePrompt(
          agent,
          Boolean(tools.length),
          session.sandboxId,
        );
        const piAgent = new Agent({
          initialState: {
            systemPrompt: runtimePrompt,
            model,
            thinkingLevel: "high",
            messages: priorMessages,
            tools,
          },
          sessionId,
          toolExecution: "sequential",
          getApiKey: (provider) => {
            if (provider === "anthropic") return anthropicApiKey ?? undefined;
            return undefined;
          },
        });

        piAgent.subscribe((event) => {
          this.handlePiEvent(event, onEvent, (text) => {
            deltaText += text;
          });
          if (event.type === "message_end" && isAssistantMessage(event.message)) {
            finalText = readTextBlocks(event.message);
          }
          if (event.type === "turn_end" && isAssistantMessage(event.message)) {
            const usage = event.message.usage;
            onEvent?.({
              kind: "model_request",
              rawType: "pi.turn_end",
              model: event.message.model,
              isError: event.message.stopReason === "error",
              usage: {
                inputTokens: usage.input,
                outputTokens: usage.output,
                cacheCreationInputTokens: usage.cacheWrite,
                cacheReadInputTokens: usage.cacheRead,
              },
            });
          }
        });

        await piAgent.prompt(userMessage);
        return finalText || deltaText;
      });
    } catch (err) {
      const wrapped = wrapDaytonaError(err, "Daytona sandbox run failed");
      onEvent?.({
        kind: "session_error",
        rawType: "daytona.error",
        message: wrapped.message,
      });
      throw wrapped;
    }
  }

  uploadFile(_input: UploadFileInput): Promise<AgentFile> {
    // Daytona has no separate Files API. The worker passes newly-uploaded bytes
    // through SessionResource so createSession can materialize them directly.
    return Promise.resolve({ id: `daytona-file-${randomUUID()}` });
  }

  private async withSandbox<T>(
    sessionId: string,
    fn: (sandbox: Sandbox) => Promise<T>,
  ): Promise<T> {
    const session = parseDaytonaSessionId(sessionId);
    const daytona = new Daytona({ apiKey: this.apiKey });
    const sandbox = await daytona.get(session.sandboxId);
    if (sandbox.state !== "started") {
      await sandbox.start(90);
    }
    await sandbox.refreshActivity();
    return fn(sandbox);
  }

  private async materializeResources(
    sandbox: Sandbox,
    resources: SessionResource[],
  ): Promise<void> {
    for (const resource of resources) {
      if (!resource.bytes) continue;
      const remoteDir = path.dirname(resource.mountPath);
      await sandbox.process.executeCommand(`mkdir -p ${shellQuote(remoteDir)}`);
      await sandbox.fs.uploadFile(toBuffer(resource.bytes), resource.mountPath);
    }
  }

  private handlePiEvent(
    event: AgentEvent,
    onEvent: AgentEventHandler | undefined,
    onDelta: (text: string) => void,
  ): void {
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta" && update.delta) {
        onDelta(update.delta);
        onEvent?.({ kind: "delta", text: update.delta, rawType: "pi.text_delta" });
      }
      return;
    }

    if (event.type === "message_end" && isAssistantMessage(event.message)) {
      const text = readTextBlocks(event.message);
      if (text) onEvent?.({ kind: "message", text, rawType: "pi.message_end" });
      return;
    }

    if (event.type === "tool_execution_start") {
      onEvent?.({
        kind: "tool_use",
        toolName: event.toolName,
        rawType: "pi.tool_execution_start",
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      onEvent?.({
        kind: "tool_result",
        toolName: event.toolName,
        callId: event.toolCallId,
        result: event.result,
        isError: event.isError,
        rawType: "pi.tool_execution_end",
      });
    }
  }
}

async function loadPriorMessages(context: AgentRunContext): Promise<Message[]> {
  if (context.surface === "chat") {
    const run = await prisma.agentRun.findUnique({ where: { id: context.runId } });
    if (!run?.conversationId) return [];
    const rows = await prisma.chatMessage.findMany({
      where: { conversationId: run.conversationId },
      orderBy: { createdAt: "asc" },
    });
    return rows
      .filter((row) => row.id !== context.chatMessageId)
      .flatMap((row): Message[] => {
        if (row.role === "user") {
          return [
            { role: "user", content: row.content, timestamp: row.createdAt.getTime() },
          ];
        }
        if (row.role === "assistant") {
          return [
            {
              role: "assistant",
              api: "anthropic-messages",
              provider: "anthropic",
              model: "unknown",
              content: [{ type: "text", text: row.content }],
              usage: emptyUsage(),
              stopReason: "stop",
              timestamp: row.createdAt.getTime(),
            },
          ];
        }
        return [];
      });
  }

  const run = await prisma.agentRun.findUnique({ where: { id: context.runId } });
  if (!run?.threadId) return [];
  const rows = await prisma.emailMessage.findMany({
    where: { threadId: run.threadId },
    orderBy: { createdAt: "asc" },
  });
  return rows
    .filter((row) => row.id !== context.emailMessageId)
    .map((row): Message => {
      if (row.direction === "outbound") {
        return {
          role: "assistant",
          api: "anthropic-messages",
          provider: "anthropic",
          model: "unknown",
          content: [{ type: "text", text: row.body }],
          usage: emptyUsage(),
          stopReason: "stop",
          timestamp: row.createdAt.getTime(),
        };
      }
      return { role: "user", content: row.body, timestamp: row.createdAt.getTime() };
    });
}

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function buildSkillInstructions(agent: HydratedAgent): string | null {
  if (!agent.skillBindings.length) return null;
  const lines = agent.skillBindings.map((binding) => {
    const slug = skillSlugFromName(binding.skill.name);
    return `- ${binding.skill.name} (pinned v${binding.skillVersion.versionNumber}): ${SKILL_SANDBOX_ROOT}/${slug}/SKILL.md`;
  });
  return [
    `Bundled skills are unpacked under ${SKILL_SANDBOX_ROOT}/<slug>/ in this sandbox.`,
    "When a task matches a skill, read that skill's SKILL.md before using other files in the same directory.",
    "Skills bound to this agent:",
    ...lines,
  ].join("\n");
}

function buildRuntimePrompt(
  agent: HydratedAgent,
  hasTools: boolean,
  sandboxId: string,
): string {
  const toolInstructions = hasTools
    ? [
        "You have a Daytona Linux sandbox workspace. Treat /workspace as the working directory.",
        "Use tools to inspect files, write artifacts, and run commands when useful.",
        "If the user message contains REPLY_ATTACHMENT_UPLOAD_URL, upload final files there with curl when the user asks for downloadable artifacts.",
      ].join("\n")
    : "No sandbox tools are currently enabled for this agent.";

  const skillInstructions = buildSkillInstructions(agent);

  const sections = [
    agent.systemPrompt.trim(),
    toolInstructions,
    skillInstructions,
    `Daytona sandbox id: ${sandboxId}`,
  ].filter(Boolean);

  return sections.join("\n\n");
}

function boundManagedTools(agent: HydratedAgent): Set<string> {
  return new Set(
    agent.toolBindings
      .filter((binding) => binding.tool.runtime === "managed")
      .map((binding) => binding.tool.key),
  );
}

function buildTools(agent: HydratedAgent, sandbox: Sandbox): AgentTool[] {
  const bound = boundManagedTools(agent);
  const tools: AgentTool[] = [];

  if (bound.has("bash")) tools.push(bashTool(sandbox));
  if (bound.has("read")) tools.push(readTool(sandbox));
  if (bound.has("write")) tools.push(writeTool(sandbox));
  if (bound.has("edit")) tools.push(editTool(sandbox));
  if (bound.has("glob")) tools.push(globTool(sandbox));
  if (bound.has("grep")) tools.push(grepTool(sandbox));
  if (bound.has("web_fetch")) tools.push(webFetchTool(sandbox));

  return tools;
}

function bashTool(sandbox: Sandbox): AgentTool {
  return makeTool({
    name: "bash",
    label: "Bash",
    description: "Execute a bash command in the Daytona sandbox.",
    parameters: Type.Object({
      command: Type.String({ description: "Command to execute." }),
      cwd: Type.Optional(
        Type.String({ description: "Working directory. Defaults to /workspace." }),
      ),
      timeoutSeconds: Type.Optional(Type.Number({ description: "Timeout in seconds." })),
    }),
    executionMode: "sequential",
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { command: string; cwd?: string; timeoutSeconds?: number };
      const result = await sandbox.process.executeCommand(
        p.command,
        p.cwd ?? DEFAULT_WORKSPACE_DIR,
        undefined,
        Math.max(1, Math.min(p.timeoutSeconds ?? DEFAULT_SHELL_TIMEOUT_SECONDS, 600)),
      );
      return {
        content: [
          {
            type: "text",
            text: truncate(`exitCode: ${result.exitCode}\n\n${result.result}`),
          },
        ],
        details: result,
      };
    },
  });
}

function readTool(sandbox: Sandbox): AgentTool {
  return makeTool({
    name: "read",
    label: "Read file",
    description: "Read a text file from the Daytona sandbox.",
    parameters: Type.Object({
      path: Type.String({ description: "Path to read." }),
    }),
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { path: string };
      const bytes = await sandbox.fs.downloadFile(p.path);
      const text = truncate(bytes.toString("utf8"), MAX_READ_CHARS);
      return { content: [{ type: "text", text }], details: { path: p.path } };
    },
  });
}

function writeTool(sandbox: Sandbox): AgentTool {
  return makeTool({
    name: "write",
    label: "Write file",
    description: "Write a text file in the Daytona sandbox.",
    parameters: Type.Object({
      path: Type.String({ description: "Path to write." }),
      content: Type.String({ description: "Full file content." }),
    }),
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { path: string; content: string };
      await sandbox.process.executeCommand(
        `mkdir -p ${shellQuote(path.dirname(p.path))}`,
      );
      await sandbox.fs.uploadFile(Buffer.from(p.content, "utf8"), p.path);
      return {
        content: [{ type: "text", text: `Wrote ${p.content.length} chars to ${p.path}` }],
        details: { path: p.path, chars: p.content.length },
      };
    },
  });
}

function editTool(sandbox: Sandbox): AgentTool {
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
      const original = (await sandbox.fs.downloadFile(p.path)).toString("utf8");
      const index = original.indexOf(p.oldString);
      if (index === -1) {
        throw new Error(`oldString was not found in ${p.path}`);
      }
      if (original.slice(index + p.oldString.length).includes(p.oldString)) {
        throw new Error(
          `oldString occurs more than once in ${p.path}; provide more context`,
        );
      }
      const updated =
        original.slice(0, index) +
        p.newString +
        original.slice(index + p.oldString.length);
      await sandbox.fs.uploadFile(Buffer.from(updated, "utf8"), p.path);
      return {
        content: [{ type: "text", text: `Edited ${p.path}` }],
        details: { path: p.path },
      };
    },
  });
}

function globTool(sandbox: Sandbox): AgentTool {
  return makeTool({
    name: "glob",
    label: "Glob",
    description: "Find files by glob pattern under a root directory.",
    parameters: Type.Object({
      pattern: Type.String(),
      root: Type.Optional(
        Type.String({ description: "Root directory. Defaults to /workspace." }),
      ),
    }),
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { pattern: string; root?: string };
      const result = await sandbox.fs.searchFiles(
        p.root ?? DEFAULT_WORKSPACE_DIR,
        p.pattern,
      );
      return {
        content: [
          {
            type: "text",
            text: truncate(JSON.stringify(result.files ?? result, null, 2)),
          },
        ],
        details: result,
      };
    },
  });
}

function grepTool(sandbox: Sandbox): AgentTool {
  return makeTool({
    name: "grep",
    label: "Grep",
    description: "Search text in files under a root directory.",
    parameters: Type.Object({
      pattern: Type.String(),
      root: Type.Optional(
        Type.String({ description: "Root directory. Defaults to /workspace." }),
      ),
    }),
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { pattern: string; root?: string };
      const result = await sandbox.process.executeCommand(
        `grep -RIn --exclude-dir=.git -e ${shellQuote(p.pattern)} ${shellQuote(p.root ?? DEFAULT_WORKSPACE_DIR)} || true`,
        DEFAULT_WORKSPACE_DIR,
        undefined,
        30,
      );
      return {
        content: [{ type: "text", text: truncate(result.result) }],
        details: result,
      };
    },
  });
}

function webFetchTool(sandbox: Sandbox): AgentTool {
  return makeTool({
    name: "web_fetch",
    label: "Web fetch",
    description: "Fetch a URL from inside the Daytona sandbox.",
    parameters: Type.Object({
      url: Type.String(),
    }),
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { url: string };
      const result = await sandbox.process.executeCommand(
        `python3 - <<'PY'\nimport urllib.request\nurl = ${JSON.stringify(p.url)}\nwith urllib.request.urlopen(url, timeout=20) as r:\n    print(r.read().decode('utf-8', 'replace'))\nPY`,
        DEFAULT_WORKSPACE_DIR,
        undefined,
        30,
      );
      return {
        content: [{ type: "text", text: truncate(result.result) }],
        details: result,
      };
    },
  });
}
