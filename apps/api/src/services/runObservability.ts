import type {
  RunEventPayload,
  RunEventTypes,
  SandboxRunEventContext,
} from "@open-agents/types";
import { appendEvent } from "../runs/events.js";
import { MAX_TOOL_OUTPUT_CHARS, truncateText } from "./daytonaLimits.js";
import { buildDaytonaSessionId, parseDaytonaSessionId } from "./daytonaSandbox.js";

const SENSITIVE_KEY =
  /secret|password|token|api[_-]?key|authorization|bearer|credential|private[_-]?key/i;

export function redactStringForRunLog(text: string, maxLen = 8_000): string {
  let s = text;
  if (s.length > maxLen) {
    s = `${s.slice(0, maxLen)}\n[truncated ${s.length - maxLen} chars]`;
  }
  return s;
}

export function redactToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  return redactValue(args, 0) as Record<string, unknown>;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 10) return "[max depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactStringForRunLog(value, 4_000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redactValue(v, depth + 1);
    }
    return out;
  }
  return "[unserializable]";
}

export function summarizeToolResultForRunLog(result: unknown): unknown {
  if (result === null || result === undefined) return result;
  if (typeof result === "string") {
    return truncateText(redactStringForRunLog(result), MAX_TOOL_OUTPUT_CHARS).text;
  }
  if (typeof result === "object" && result !== null && "content" in result) {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .filter(
          (b): b is { type?: string; text?: string } =>
            typeof b === "object" && b !== null,
        )
        .filter(
          (b): b is { type: "text"; text: string } =>
            b.type === "text" && typeof b.text === "string",
        )
        .map((b) => redactStringForRunLog(b.text))
        .join("\n");
      if (text) {
        return truncateText(text, MAX_TOOL_OUTPUT_CHARS).text;
      }
    }
  }
  try {
    const json = JSON.stringify(result, null, 2);
    return truncateText(redactStringForRunLog(json), MAX_TOOL_OUTPUT_CHARS).text;
  } catch {
    return "[unserializable tool result]";
  }
}

export function sandboxContextFromSession(
  sessionId: string,
  workspaceDir?: string,
  state?: string,
  previousState?: string,
): SandboxRunEventContext {
  const ref = parseDaytonaSessionId(sessionId);
  return {
    provider: "daytona",
    providerSandboxId: ref.sandboxId,
    sessionId: buildDaytonaSessionId(ref.agentId, ref.sandboxId),
    ...(workspaceDir ? { workspaceDir } : {}),
    ...(state ? { state } : {}),
    ...(previousState ? { previousState } : {}),
  };
}

type SandboxLifecycleType = Extract<
  RunEventTypes,
  | "sandbox.created"
  | "sandbox.started"
  | "sandbox.stopped"
  | "sandbox.archived"
  | "sandbox.recovered"
  | "sandbox.deleted"
  | "sandbox.resource_mounted"
>;

export async function emitSandboxRunEvent(
  runId: string,
  eventType: SandboxLifecycleType,
  payload: Extract<RunEventPayload, { type: typeof eventType }>,
): Promise<void> {
  await appendEvent({ runId, type: eventType, payload }).catch(() => undefined);
}
