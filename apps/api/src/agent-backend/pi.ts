import { randomUUID } from "node:crypto";
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import {
  ReasoningLevelSchema,
  type SandboxPolicyBundle,
  type SandboxResourceMounted,
} from "@open-agents/types";
import { buildSandboxSessionId, parseSandboxSessionId } from "../sandbox-provider/sessionId.js";
import type { SandboxProviderRegistry } from "../sandbox-provider/registry.js";
import type {
  SandboxHandle,
  SandboxProvider,
  SandboxProviderId,
} from "../sandbox-provider/types.js";
import {
  emitSandboxRunEvent,
  sandboxContextFromSession,
  summarizeToolResultForRunLog,
} from "../services/runObservability.js";
import { DEFAULT_DAYTONA_LIFECYCLE } from "../services/sandboxLifecyclePolicy.js";
import {
  resolveDraftSandboxPolicy,
  resolvePublishedSandboxPolicy,
  DEFAULT_SANDBOX_COMMAND_POLICY,
  DEFAULT_SANDBOX_NETWORK_POLICY,
} from "../services/sandboxPolicy.js";
import { registerAgentSandbox, touchSandboxActivity } from "../services/sandboxes.js";
import { buildAuthorProfileContext } from "../services/userProfileContext.js";
import {
  isRunCancelledError,
  RunCancelledError,
  throwIfRunCancelled,
} from "../services/runCancellation.js";
import { AgentBackendError } from "./types.js";
import { buildRuntimePrompt } from "./prompt.js";
import { buildSandboxTools, resolveSandboxPath } from "./sandboxTools.js";
import { piHistoryTokenBudget, trimPiContext } from "./piSessionContext.js";
import {
  loadPiSessionCheckpoint,
  savePiSessionCheckpoint,
} from "./piSessionPersistence.js";
import { getAgentById, listAgentMcpServers } from "../agents/service.js";
import { loadVersionedAgent, type VersionedAgent } from "../agents/snapshot.js";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { log } from "../log.js";
import { buildMcpPiTools, closeThirdPartyMcpConnections } from "../mcp/piTools.js";
import { buildSubagentPiTools } from "../mcp/subagentTools.js";
import { loadMcpServerBearerMap } from "../mcp/mcpServerSecrets.js";
import { materializeAgentSkills } from "../services/materializeSkills.js";
import { storeRunAttachment } from "../services/runAttachments.js";
import { resolvePiModel, resolvePiProviderApiKey } from "../services/piModel.js";
import type {
  AgentBackend,
  AgentEventHandler,
  AgentFile,
  AgentRunContext,
  AgentSession,
  CreateSessionInput,
  RunObservabilityContext,
  SessionResource,
  UploadFileInput,
} from "./types.js";

/**
 * Provider-neutral agent runtime: Pi drives the model/tool loop, a
 * {@link SandboxHandle} supplies workspace execution. The same code runs on
 * every sandbox provider; nothing here knows which one it is beyond the
 * `provider` label carried on session ids and run events.
 */

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

const FALLBACK_POLICY: SandboxPolicyBundle = {
  network: { ...DEFAULT_SANDBOX_NETWORK_POLICY },
  command: { ...DEFAULT_SANDBOX_COMMAND_POLICY },
};

export type PiAgentBackendDeps = {
  registry: SandboxProviderRegistry;
  /** Provider new sandboxes are created on, deployment-wide. */
  activeProviderId: () => Promise<SandboxProviderId>;
};

export class PiAgentBackend implements AgentBackend {
  readonly runtime = "pi" as const;

  constructor(private readonly deps: PiAgentBackendDeps) {}

  async createSession(input: CreateSessionInput): Promise<AgentSession> {
    const provider = await this.deps.registry.get(await this.deps.activeProviderId());
    const lifecycle = DEFAULT_DAYTONA_LIFECYCLE;
    const baseAgent = await getAgentById(input.agentId);
    let sandboxPolicy: SandboxPolicyBundle = baseAgent
      ? resolveDraftSandboxPolicy(baseAgent)
      : FALLBACK_POLICY;
    if (baseAgent && input.agentVersionId) {
      const versioned = await loadVersionedAgent(baseAgent, input.agentVersionId);
      sandboxPolicy = resolvePublishedSandboxPolicy(versioned.configSnapshot);
    }

    // Fail before creating anything the provider cannot honor.
    provider.validatePolicy(sandboxPolicy);

    const handle = await provider.create({
      agentId: input.agentId,
      agentSlug: input.agentSlug,
      policy: sandboxPolicy,
      lifecycle,
    });

    const sessionId = buildSandboxSessionId(
      provider.id,
      input.agentId,
      handle.providerSandboxId,
    );

    await this.materializeResources(
      handle,
      input.resources ?? [],
      input.observability ? { runId: input.observability.runId, sessionId } : undefined,
    );

    let skillsManifest;
    const skillBindings =
      input.agentVersionId && baseAgent
        ? (await loadVersionedAgent(baseAgent, input.agentVersionId)).skillBindings
        : baseAgent?.skillBindings;
    if (skillBindings?.length) {
      skillsManifest = await materializeAgentSkills(
        handle,
        skillBindings,
        handle.workspaceDir,
      );
    }

    await registerAgentSandbox({
      provider: provider.id,
      agentId: input.agentId,
      providerSandboxId: handle.providerSandboxId,
      sessionId,
      lifecyclePolicy: lifecycle,
      surface: input.surface,
      conversationId: input.conversationId,
      threadId: input.threadId,
      state: handle.state,
    });

    if (input.observability) {
      const ctx = sandboxContextFromSession(sessionId, handle.workspaceDir, handle.state);
      await emitSandboxRunEvent(input.observability.runId, "sandbox.created", {
        type: "sandbox.created",
        ...ctx,
      });
    }

    log.info("sandbox: session created", {
      provider: provider.id,
      agentId: input.agentId,
      providerSandboxId: handle.providerSandboxId,
      workspaceDir: handle.workspaceDir,
      resources: input.resources?.length ?? 0,
      skillsMaterialized: skillsManifest?.materialized ?? 0,
      skillsFailed: skillsManifest?.failed ?? 0,
    });

    return {
      id: sessionId,
      skillsManifest,
      provider: provider.id,
      providerSandboxId: handle.providerSandboxId,
      workspaceDir: handle.workspaceDir,
    };
  }

