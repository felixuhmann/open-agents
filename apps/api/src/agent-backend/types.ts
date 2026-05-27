import type { SkillMaterializationManifest } from "@open-agents/types";

/**
 * Backend-agnostic interface for a Managed-Agent-style provider. The
 * application code in `services/` and `jobs/` depends only on this
 * interface; the concrete implementation (currently Anthropic) lives in a
 * sibling module and is wired into `instance.ts`.
 */
export interface AgentBackend {
  runtime: "anthropic" | "daytona";
  createSession(input: CreateSessionInput): Promise<AgentSession>;
  streamUntilIdle(
    sessionId: string,
    userMessage: string,
    onEvent?: AgentEventHandler,
    context?: AgentRunContext,
  ): Promise<string>;
  uploadFile(input: UploadFileInput): Promise<AgentFile>;
}

export type AgentSession = {
  id: string;
  /** Present when the backend unpacked agent skill bundles into the sandbox. */
  skillsManifest?: SkillMaterializationManifest;
};

export type AgentFile = {
  id: string;
};

export type SessionResource = {
  type: "file";
  fileId: string;
  mountPath: string;
  filename?: string;
  mime?: string;
  bytes?: Uint8Array;
};

export type CreateSessionInput = {
  agentId: string;
  environmentId?: string;
  agentSlug?: string;
  title?: string;
  resources?: SessionResource[];
};

export type UploadFileInput = {
  filename: string;
  bytes: Uint8Array;
  mime: string;
};

export type AgentRunContext = {
  runId: string;
  surface: "chat" | "email";
  agentId: string;
  chatMessageId?: string;
  emailMessageId?: string;
};

/**
 * Normalized event shape the orchestrator consumes. Backends translate
 * their native event vocabulary into this minimal union and pass the
 * upstream event `type` through `rawType` for observability.
 */
export type AgentStreamEvent =
  | { kind: "delta"; text: string; rawType: string }
  | { kind: "message"; text: string; rawType: string }
  | { kind: "tool_use"; toolName: string; rawType: string }
  | {
      kind: "tool_result";
      toolName: string;
      rawType: string;
      callId?: string;
      result?: unknown;
      isError?: boolean;
    }
  | {
      kind: "model_request";
      rawType: string;
      model?: string | null;
      isError?: boolean;
      usage: {
        inputTokens: number;
        outputTokens: number;
        cacheCreationInputTokens: number;
        cacheReadInputTokens: number;
      };
    }
  | { kind: "session_error"; rawType: string; message: string }
  | { kind: "other"; rawType: string };

export type AgentEventHandler = (event: AgentStreamEvent) => void;

export class AgentBackendError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentBackendError";
  }
}
