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
  type AssistantMessage,
  type Message,
  type Static,
  type TSchema,
} from "@earendil-works/pi-ai";
import { Daytona, type Sandbox } from "@daytona/sdk";
import {
  ReasoningLevelSchema,
  type SandboxPolicyBundle,
  type SandboxResourceMounted,
} from "@open-agents/types";
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
import { buildAuthorProfileContext } from "../services/userProfileContext.js";
import {
  isRunCancelledError,
  RunCancelledError,
  throwIfRunCancelled,
} from "../services/runCancellation.js";
import { wrapDaytonaError } from "./daytonaErrors.js";
import { piHistoryTokenBudget, trimPiContext } from "./piSessionContext.js";
import {
  loadPiSessionCheckpoint,
  savePiSessionCheckpoint,
} from "./piSessionPersistence.js";
import type { HydratedAgent } from "../agents/service.js";
import { getAgentById } from "../agents/service.js";
import { loadVersionedAgent, type VersionedAgent } from "../agents/snapshot.js";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { log } from "../log.js";
import { buildMcpPiTools, closeThirdPartyMcpConnections } from "../mcp/piTools.js";
import { buildSubagentPiTools } from "../mcp/subagentTools.js";
import { loadMcpServerBearerMap } from "../mcp/mcpServerSecrets.js";
import { listAgentMcpServers } from "../agents/service.js";
import {
  materializeAgentSkills,
  skillSandboxRootFor,
  skillSlugFromName,
} from "../services/materializeSkills.js";
import { formatCommandResult, runSandboxCommand } from "../services/daytonaExec.js";
import { storeRunAttachment } from "../services/runAttachments.js";
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
import { resolvePiModel, resolvePiProviderApiKey } from "../services/piModel.js";
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

function resolveSandboxPath(input: string, workspaceDir: string): string {
  const absolutePath = input.startsWith("/") ? input : path.join(workspaceDir, input);
  return remapWorkspacePath(absolutePath, workspaceDir);
}

