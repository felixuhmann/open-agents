import type Anthropic from "@anthropic-ai/sdk";
import { toFile } from "@anthropic-ai/sdk";
import type { BetaManagedAgentsStreamSessionEvents } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { log } from "../log.js";
import {
  AgentBackendError,
  type AgentBackend,
  type AgentEventHandler,
  type AgentFile,
  type AgentSession,
  type AgentStreamEvent,
  type CreateSessionInput,
  type UploadFileInput,
} from "./types.js";

/**
 * Anthropic-backed implementation of `AgentBackend`. Wraps the Managed
 * Agents beta endpoints via the official `@anthropic-ai/sdk` client. The
 * SDK manages beta headers (`managed-agents-2026-04-01`,
 * `files-api-2025-04-14`) automatically on the relevant `client.beta.*`
 * resources, so we don't pin them by hand.
 *
 * The vault IDs are passed at construction time (rather than per call)
 * because `vault_ids` is an Anthropic-specific concept that we don't want
 * leaking into the generic `AgentBackend` surface.
 */
export class AnthropicAgentBackend implements AgentBackend {
  constructor(
    private readonly client: Anthropic,
    private readonly vaultIds: readonly string[] = [],
  ) {}

  async createSession(input: CreateSessionInput): Promise<AgentSession> {
    log.info("anthropic: createSession start", {
      agentId: input.agentId,
      environmentId: input.environmentId,
      title: input.title,
      resourcesCount: input.resources?.length ?? 0,
      vaultCount: this.vaultIds.length,
    });
    const start = Date.now();
    try {
      const session = await this.client.beta.sessions.create({
        agent: input.agentId,
        environment_id: input.environmentId,
        ...(input.title ? { title: input.title } : {}),
        ...(input.resources && input.resources.length > 0
          ? {
              resources: input.resources.map((r) => ({
                type: "file" as const,
                file_id: r.fileId,
                mount_path: r.mountPath,
              })),
            }
          : {}),
        ...(this.vaultIds.length > 0 ? { vault_ids: [...this.vaultIds] } : {}),
      });
      log.info("anthropic: createSession ok", {
        sessionId: session.id,
        durationMs: Date.now() - start,
      });
      return { id: session.id };
    } catch (err) {
      log.error("anthropic: createSession failed", {
        durationMs: Date.now() - start,
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Posts a `user.message` event and consumes the SSE stream until the
   * session settles. Stream-first ordering — open the stream before
   * sending so we don't miss early events. Idle break gates on a terminal
   * `stop_reason` (`end_turn` or `retries_exhausted`); `requires_action`
   * keeps the loop spinning since it indicates the agent is awaiting a
   * client-side event we don't currently produce. `session.status_terminated`
   * is the only true "session is over" signal for the failure path —
   * `session.error` is non-fatal (e.g. MCP auth failures surface there but
   * the session keeps running).
   */
  async streamUntilIdle(
    sessionId: string,
    userMessage: string,
    onEvent?: AgentEventHandler,
  ): Promise<string> {
    const streamStart = Date.now();
    log.info("anthropic: streamUntilIdle open", { sessionId });

    const stream = await this.client.beta.sessions.events.stream(sessionId);

    log.info("anthropic: sendUserMessage", {
      sessionId,
      textChars: userMessage.length,
    });
    await this.client.beta.sessions.events.send(sessionId, {
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: userMessage }],
        },
      ],
    });

    let lastAgentText = "";
    const assistantChunks: string[] = [];
    const eventCounts = new Map<string, number>();

    const finish = (reason: string): string => {
      log.info("anthropic: stream done", {
        sessionId,
        reason,
        durationMs: Date.now() - streamStart,
        eventCounts: Object.fromEntries(eventCounts),
        outputChars: (lastAgentText || assistantChunks.join("")).length,
      });
      return lastAgentText || assistantChunks.join("");
    };

    for await (const event of stream) {
      eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1);

      const normalized = normalizeEvent(event);
      if (event.type !== "agent.message") {
        log.info("anthropic: stream event", {
          sessionId,
          type: event.type,
          ...(normalized.kind === "tool_use" ? { tool: normalized.toolName } : {}),
        });
      }
      onEvent?.(normalized);

      if (event.type === "agent.message") {
        const text = event.content
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("");
        if (text) {
          lastAgentText = text;
          assistantChunks.push(text);
          log.info("anthropic: agent message", {
            sessionId,
            chars: text.length,
            preview: text.slice(0, 120),
          });
        }
      }

      if (event.type === "session.status_terminated") {
        return finish("session.status_terminated");
      }

      if (event.type === "session.status_idle") {
        const reasonType = event.stop_reason.type;
        if (reasonType === "requires_action") {
          // Transient idle: agent is waiting on a `user.tool_confirmation`
          // or `user.custom_tool_result`. We don't currently issue either,
          // so this branch is defensive — keep the stream open in case a
          // future tool surface starts triggering it.
          continue;
        }
        if (reasonType === "retries_exhausted") {
          throw new AgentBackendError(
            `Session ended with retries_exhausted (sessionId=${sessionId})`,
          );
        }
        return finish("session.status_idle");
      }

      if (event.type === "session.error") {
        log.error("anthropic: session error event", {
          sessionId,
          error: event.error,
        });
      }
    }

    return finish("stream closed");
  }

  async uploadFile(input: UploadFileInput): Promise<AgentFile> {
    const file = await toFile(input.bytes, input.filename, {
      type: input.mime,
    });
    const result = await this.client.beta.files.upload({ file });
    return { id: result.id };
  }
}

function normalizeEvent(event: BetaManagedAgentsStreamSessionEvents): AgentStreamEvent {
  if (event.type === "agent.message") {
    const text = event.content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    return { kind: "message", text, rawType: event.type };
  }
  if (event.type === "agent.tool_use") {
    return { kind: "tool_use", toolName: event.name, rawType: event.type };
  }
  if (event.type === "agent.mcp_tool_use") {
    return {
      kind: "tool_use",
      toolName: `${event.mcp_server_name}:${event.name}`,
      rawType: event.type,
    };
  }
  if (event.type === "agent.custom_tool_use") {
    return { kind: "tool_use", toolName: event.name, rawType: event.type };
  }
  if (event.type === "span.model_request_end") {
    const usage = event.model_usage;
    return {
      kind: "model_request",
      rawType: event.type,
      model: readStringField(event, "model"),
      isError: readBooleanField(event, "is_error"),
      usage: {
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
      },
    };
  }
  if (event.type === "session.error") {
    return {
      kind: "session_error",
      rawType: event.type,
      message: readStringField(event, "error") ?? "Session error",
    };
  }
  return { kind: "other", rawType: event.type };
}

function readStringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : null;
}

function readBooleanField(value: unknown, key: string): boolean | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "boolean" ? field : undefined;
}
