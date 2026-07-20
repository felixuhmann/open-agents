import { getAgentBackend } from "../agent-backend/instance.js";
import type { AgentEventHandler, AgentRunContext } from "../agent-backend/types.js";
import { appendEvent } from "../runs/events.js";
import { redactToolArgs, summarizeToolResultForRunLog } from "./runObservability.js";

/**
 * Stream one OpenSandbox agent turn into the run's RunEvent log + NOTIFY. Shared
 * by the chat/email worker (`runAgent`) and the workflow pipeline runner
 * (`runWorkflow`). The optional `extraHandler` receives the same normalized
 * backend events so callers can forward them onto another surface (the
 * workflow runner forwards token deltas onto its WorkflowRunEvent stream).
 *
 * Returns the final aggregated assistant text.
 */
export async function streamRunWithEvents(
  runId: string,
  sessionId: string,
  userMessage: string,
  context: AgentRunContext,
  extraHandler?: AgentEventHandler,
): Promise<string> {
  const backend = getAgentBackend();
  return backend.streamUntilIdle(
    sessionId,
    userMessage,
    (event) => {
      extraHandler?.(event);
      if (event.kind === "reasoning") {
        void appendEvent({
          runId,
          type: "agent.reasoning",
          payload: {
            type: "agent.reasoning",
            active: event.active,
            rawType: event.rawType,
          },
        }).catch(() => undefined);
      } else if (event.kind === "delta") {
        void appendEvent({
          runId,
          type: "agent.delta",
          payload: {
            type: "agent.delta",
            text: event.text,
            rawType: event.rawType,
          },
        }).catch(() => undefined);
      } else if (event.kind === "message") {
        void appendEvent({
          runId,
          type: "agent.message",
          payload: {
            type: "agent.message",
            text: event.text,
            rawType: event.rawType,
          },
        }).catch(() => undefined);
      } else if (event.kind === "tool_use") {
        void appendEvent({
          runId,
          type: "tool.use",
          payload: {
            type: "tool.use",
            toolName: event.toolName,
            rawType: event.rawType,
            ...(event.callId ? { callId: event.callId } : {}),
            ...(event.args !== undefined ? { args: redactToolArgs(event.args) } : {}),
          },
        }).catch(() => undefined);
      } else if (event.kind === "tool_output") {
        void appendEvent({
          runId,
          type: "tool.output",
          payload: {
            type: "tool.output",
            toolName: event.toolName,
            stream: event.stream,
            text: event.text,
            rawType: event.rawType,
            ...(event.callId ? { callId: event.callId } : {}),
          },
        }).catch(() => undefined);
      } else if (event.kind === "tool_result") {
        void appendEvent({
          runId,
          type: "tool.result",
          payload: {
            type: "tool.result",
            toolName: event.toolName,
            rawType: event.rawType,
            ...(event.callId ? { callId: event.callId } : {}),
            ...(event.result !== undefined
              ? { result: summarizeToolResultForRunLog(event.result) }
              : {}),
            ...(event.isError !== undefined ? { isError: event.isError } : {}),
          },
        }).catch(() => undefined);
      } else if (event.kind === "model_request_started") {
        void appendEvent({
          runId,
          type: "model.request.started",
          payload: {
            type: "model.request.started",
            model: event.model,
            provider: event.provider,
            rawType: event.rawType,
          },
        }).catch(() => undefined);
      } else if (event.kind === "model_request") {
        void appendEvent({
          runId,
          type: "model.request",
          payload: {
            type: "model.request",
            model: event.model,
            provider: event.provider,
            stopReason: event.stopReason,
            isError: event.isError,
            ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
            rawType: event.rawType,
            usage: event.usage,
          },
        }).catch(() => undefined);
      } else if (event.kind === "session_error") {
        void appendEvent({
          runId,
          type: "session.error",
          payload: {
            type: "session.error",
            message: event.message,
            rawType: event.rawType,
          },
        }).catch(() => undefined);
      }
    },
    context,
  );
}