  async mountSessionResources(
    sessionId: string,
    resources: SessionResource[],
    observability?: RunObservabilityContext,
  ): Promise<void> {
    if (!resources.length) return;
    await this.withHandle(
      sessionId,
      async (handle) => {
        await this.materializeResources(
          handle,
          resources,
          observability ? { runId: observability.runId, sessionId } : undefined,
        );
      },
      observability?.runId,
    );
    log.info("sandbox: mounted session resources", {
      sessionId,
      resourceCount: resources.length,
    });
  }

  async streamUntilIdle(
    sessionId: string,
    userMessage: string,
    onEvent?: AgentEventHandler,
    context?: AgentRunContext,
  ): Promise<string> {
    const session = parseSandboxSessionId(sessionId);
    try {
      const agentId = context?.agentId ?? session.agentId;
      const baseAgent = await getAgentById(agentId);
      if (!baseAgent) throw new AgentBackendError(`Agent not found: ${agentId}`);

      const agent = context?.agentVersionId
        ? await loadVersionedAgent(baseAgent, context.agentVersionId)
        : baseAgent;
      const sandboxPolicy = context?.agentVersionId
        ? resolvePublishedSandboxPolicy((agent as VersionedAgent).configSnapshot)
        : resolveDraftSandboxPolicy(agent);

      return await this.withHandle(
        sessionId,
        async (handle) => {
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
            {
              sandbox: {
                workspaceDir: handle.workspaceDir,
                writeFile: (path, bytes) => handle.writeFile(path, bytes),
                makeDir: (path) => handle.makeDir(path),
                downloadFile: async (input) =>
                  Buffer.from(
                    await handle.readFile(
                      resolveSandboxPath(input, handle.workspaceDir),
                    ),
                  ),
              },
            },
          );
          const subagentTools = buildSubagentPiTools(agent, {
            parentRunId: context?.runId,
            parentSurface: context?.surface ?? "chat",
            depth: context?.delegationDepth ?? 0,
            ancestors: context?.delegationAncestors ?? [agentId],
          });
          const tools = [
            ...buildSandboxTools({
              agent,
              handle,
              policy: sandboxPolicy,
              onEvent,
              runId: context?.runId,
              deps: { storeRunAttachment },
            }),
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
            const runtimePrompt = buildRuntimePrompt({
              agent,
              hasTools: Boolean(tools.length),
              providerSandboxId: session.providerSandboxId,
              workspaceDir: handle.workspaceDir,
            });
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
                log.info("pi: model request started", {
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
              handlePiEvent(event, onEvent, (text) => {
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
      const wrapped =
        err instanceof AgentBackendError
          ? err
          : new AgentBackendError(
              `Sandbox run failed: ${err instanceof Error ? err.message : String(err)}`,
              { cause: err },
            );
      onEvent?.({
        kind: "session_error",
        rawType: `${session.provider}.error`,
        message: wrapped.message,
      });
      throw wrapped;
    }
  }

  uploadFile(_input: UploadFileInput): Promise<AgentFile> {
    // No provider has a separate Files API at this layer. The worker passes
    // newly-uploaded bytes through SessionResource so createSession can
    // materialize them directly.
    return Promise.resolve({ id: `sandbox-file-${randomUUID()}` });
  }

  /**
   * Connect to the sandbox a session id names — always through that
   * session's own recorded provider, never the currently active one, so
   * historical rows keep working after a provider switch.
   */
  private async withHandle<T>(
    sessionId: string,
    fn: (handle: SandboxHandle) => Promise<T>,
    observabilityRunId?: string,
  ): Promise<T> {
    const session = parseSandboxSessionId(sessionId);
    const provider: SandboxProvider = await this.deps.registry.get(session.provider);

    const connected = provider.connectWithTransitions
      ? await provider.connectWithTransitions(session.providerSandboxId)
      : {
          handle: await provider.connect(session.providerSandboxId),
          previousState: "unknown",
          transitions: [] as ("recover" | "start")[],
        };
    const { handle, previousState, transitions } = connected;

    if (observabilityRunId) {
      const ctx = sandboxContextFromSession(
        sessionId,
        handle.workspaceDir,
        handle.state,
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
    return fn(handle);
  }

  private async materializeResources(
    handle: SandboxHandle,
    resources: SessionResource[],
    observability?: { runId: string; sessionId: string },
  ): Promise<void> {
    const mounted: SandboxResourceMounted[] = [];
    for (const resource of resources) {
      if (!resource.bytes) continue;
      const remotePath = resolveSandboxPath(resource.mountPath, handle.workspaceDir);
      await handle.writeFile(remotePath, resource.bytes);
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
          handle.workspaceDir,
          handle.state,
        ),
        resources: mounted,
      });
    }
  }
}

function handlePiEvent(
  event: AgentEvent,
  onEvent: AgentEventHandler | undefined,
  onDelta: (text: string) => void,
): void {
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (update.type === "thinking_start") {
      onEvent?.({ kind: "reasoning", active: true, rawType: "pi.thinking_start" });
    } else if (update.type === "thinking_end") {
      onEvent?.({ kind: "reasoning", active: false, rawType: "pi.thinking_end" });
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