function readTextBlocks(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function readAssistantErrorMessage(message: AssistantMessage): string | undefined {
  const err = (message as AssistantMessage & { errorMessage?: unknown }).errorMessage;
  return typeof err === "string" && err.trim().length > 0 ? err.trim() : undefined;
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    message.role === "assistant"
  );
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
 * for workspace execution while preserving the existing RunEvent/SSE surface.
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
          const model = resolvePiModel(agent.modelProvider, agent.modelId);
          const historyBudget = piHistoryTokenBudget(model.contextWindow);
          const checkpoint = context
            ? await loadPiSessionCheckpoint(context.runId)
            : { context: null, providerSessionId: sessionId };
          const restoredMessages =
            checkpoint.context ??
            (context
              ? await loadLegacyPriorMessages(context, model)
              : ([] satisfies Message[]));
          const priorMessages = trimPiContext(restoredMessages, historyBudget);
          const thirdPartyBearer = loadMcpServerBearerMap(listAgentMcpServers(agent));
          const { tools: mcpTools, connections: mcpConnections } = await buildMcpPiTools(
            agent,
            thirdPartyBearer,
            { sandbox: { fs: sandbox.fs, workspaceDir } },
          );
          const subagentTools = buildSubagentPiTools(agent, {
            parentRunId: context?.runId,
            parentSurface: context?.surface ?? "chat",
            depth: context?.delegationDepth ?? 0,
            ancestors: context?.delegationAncestors ?? [agentId],
          });
          const tools = [
            ...buildTools(
              agent,
              sandbox,
              workspaceDir,
              sandboxPolicy,
              onEvent,
              context?.runId,
            ),
            ...mcpTools,
            ...subagentTools,
          ];
          let finalText = "";
          let deltaText = "";
          let lastModelError: string | undefined;
          let piAgent: Agent | undefined;
          let requestTimeout: ReturnType<typeof setTimeout> | undefined;
          let runTimeout: ReturnType<typeof setTimeout> | undefined;
          let timeoutReason: string | undefined;
          let rejectTimeout: ((reason: Error) => void) | undefined;
          let abortActiveAgent: (() => void) | undefined;

          throwIfRunCancelled(context?.signal);

          const clearRequestTimeout = () => {
            if (requestTimeout) clearTimeout(requestTimeout);
            requestTimeout = undefined;
          };
          const failForTimeout = (message: string) => {
            if (timeoutReason) return;
            timeoutReason = message;
            clearRequestTimeout();
            piAgent?.abort();
            rejectTimeout?.(new AgentBackendError(message));
          };
          const timeoutPromise = new Promise<never>((_resolve, reject) => {
            rejectTimeout = reject;
          });

          try {
            const runtimePrompt = buildRuntimePrompt(
              agent,
              Boolean(tools.length),
              session.sandboxId,
              workspaceDir,
            );
            const activeAgent = new Agent({
              initialState: {
                systemPrompt: runtimePrompt,
                model,
                thinkingLevel: ReasoningLevelSchema.parse(agent.reasoningLevel),
                messages: priorMessages,
                tools,
              },
              sessionId: checkpoint.providerSessionId,
              transformContext: (messages) =>
                Promise.resolve(trimPiContext(messages, historyBudget)),
              toolExecution: "sequential",
              getApiKey: (provider) => resolvePiProviderApiKey(provider),
              onPayload: (_payload, requestModel) => {
                clearRequestTimeout();
                onEvent?.({
                  kind: "model_request_started",
                  rawType: "pi.request_start",
                  model: requestModel.id,
                  provider: requestModel.provider,
                });
                log.info("daytona: model request started", {
                  runId: context?.runId,
                  model: requestModel.id,
                  provider: requestModel.provider,
                });
                requestTimeout = setTimeout(() => {
                  failForTimeout(
                    `Model request timed out after ${config.AGENT_MODEL_REQUEST_TIMEOUT_SECONDS} seconds`,
                  );
                }, config.AGENT_MODEL_REQUEST_TIMEOUT_SECONDS * 1_000);
                return undefined;
              },
            });
            piAgent = activeAgent;
            abortActiveAgent = () => activeAgent.abort();
            context?.signal?.addEventListener("abort", abortActiveAgent, { once: true });
            if (context?.signal?.aborted) activeAgent.abort();

            activeAgent.subscribe((event) => {
              this.handlePiEvent(event, onEvent, (text) => {
                deltaText += text;
              });
              if (event.type === "message_end" && isAssistantMessage(event.message)) {
                clearRequestTimeout();
                finalText = readTextBlocks(event.message);
              }
              if (event.type === "turn_end" && isAssistantMessage(event.message)) {
                const usage = event.message.usage;
                const errorMessage = readAssistantErrorMessage(event.message);
                if (event.message.stopReason === "error") {
                  lastModelError = errorMessage ?? "Model request failed";
                }
                onEvent?.({
                  kind: "model_request",
                  rawType: "pi.turn_end",
                  model: event.message.model,
                  provider: event.message.provider,
                  stopReason: event.message.stopReason,
                  isError: event.message.stopReason === "error",
                  errorMessage,
                  usage: {
                    inputTokens: usage.input,
                    outputTokens: usage.output,
                    cacheCreationInputTokens: usage.cacheWrite,
                    cacheReadInputTokens: usage.cacheRead,
                  },
                });
              }
            });

            const promptMessage = await buildPromptMessage(
              userMessage,
              agent.profileAccessEnabled,
              context,
            );
            runTimeout = setTimeout(() => {
              failForTimeout(
                `Agent run timed out after ${config.AGENT_RUN_TIMEOUT_SECONDS} seconds`,
              );
            }, config.AGENT_RUN_TIMEOUT_SECONDS * 1_000);
            await Promise.race([activeAgent.prompt(promptMessage), timeoutPromise]);
            const output = finalText || deltaText;
            if (context?.signal?.aborted) throw new RunCancelledError(output);
            if (lastModelError && output.trim().length === 0) {
              throw new AgentBackendError(lastModelError);
            }
            if (context) {
              await savePiSessionCheckpoint(
                context.runId,
                trimPiContext(activeAgent.state.messages, historyBudget),
              );
            }
            return output;
          } finally {
            if (abortActiveAgent) {
              context?.signal?.removeEventListener("abort", abortActiveAgent);
            }
            clearRequestTimeout();
            if (runTimeout) clearTimeout(runTimeout);
            await closeThirdPartyMcpConnections(mcpConnections);
          }
        },
        context?.runId,
      );
    } catch (err) {
      if (isRunCancelledError(err)) throw err;
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
      if (update.type === "thinking_start") {
        onEvent?.({
          kind: "reasoning",
          active: true,
          rawType: "pi.thinking_start",
        });
      } else if (update.type === "thinking_end") {
        onEvent?.({
          kind: "reasoning",
          active: false,
          rawType: "pi.thinking_end",
        });
      } else if (update.type === "text_delta" && update.delta) {
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

async function buildPromptMessage(
  userMessage: string,
  profileAccessEnabled: boolean,
  context: AgentRunContext | undefined,
): Promise<string> {
  if (!profileAccessEnabled || !context) return userMessage;
  const profileContext = await buildAuthorProfileContext(context);
  if (!profileContext) return userMessage;
  return `${profileContext}\n\nUser request:\n${userMessage}`;
}

async function loadLegacyPriorMessages(
  context: AgentRunContext,
  model: { api: AssistantMessage["api"]; provider: string; id: string },
): Promise<Message[]> {
  const assistantStub = (): AssistantMessage => ({
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [{ type: "text", text: "" }],
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  });
  if (context.surface === "workflow") {
    // A workflow step's memory is its own prior turns in the same conversation
    // slot (position). Reconstruct user/assistant pairs from prior step runs.
    const stepRun = await prisma.workflowStepRun.findUnique({
      where: { runId: context.runId },
      include: { workflowRun: { select: { conversationId: true } } },
    });
    if (!stepRun) return [];
    const priorSteps = await prisma.workflowStepRun.findMany({
      where: {
        position: stepRun.position,
        status: "succeeded",
        id: { not: stepRun.id },
        workflowRun: { conversationId: stepRun.workflowRun.conversationId },
      },
      orderBy: { createdAt: "asc" },
    });
    return priorSteps.flatMap((row): Message[] => {
      const messages: Message[] = [];
      if (row.inputText) {
        messages.push({
          role: "user",
          content: row.inputText,
          timestamp: row.createdAt.getTime(),
        });
      }
      if (row.output) {
        messages.push({
          ...assistantStub(),
          content: [{ type: "text", text: row.output }],
          timestamp: row.createdAt.getTime(),
        });
      }
      return messages;
    });
  }

  if (context.surface === "chat") {
    const run = await prisma.agentRun.findUnique({ where: { id: context.runId } });
    if (!run?.conversationId) return [];
    const currentMessage = context.chatMessageId
      ? await prisma.chatMessage.findUnique({
          where: { id: context.chatMessageId },
          select: { createdAt: true },
        })
      : null;
    const rows = await prisma.chatMessage.findMany({
      where: {
        conversationId: run.conversationId,
        ...(currentMessage ? { createdAt: { lt: currentMessage.createdAt } } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.flatMap((row): Message[] => {
      if (row.role === "user") {
        return [
          { role: "user", content: row.content, timestamp: row.createdAt.getTime() },
        ];
      }
      if (row.role === "assistant") {
        return [
          {
            ...assistantStub(),
            content: [{ type: "text", text: row.content }],
            timestamp: row.createdAt.getTime(),
          },
        ];
      }
      return [];
    });
  }

  const run = await prisma.agentRun.findUnique({ where: { id: context.runId } });
  if (!run?.threadId) return [];
  const currentMessage = context.emailMessageId
    ? await prisma.emailMessage.findUnique({
        where: { id: context.emailMessageId },
        select: { createdAt: true },
      })
    : null;
  const rows = await prisma.emailMessage.findMany({
    where: {
      threadId: run.threadId,
      ...(currentMessage ? { createdAt: { lt: currentMessage.createdAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row): Message => {
    if (row.direction === "outbound") {
      return {
        ...assistantStub(),
        content: [{ type: "text", text: row.body }],
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
        `Uploaded files are available under ${workspaceDir}/inbox. If older prompts or skills mention /workspace, interpret that prefix as ${workspaceDir}.`,
        "Use tools to inspect files, write artifacts, and run commands when useful.",
        "Bash uses a persistent shell session in the sandbox (cwd and env persist between calls).",
        "For web pages or search, use curl/wget in bash or bind a third-party MCP search tool — there is no built-in web_search.",
        "Platform tools (for example memory_*) and third-party MCP tools (name prefix server:tool) run on the orchestrator host, not inside the sandbox.",
        "When the user needs a downloadable file, call attach_run_file with the sandbox path.",
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
  runId?: string,
): AgentTool[] {
  const bound = boundManagedTools(agent);
  const tools: AgentTool[] = [];
  const maxOutput = sandboxPolicy.command.maxOutputChars;

  if (runId) tools.push(attachRunFileTool(sandbox, runId, workspaceDir));

  if (bound.has("bash"))
    tools.push(bashTool(sandbox, workspaceDir, sandboxPolicy, maxOutput, onEvent));
  if (bound.has("read")) tools.push(readTool(sandbox, workspaceDir));
  if (bound.has("write")) tools.push(writeTool(sandbox, workspaceDir));
  if (bound.has("edit")) tools.push(editTool(sandbox, workspaceDir));
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

function attachRunFileTool(
  sandbox: Sandbox,
  runId: string,
  workspaceDir: string,
): AgentTool {
  return makeTool({
    name: "attach_run_file",
    label: "Attach run file",
    description:
      "Upload a file from this sandbox to the current run as a downloadable attachment for chat, email, or workflow. Prefer this over markdown sandbox: links or curl for returning artifacts.",
    parameters: Type.Object({
      path: Type.String({
        description: `Path in the sandbox (absolute or relative to ${workspaceDir}).`,
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
      const remotePath = resolveSandboxPath(p.path, workspaceDir);
      const bytes = await sandbox.fs.downloadFile(remotePath);
      const buf = Buffer.from(bytes);
      const filename = p.filename?.trim() ?? path.basename(remotePath) ?? "attachment";
      const contentType = p.contentType?.trim() ?? "application/octet-stream";
      const stored = await storeRunAttachment(runId, filename, contentType, buf);
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
        cwd: p.cwd ? resolveSandboxPath(p.cwd, workspaceDir) : workspaceDir,
        workspaceDir,
        timeoutSeconds: p.timeoutSeconds,
        policy: sandboxPolicy,
        onOutput: (chunk) =>
          emitToolOutput(onEvent, "bash", toolCallId, chunk.stream, chunk.text),
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

function readTool(sandbox: Sandbox, workspaceDir: string): AgentTool {
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
      const remotePath = resolveSandboxPath(p.path, workspaceDir);
      const bytes = await sandbox.fs.downloadFile(remotePath);
      const raw = bytes.toString("utf8");
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

function writeTool(sandbox: Sandbox, workspaceDir: string): AgentTool {
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
      const remotePath = resolveSandboxPath(p.path, workspaceDir);
      await ensureSandboxDir(sandbox.fs, path.dirname(remotePath));
      await sandbox.fs.uploadFile(Buffer.from(p.content, "utf8"), remotePath);
      return {
        content: [
          { type: "text", text: `Wrote ${p.content.length} chars to ${remotePath}` },
        ],
        details: { path: remotePath, requestedPath: p.path, chars: p.content.length },
      };
    },
  });
}

function editTool(sandbox: Sandbox, workspaceDir: string): AgentTool {
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
      const remotePath = resolveSandboxPath(p.path, workspaceDir);
      const original = (await sandbox.fs.downloadFile(remotePath)).toString("utf8");
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
      await sandbox.fs.uploadFile(Buffer.from(updated, "utf8"), remotePath);
      return {
        content: [{ type: "text", text: `Edited ${remotePath}` }],
        details: { path: remotePath, requestedPath: p.path },
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
      const root = p.root ? resolveSandboxPath(p.root, workspaceDir) : workspaceDir;
      const result = await sandbox.fs.searchFiles(root, p.pattern);
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
      const root = p.root ? resolveSandboxPath(p.root, workspaceDir) : workspaceDir;
      const command = `grep -RIn --exclude-dir=.git -e ${shellQuote(p.pattern)} ${shellQuote(root)} || true`;
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
