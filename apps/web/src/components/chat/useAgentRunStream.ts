import { useEffect, useRef, useState } from "react";
import type { SubagentItem } from "./AiChat";

export type AgentRunTerminalEvent = {
  type: "run.succeeded" | "run.failed" | "run.cancelled";
  payload: Record<string, unknown>;
};

type StreamEvent = {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
};

type SubagentInner = {
  kind: string;
  toolName?: string;
  text?: string;
  callId?: string;
  isError?: boolean;
  stream?: "stdout" | "stderr";
};

export type LiveToolCall = {
  callId: string;
  toolName: string;
  output: string;
  done: boolean;
  args?: Record<string, unknown>;
  isError?: boolean;
  subagentSlug?: string;
  subagentItems?: SubagentItem[];
};

export type AgentRunStreamState = {
  text: string;
  reasoning: boolean;
  toolCalls: LiveToolCall[];
};

const EMPTY_RUN_STATE: AgentRunStreamState = {
  text: "",
  reasoning: false,
  toolCalls: [],
};

const RUN_EVENT_TYPES = [
  "agent.reasoning",
  "agent.delta",
  "agent.message",
  "tool.use",
  "tool.output",
  "tool.result",
  "subagent.event",
  "run.succeeded",
  "run.failed",
  "run.cancelled",
] as const;

function appendToolOutput(
  toolCalls: LiveToolCall[],
  callId: string,
  toolName: string,
  chunk: string,
): LiveToolCall[] {
  const index = toolCalls.findIndex((tool) => tool.callId === callId);
  if (index < 0) {
    return [...toolCalls, { callId, toolName, output: chunk, done: false }];
  }
  const current = toolCalls[index];
  if (!current) return toolCalls;
  const next = [...toolCalls];
  next[index] = { ...current, output: current.output + chunk };
  return next;
}

function applySubagentEvent(
  toolCalls: LiveToolCall[],
  toolCallId: string,
  slug: string,
  inner: SubagentInner,
): LiveToolCall[] {
  const index = toolCalls.findIndex((tool) => tool.callId === toolCallId);
  if (index < 0) return toolCalls;
  const current = toolCalls[index];
  if (!current) return toolCalls;
  const items = [...(current.subagentItems ?? [])];

  const upsertTool = (
    update: (tool: Extract<SubagentItem, { type: "tool" }>) => void,
  ) => {
    const itemIndex = items.findIndex(
      (item) => item.type === "tool" && item.callId === (inner.callId ?? ""),
    );
    if (itemIndex >= 0) {
      const existing = items[itemIndex] as Extract<SubagentItem, { type: "tool" }>;
      const next = { ...existing };
      update(next);
      items[itemIndex] = next;
      return;
    }
    const created: Extract<SubagentItem, { type: "tool" }> = {
      type: "tool",
      callId: inner.callId ?? `sub-${items.length}`,
      toolName: inner.toolName ?? "tool",
      output: "",
      done: false,
    };
    update(created);
    items.push(created);
  };

  if (inner.kind === "tool_use") {
    upsertTool(() => undefined);
  } else if (inner.kind === "tool_output") {
    upsertTool((tool) => {
      const prefix = inner.stream === "stderr" ? "[stderr] " : "";
      tool.output += `${prefix}${inner.text ?? ""}`;
    });
  } else if (inner.kind === "tool_result") {
    upsertTool((tool) => {
      tool.done = true;
      if (inner.text) tool.output = inner.text;
    });
  } else if (inner.kind === "message" && inner.text) {
    items.push({ type: "message", text: inner.text });
  } else if (inner.kind === "session_error" && inner.text) {
    items.push({ type: "message", text: inner.text, isError: true });
  }

  const next = [...toolCalls];
  next[index] = { ...current, subagentSlug: slug, subagentItems: items };
  return next;
}

