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
import type { SandboxPolicyBundle, SandboxResourceMounted } from "@open-agents/types";
import {
  buildDaytonaSessionId,
  ensureDaytonaSandboxReady,
  parseDaytonaSessionId,
} from "../services/daytonaSandbox.js";
import {
  emitSandboxRunEvent,
  sandboxContextFromSession,
  summarizeToolResultForRunLog,
} from "../services/runObservability.js";
import { applySandboxNetworkPolicy } from "../services/applySandboxNetworkPolicy.js";
import { DEFAULT_DAYTONA_LIFECYCLE } from "../services/sandboxLifecyclePolicy.js";
import {
  resolveDraftSandboxPolicy,
  resolvePublishedSandboxPolicy,
  toDaytonaNetworkOptions,
} from "../services/sandboxPolicy.js";
import { registerAgentSandbox, touchSandboxActivity } from "../services/sandboxes.js";
import { wrapDaytonaError } from "./daytonaErrors.js";
import type { HydratedAgent } from "../agents/service.js";
import { getAgentById } from "../agents/service.js";
import { loadVersionedAgent, type VersionedAgent } from "../agents/snapshot.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { buildMcpPiTools, closeThirdPartyMcpConnections } from "../mcp/piTools.js";
import { loadThirdPartyBearerMap } from "../mcp/thirdPartySecrets.js";
import {
  materializeAgentSkills,
  skillSandboxRootFor,
  skillSlugFromName,
} from "../services/materializeSkills.js";
import { formatCommandResult, runSandboxCommand } from "../services/daytonaExec.js";
import {
  DEFAULT_SHORT_COMMAND_TIMEOUT_SECONDS,
  MAX_READ_FILE_CHARS,
  MAX_TOOL_OUTPUT_CHARS,
  truncateText,
} from "../services/daytonaLimits.js";
import {
  bashCommand,
  ensureSandboxDir,
  remapWorkspacePath,
  resolveSandboxWorkspaceDir,
  shellQuote,
} from "../services/daytonaShell.js";
import { SERVICE_KEYS, getServiceSecret } from "../secrets/service.js";
import {
  AgentBackendError,
  type AgentBackend,
  type AgentEventHandler,
  type AgentFile,
  type AgentRunContext,
  type AgentSession,
  type CreateSessionInput,
  type RunObservabilityContext,
  type SessionResource,
  type UploadFileInput,
} from "./types.js";

