import type { AgentMessage } from "@earendil-works/pi-agent-core";

type JsonRecord = Record<string, unknown>;

const PERSISTED_ROLES = new Set(["user", "assistant", "toolResult"]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasTimestamp(value: JsonRecord): boolean {
  return typeof value.timestamp === "number" && Number.isFinite(value.timestamp);
}

function isPersistableMessage(value: unknown): value is AgentMessage {
  if (
    !isRecord(value) ||
    typeof value.role !== "string" ||
    !PERSISTED_ROLES.has(value.role)
  ) {
    return false;
  }
  if (!hasTimestamp(value)) return false;

  if (value.role === "user") {
    return typeof value.content === "string" || Array.isArray(value.content);
  }
  if (value.role === "assistant") {
    return (
      typeof value.api === "string" &&
      typeof value.provider === "string" &&
      typeof value.model === "string" &&
      Array.isArray(value.content) &&
      isRecord(value.usage) &&
      typeof value.stopReason === "string"
    );
  }
  return (
    typeof value.toolCallId === "string" &&
    typeof value.toolName === "string" &&
    Array.isArray(value.content) &&
    typeof value.isError === "boolean"
  );
}

/**
 * Convert Pi's in-memory context to plain JSON for Postgres. Only messages that
 * can be replayed to an LLM are retained; UI/extension-only messages stay out
 * of model context.
 */
export function serializePiContext(messages: readonly AgentMessage[]): unknown[] {
  const replayable = messages.filter(isPersistableMessage);
  return JSON.parse(JSON.stringify(replayable)) as unknown[];
}

/** Restore and minimally validate a persisted Pi context before model replay. */
export function parsePiContext(value: unknown): AgentMessage[] {
  if (!Array.isArray(value)) return [];
  return structuredClone(value.filter(isPersistableMessage));
}

/** Reserve 40% of the model window for instructions, tools, the new turn, and output. */
export function piHistoryTokenBudget(contextWindow: number): number {
  return Math.max(1, Math.floor(contextWindow * 0.6));
}

function estimateTokens(messages: readonly AgentMessage[]): number {
  // A conservative provider-independent approximation. Pi/provider adapters do
  // the authoritative token accounting on the actual request.
  return Math.ceil(JSON.stringify(messages).length / 4);
}

function groupByUserTurn(messages: readonly AgentMessage[]): AgentMessage[][] {
  const groups: AgentMessage[][] = [];
  for (const message of messages) {
    if (message.role === "user" || groups.length === 0) {
      groups.push([message]);
    } else {
      groups[groups.length - 1]!.push(message);
    }
  }
  return groups;
}

/**
 * Keep the newest complete user turns within the history budget. Never cut an
 * assistant tool-call away from its tool results. The latest turn is retained
 * even when one unusually large tool result exceeds the target by itself.
 */
export function trimPiContext(
  messages: readonly AgentMessage[],
  maxTokens: number,
): AgentMessage[] {
  const replayable = messages.filter(isPersistableMessage);
  if (estimateTokens(replayable) <= maxTokens) return structuredClone(replayable);

  const groups = groupByUserTurn(replayable);
  const selected: AgentMessage[][] = [];
  let used = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]!;
    const tokens = estimateTokens(group);
    if (selected.length > 0 && used + tokens > maxTokens) break;
    selected.unshift(group);
    used += tokens;
  }
  return structuredClone(selected.flat());
}