function foldRunEvent(
  state: AgentRunStreamState,
  event: StreamEvent,
): AgentRunStreamState {
  const payload = event.payload;
  if (event.type === "agent.reasoning" && typeof payload.active === "boolean") {
    return { ...state, reasoning: payload.active };
  }
  if (event.type === "agent.delta" && typeof payload.text === "string") {
    return { ...state, reasoning: false, text: state.text + payload.text };
  }
  if (event.type === "agent.message" && typeof payload.text === "string") {
    return { ...state, reasoning: false, text: payload.text };
  }
  if (event.type === "tool.use" && typeof payload.toolName === "string") {
    const callId =
      typeof payload.callId === "string" ? payload.callId : `seq-${event.seq}`;
    if (state.toolCalls.some((tool) => tool.callId === callId)) return state;
    const args =
      typeof payload.args === "object" && payload.args !== null
        ? (payload.args as Record<string, unknown>)
        : undefined;
    return {
      ...state,
      reasoning: false,
      toolCalls: [
        ...state.toolCalls,
        { callId, toolName: payload.toolName, output: "", done: false, args },
      ],
    };
  }
  if (event.type === "tool.output" && typeof payload.toolName === "string") {
    if (typeof payload.text !== "string") return state;
    const callId =
      typeof payload.callId === "string"
        ? payload.callId
        : (state.toolCalls.findLast((tool) => tool.toolName === payload.toolName)
            ?.callId ?? `unknown-${payload.toolName}`);
    const prefix = payload.stream === "stderr" ? "[stderr] " : "";
    return {
      ...state,
      toolCalls: appendToolOutput(
        state.toolCalls,
        callId,
        payload.toolName,
        `${prefix}${payload.text}`,
      ),
    };
  }
  if (event.type === "tool.result" && typeof payload.toolName === "string") {
    const callId =
      typeof payload.callId === "string" ? payload.callId : `seq-${event.seq}`;
    const resultText =
      typeof payload.result === "string"
        ? payload.result
        : payload.result !== undefined
          ? JSON.stringify(payload.result, null, 2)
          : payload.isError
            ? "[tool error]"
            : "";
    const normalized =
      resultText && !resultText.endsWith("\n") ? `${resultText}\n` : resultText;
    const index = state.toolCalls.findIndex((tool) => tool.callId === callId);
    if (index < 0) {
      return {
        ...state,
        toolCalls: [
          ...state.toolCalls,
          {
            callId,
            toolName: payload.toolName,
            output: normalized,
            done: true,
            isError: payload.isError === true,
          },
        ],
      };
    }
    const current = state.toolCalls[index];
    if (!current) return state;
    const toolCalls = [...state.toolCalls];
    toolCalls[index] = {
      ...current,
      output: normalized || current.output,
      done: true,
      isError: payload.isError === true,
    };
    return { ...state, toolCalls };
  }
  if (
    event.type === "subagent.event" &&
    typeof payload.toolCallId === "string" &&
    typeof payload.slug === "string" &&
    typeof payload.inner === "object" &&
    payload.inner !== null
  ) {
    return {
      ...state,
      toolCalls: applySubagentEvent(
        state.toolCalls,
        payload.toolCallId,
        payload.slug,
        payload.inner as SubagentInner,
      ),
    };
  }
  return state;
}

export function useAgentRunStream({
  runId,
  eventUrl,
  onTerminal,
}: {
  runId: string | null;
  eventUrl: string | null;
  onTerminal: (event: AgentRunTerminalEvent, runId: string) => void;
}): AgentRunStreamState {
  const [state, setState] = useState<AgentRunStreamState>(EMPTY_RUN_STATE);
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  useEffect(() => {
    setState(EMPTY_RUN_STATE);
    if (!runId || !eventUrl) return;

    const source = new EventSource(eventUrl, { withCredentials: true });
    const handle = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as StreamEvent;
        if (
          event.type === "run.succeeded" ||
          event.type === "run.failed" ||
          event.type === "run.cancelled"
        ) {
          source.close();
          onTerminalRef.current({ type: event.type, payload: event.payload }, runId);
          return;
        }
        setState((current) => foldRunEvent(current, event));
      } catch {
        // Ignore malformed events; EventSource keeps the durable stream alive.
      }
    };

    for (const type of RUN_EVENT_TYPES) {
      source.addEventListener(type, handle as EventListener);
    }
    return () => source.close();
  }, [eventUrl, runId]);

  return state;
}
