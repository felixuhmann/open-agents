import type { SkillMaterializationManifest } from "@open-agents/types";

/** Backend interface used by services/jobs to drive Daytona sandboxes. */
export interface AgentBackend {
  runtime: "daytona";
  createSession(input: CreateSessionInput): Promise<AgentSession>;
  mountSessionResources(
    sessionId: string,
    resources: SessionResource[],
    observability?: RunObservabilityContext,
  ): Promise<void>;
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
  /** Daytona provider sandbox id (for run/issue observability). */
  providerSandboxId?: string;
  workspaceDir?: string;
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

/** When set, Daytona lifecycle transitions are appended to this run's event log. */
export type RunObservabilityContext = {
  runId: string;
};

export type CreateSessionInput = {
  agentId: string;
  agentSlug?: string;
  title?: string;
  resources?: SessionResource[];
  /** Pinned published version whose skill bindings should be materialized. */
  agentVersionId?: string;
  /** Link sandbox metadata to a chat conversation (Daytona). */
  conversationId?: string;
  /** Link sandbox metadata to an email thread (Daytona). */
  threadId?: string;
  surface?: "chat" | "email";
  observability?: RunObservabilityContext;
};

export type UploadFileInput = {
  filename: string;
  bytes: Uint8Array;
  mime: string;
};

export type AgentRunContext = {
  runId: string;
  surface: "chat" | "email" | "workflow" | "subagent";
  agentId: string;
  /** Frozen config version this run executes against. */
  agentVersionId?: string;
  chatMessageId?: string;
  emailMessageId?: string;
  /**
   * Delegation depth of this run (0 for a user-facing run, 1 for a subagent
   * it spawns, and so on). Used to bound `run_subagent` recursion.
   */
  delegationDepth?: number;
  /**
   * Agent ids from the delegation root down to this run inclusive. Used to
   * reject cycles (an agent calling an ancestor already in the chain).
   */
  delegationAncestors?: string[];
  /** AgentRun that spawned this run via `run_subagent`, when applicable. */
  parentRunId?: string;
};

/**
 * Normalized event shape the orchestrator consumes. Backends translate
 * their native event vocabulary into this minimal union and pass the
 * upstream event `type` through `rawType` for observability.
 */
export type AgentStreamEvent =
  | { kind: "reasoning"; active: boolean; rawType: string }
  | { kind: "delta"; text: string; rawType: string }
  | { kind: "message"; text: string; rawType: string }
  | {
      kind: "tool_use";
      toolName: string;
      rawType: string;
      callId?: string;
      args?: Record<string, unknown>;
    }
  | {
      kind: "tool_output";
      toolName: string;
      rawType: string;
      callId?: string;
      stream: "stdout" | "stderr";
      text: string;
    }
  | {
      kind: "tool_result";
      toolName: string;
      rawType: string;
      callId?: string;
      result?: unknown;
      isError?: boolean;
    }
  | {
      kind: "model_request_started";
      rawType: string;
      model?: string | null;
      provider?: string;
    }
  | {
      kind: "model_request";
      rawType: string;
      model?: string | null;
      provider?: string;
      stopReason?: string;
      isError?: boolean;
      errorMessage?: string;
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