function truncate(text: string, maxChars: number = MAX_TOOL_OUTPUT_CHARS): string {
  return truncateText(text, maxChars).text;
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
      const lifecycle = DEFAULT_DAYTONA_LIFECYCLE;
      const baseAgent = await getAgentById(input.agentId);
      let sandboxPolicy: SandboxPolicyBundle = baseAgent
        ? resolveDraftSandboxPolicy(baseAgent)
        : {
            network: {
              internetEnabled: true,
              allowList: "",
              protectInternalNetwork: true,
            },
            command: {
              denyRules: [],
              approvalGatePatterns: [],
              maxRuntimeSeconds: 60,
              maxOutputChars: 20_000,
              maxBackgroundProcessLifetimeSeconds: 600,
            },
          };
      if (baseAgent && input.agentVersionId) {
        const versioned = await loadVersionedAgent(baseAgent, input.agentVersionId);
        sandboxPolicy = resolvePublishedSandboxPolicy(versioned.configSnapshot);
      }

      const networkCreate = toDaytonaNetworkOptions(sandboxPolicy.network);
      const sandbox = await daytona.create(
        {
          name: `oa-${(input.agentSlug ?? input.agentId).replace(/[^a-z0-9-]/gi, "-").slice(0, 32)}-${randomUUID().slice(0, 8)}`,
          language: "typescript",
          autoStopInterval: lifecycle.autoStopInterval,
          autoArchiveInterval: lifecycle.autoArchiveInterval,
          autoDeleteInterval: lifecycle.autoDeleteInterval,
          labels: {
            "open-agents-agent-id": input.agentId,
            "open-agents-agent-slug": input.agentSlug ?? "",
          },
          ...networkCreate,
        },
        { timeout: 90 },
      );
      await applySandboxNetworkPolicy(sandbox, sandboxPolicy.network);

      const workspaceDir = await resolveSandboxWorkspaceDir(sandbox);
      const sessionId = buildDaytonaSessionId(input.agentId, sandbox.id);

      await this.materializeResources(
        sandbox,
        input.resources ?? [],
        workspaceDir,
        input.observability ? { runId: input.observability.runId, sessionId } : undefined,
      );

      let skillsManifest;
      const agent = baseAgent;
      const skillBindings =
        input.agentVersionId && agent
          ? (await loadVersionedAgent(agent, input.agentVersionId)).skillBindings
          : agent?.skillBindings;
      if (skillBindings?.length) {
        skillsManifest = await materializeAgentSkills(
          sandbox,
          skillBindings,
          workspaceDir,
        );
      }

      await registerAgentSandbox({
        agentId: input.agentId,
        providerSandboxId: sandbox.id,
        lifecyclePolicy: lifecycle,
        surface: input.surface,
        conversationId: input.conversationId,
        threadId: input.threadId,
        state: sandbox.state ?? "started",
      });

      if (input.observability) {
        const ctx = sandboxContextFromSession(
          sessionId,
          workspaceDir,
          sandbox.state ?? "started",
        );
        await emitSandboxRunEvent(input.observability.runId, "sandbox.created", {
          type: "sandbox.created",
          ...ctx,
        });
      }

      log.info("daytona: session created", {
        agentId: input.agentId,
        sandboxId: sandbox.id,
        workspaceDir,
        resources: input.resources?.length ?? 0,
        skillsMaterialized: skillsManifest?.materialized ?? 0,
        skillsFailed: skillsManifest?.failed ?? 0,
      });
      return {
        id: sessionId,
        skillsManifest,
        providerSandboxId: sandbox.id,
        workspaceDir,
      };
    } catch (err) {
      throw wrapDaytonaError(err, "Failed to create Daytona sandbox session");
    }
  }

  async mountSessionResources(
    sessionId: string,
    resources: SessionResource[],
    observability?: RunObservabilityContext,
  ): Promise<void> {
    if (!resources.length) return;
    try {
      await this.withSandbox(
        sessionId,
        async (sandbox, workspaceDir) => {
          await this.materializeResources(
            sandbox,
            resources,
            workspaceDir,
            observability ? { runId: observability.runId, sessionId } : undefined,
          );
        },
        observability?.runId,
      );
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
      const baseAgent = await getAgentById(agentId);
      if (!baseAgent) throw new AgentBackendError(`Agent not found: ${agentId}`);

      const agent = context?.agentVersionId
        ? await loadVersionedAgent(baseAgent, context.agentVersionId)
        : baseAgent;
      const sandboxPolicy = context?.agentVersionId
        ? resolvePublishedSandboxPolicy((agent as VersionedAgent).configSnapshot)
        : resolveDraftSandboxPolicy(agent);

      return await this.withSandbox(
        sessionId,
        async (sandbox, workspaceDir) => {
          const priorMessages = context
            ? await loadPriorMessages(context)
            : ([] satisfies Message[]);
          const thirdPartyBearer = loadThirdPartyBearerMap(agent.thirdPartyMcp);
          const { tools: mcpTools, connections: mcpConnections } = await buildMcpPiTools(
            agent,
            thirdPartyBearer,
          );
          const tools = [
            ...buildTools(agent, sandbox, workspaceDir, sandboxPolicy, onEvent),
            ...mcpTools,
          ];
          const model = normalizeModelId(agent.model);
          const anthropicApiKey = await getServiceSecret(SERVICE_KEYS.ANTHROPIC_API_KEY);
          let finalText = "";
          let deltaText = "";

          try {
            const runtimePrompt = buildRuntimePrompt(
              agent,
              Boolean(tools.length),
              session.sandboxId,
              workspaceDir,
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
                  provider: "anthropic",
                  stopReason: event.message.stopReason,
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
          } finally {
            await closeThirdPartyMcpConnections(mcpConnections);
          }
        },
        context?.runId,
      );
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
    fn: (sandbox: Sandbox, workspaceDir: string) => Promise<T>,
    observabilityRunId?: string,
  ): Promise<T> {
    const session = parseDaytonaSessionId(sessionId);
    const daytona = new Daytona({ apiKey: this.apiKey });
    const sandbox = await daytona.get(session.sandboxId);
    const {
      sandbox: ready,
      previousState,
      transitions,
    } = await ensureDaytonaSandboxReady(sandbox);
    const workspaceDir = await resolveSandboxWorkspaceDir(ready);
    if (observabilityRunId) {
      const ctx = sandboxContextFromSession(
        sessionId,
        workspaceDir,
        ready.state ?? "started",
        previousState,
      );
      for (const transition of transitions) {
        if (transition === "recover") {
          await emitSandboxRunEvent(observabilityRunId, "sandbox.recovered", {
            type: "sandbox.recovered",
            ...ctx,
          });
        }
        if (transition === "start") {
          await emitSandboxRunEvent(observabilityRunId, "sandbox.started", {
            type: "sandbox.started",
            ...ctx,
          });
        }
      }
    }
    await touchSandboxActivity(sessionId);
    return fn(ready, workspaceDir);
  }

  private async materializeResources(
    sandbox: Sandbox,
    resources: SessionResource[],
    workspaceDir: string,
    observability?: { runId: string; sessionId: string },
  ): Promise<void> {
    const mounted: SandboxResourceMounted[] = [];
    for (const resource of resources) {
      if (!resource.bytes) continue;
      const remotePath = remapWorkspacePath(resource.mountPath, workspaceDir);
      const remoteDir = path.dirname(remotePath);
      await ensureSandboxDir(sandbox.fs, remoteDir);
      await sandbox.fs.uploadFile(toBuffer(resource.bytes), remotePath);
      mounted.push({
        ...(resource.fileId ? { fileId: resource.fileId } : {}),
        ...(resource.filename ? { filename: resource.filename } : {}),
        mountPath: remotePath,
        sizeBytes: resource.bytes.byteLength,
      });
    }
    if (observability && mounted.length > 0) {
      await emitSandboxRunEvent(observability.runId, "sandbox.resource_mounted", {
        type: "sandbox.resource_mounted",
        ...sandboxContextFromSession(
          observability.sessionId,
          workspaceDir,
          sandbox.state ?? "started",
        ),
        resources: mounted,
      });
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
        callId: event.toolCallId,
        args:
          event.args && typeof event.args === "object"
            ? (event.args as Record<string, unknown>)
            : undefined,
        rawType: "pi.tool_execution_start",
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      onEvent?.({
        kind: "tool_result",
        toolName: event.toolName,
        callId: event.toolCallId,
        result: summarizeToolResultForRunLog(event.result),
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

function buildSkillInstructions(agent: HydratedAgent, skillsRoot: string): string | null {
  if (!agent.skillBindings.length) return null;
  const lines = agent.skillBindings.map((binding) => {
    const slug = skillSlugFromName(binding.skill.name);
    return `- ${binding.skill.name} (pinned v${binding.skillVersion.versionNumber}): ${skillsRoot}/${slug}/SKILL.md`;
  });
  return [
    `Bundled skills are unpacked under ${skillsRoot}/<slug>/ in this sandbox.`,
    "When a task matches a skill, read that skill's SKILL.md before using other files in the same directory.",
    "Skills bound to this agent:",
    ...lines,
  ].join("\n");
}

function buildRuntimePrompt(
  agent: HydratedAgent,
  hasTools: boolean,
  sandboxId: string,
  workspaceDir: string,
): string {
  const toolInstructions = hasTools
    ? [
        `You have a Daytona Linux sandbox workspace. Treat ${workspaceDir} as the working directory.`,
        "Use tools to inspect files, write artifacts, and run commands when useful.",
        "Bash uses a persistent shell session in the sandbox (cwd and env persist between calls).",
        "For web pages or search, use curl/wget in bash or bind a third-party MCP search tool — there is no built-in web_search.",
        "Platform tools (for example memory_*) and third-party MCP tools (name prefix server:tool) run on the orchestrator host, not inside the sandbox.",
        "If the user message contains REPLY_ATTACHMENT_UPLOAD_URL, upload final files there with curl when the user asks for downloadable artifacts.",
      ].join("\n")
    : "No sandbox tools are currently enabled for this agent.";

  const skillInstructions = buildSkillInstructions(
    agent,
    skillSandboxRootFor(workspaceDir),
  );

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

function buildTools(
  agent: HydratedAgent,
  sandbox: Sandbox,
  workspaceDir: string,
  sandboxPolicy: SandboxPolicyBundle,
  onEvent?: AgentEventHandler,
): AgentTool[] {
  const bound = boundManagedTools(agent);
  const tools: AgentTool[] = [];
  const maxOutput = sandboxPolicy.command.maxOutputChars;

  if (bound.has("bash"))
    tools.push(bashTool(sandbox, workspaceDir, sandboxPolicy, maxOutput, onEvent));
  if (bound.has("read")) tools.push(readTool(sandbox));
  if (bound.has("write")) tools.push(writeTool(sandbox));
  if (bound.has("edit")) tools.push(editTool(sandbox));
  if (bound.has("glob")) tools.push(globTool(sandbox, workspaceDir, maxOutput));
  if (bound.has("grep"))
    tools.push(grepTool(sandbox, workspaceDir, sandboxPolicy, maxOutput, onEvent));
  if (bound.has("web_fetch"))
    tools.push(webFetchTool(sandbox, workspaceDir, sandboxPolicy, maxOutput));

  return tools;
}

function emitToolOutput(
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
    rawType: "daytona.command_output",
  });
}

function bashTool(
  sandbox: Sandbox,
  workspaceDir: string,
  sandboxPolicy: SandboxPolicyBundle,
  maxOutput: number,
  onEvent?: AgentEventHandler,
): AgentTool {
  return makeTool({
    name: "bash",
    label: "Bash",
    description:
      "Execute a command in a persistent shell session (state carries between calls).",
    parameters: Type.Object({
      command: Type.String({ description: "Command to execute." }),
      cwd: Type.Optional(
        Type.String({ description: `Working directory. Defaults to ${workspaceDir}.` }),
      ),
      timeoutSeconds: Type.Optional(
        Type.Number({ description: "Timeout in seconds (max 600)." }),
      ),
    }),
    executionMode: "sequential",
    execute: async (toolCallId, params: Static<TSchema>) => {
      const p = params as { command: string; cwd?: string; timeoutSeconds?: number };
      const result = await runSandboxCommand({
        sandbox,
        command: p.command,
        cwd: p.cwd ?? workspaceDir,
        workspaceDir,
        timeoutSeconds: p.timeoutSeconds,
        policy: sandboxPolicy,
        onOutput: (chunk) =>
          emitToolOutput(onEvent, "bash", toolCallId, chunk.stream, chunk.text),
      });
      const text = truncate(formatCommandResult(result), maxOutput);
      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });
}

function readTool(sandbox: Sandbox): AgentTool {
  return makeTool({
    name: "read",
    label: "Read file",
    description:
      "Read a text file from the Daytona sandbox (UTF-8 text; large files are truncated).",
    parameters: Type.Object({
      path: Type.String({ description: "Path to read." }),
    }),
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { path: string };
      const bytes = await sandbox.fs.downloadFile(p.path);
      const raw = bytes.toString("utf8");
      const { text, truncated } = truncateText(raw, MAX_READ_FILE_CHARS, "file");
      return {
        content: [{ type: "text", text }],
        details: { path: p.path, bytes: bytes.byteLength, truncated },
      };
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
      await ensureSandboxDir(sandbox.fs, path.dirname(p.path));
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

function globTool(sandbox: Sandbox, workspaceDir: string, maxOutput: number): AgentTool {
  return makeTool({
    name: "glob",
    label: "Glob",
    description: "Find files by glob pattern under a root directory.",
    parameters: Type.Object({
      pattern: Type.String(),
      root: Type.Optional(
        Type.String({ description: `Root directory. Defaults to ${workspaceDir}.` }),
      ),
    }),
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { pattern: string; root?: string };
      const result = await sandbox.fs.searchFiles(p.root ?? workspaceDir, p.pattern);
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
  sandbox: Sandbox,
  workspaceDir: string,
  sandboxPolicy: SandboxPolicyBundle,
  maxOutput: number,
  onEvent?: AgentEventHandler,
): AgentTool {
  return makeTool({
    name: "grep",
    label: "Grep",
    description: "Search text in files under a root directory.",
    parameters: Type.Object({
      pattern: Type.String(),
      root: Type.Optional(
        Type.String({ description: `Root directory. Defaults to ${workspaceDir}.` }),
      ),
    }),
    execute: async (toolCallId, params: Static<TSchema>) => {
      const p = params as { pattern: string; root?: string };
      const command = `grep -RIn --exclude-dir=.git -e ${shellQuote(p.pattern)} ${shellQuote(p.root ?? workspaceDir)} || true`;
      const result = await runSandboxCommand({
        sandbox,
        command,
        cwd: workspaceDir,
        workspaceDir,
        timeoutSeconds: DEFAULT_SHORT_COMMAND_TIMEOUT_SECONDS,
        policy: sandboxPolicy,
        onOutput: (chunk) =>
          emitToolOutput(onEvent, "grep", toolCallId, chunk.stream, chunk.text),
      });
      const text = truncate(formatCommandResult(result), maxOutput);
      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });
}

function webFetchTool(
  sandbox: Sandbox,
  workspaceDir: string,
  sandboxPolicy: SandboxPolicyBundle,
  maxOutput: number,
): AgentTool {
  return makeTool({
    name: "web_fetch",
    label: "Web fetch",
    description: "Fetch a URL from inside the Daytona sandbox.",
    parameters: Type.Object({
      url: Type.String(),
    }),
    execute: async (_id, params: Static<TSchema>) => {
      const p = params as { url: string };
      const command = bashCommand(
        `python3 - <<'PY'\nimport urllib.request\nurl = ${JSON.stringify(p.url)}\nwith urllib.request.urlopen(url, timeout=20) as r:\n    print(r.read().decode('utf-8', 'replace'))\nPY`,
      );
      const result = await runSandboxCommand({
        sandbox,
        command,
        cwd: workspaceDir,
        workspaceDir,
        timeoutSeconds: DEFAULT_SHORT_COMMAND_TIMEOUT_SECONDS,
        policy: sandboxPolicy,
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
