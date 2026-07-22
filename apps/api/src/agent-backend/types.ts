import type { SkillMaterializationManifest } from "@open-agents/types";
import type { SandboxProviderId } from "../sandbox-provider/types.js";

/**
 * Backend interface used by services/jobs to drive agent sandboxes. The
 * sandbox mechanics themselves live behind `sandbox-provider/`; this is the
 * shared Pi model/tool loop on top of them.
 */
export interface AgentBackend {
  /** The shared Pi model/tool loop. Sandbox choice lives on the session. */
  runtime: "pi";
  createSession(input: CreateSessionInput): Promise<AgentSession>;
  mountSessionResources(
    sessionId: string,
    resources: SessionResource[],
    observability?: RunObservabilityContext,
  ): Promise<MountedSession>;
  streamUntilIdle(
    sessionId: string,
    userMessage: string,
    onEvent?: AgentEventHandler,
    context?: AgentRunContext,
  ): Promise<string>;
  uploadFile(input: UploadFileInput): Promise<AgentFile>;
  /**
   * Destroy a sandbox this process created but will not use — a replacement
   * that lost the pointer race, or a partially-initialized session. Retires
   * the `AgentSandbox` row so reconciliation does not chase it.
   */
  discardSession(sessionId: string): Promise<void>;
}

/**
 * What connecting to an existing session revealed. Returned so a resumed run
 * can report the same sandbox metadata a newly created one does, without
 * spending an extra connect purely to log it.
 */
export type MountedSession = {
  workspaceDir?: string;
};

export type AgentSession = {
  id: string;
  /** Present when the backend unpacked agent skill bundles into the sandbox. */
  skillsManifest?: SkillMaterializationManifest;
  /** Sandbox provider that actually owns this session's sandbox. */
  provider?: SandboxProviderId;
  /** Provider-side sandbox id (for run/issue observability). */
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

/** When set, sandbox lifecycle transitions are appended to this run's event log. */
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
  /**
   * Surface label recorded on the sandbox row. The *link* to a specific
   * conversation or thread is not set here: it is a unique column that a
   * replacement sandbox has to take over from its predecessor, so it is
   * claimed transactionally alongside the session pointer
   * (`sandboxSessionClaim.ts`) once the sandbox exists.
   */
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
  /** Aborts the active provider request and prevents further tool/model turns. */
  signal?: AbortSignal;
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

/**
 * Failure in the sandbox/agent domain.
 *
 * `status` marks the errors that are a *normal answer* to an API call rather
 * than a server fault — "that provider is not reachable", "this provider
 * cannot archive". The app's `onError` hook turns it into that response code
 * with the message intact, so an operator sees what to fix instead of
 * "internal error". Runtime failures deliberately leave it unset and stay
 * 500s.
 */
export class AgentBackendError extends Error {
  readonly status?: number;

  constructor(message: string, options?: { cause?: unknown; status?: number }) {
    super(message, options);
    this.name = "AgentBackendError";
    if (options?.status !== undefined) this.status = options.status;
  }
}
