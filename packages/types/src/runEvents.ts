import { z } from "zod";
import { SkillMaterializationEntry } from "./skills.js";

/** Shared Daytona sandbox fields on run-scoped sandbox lifecycle events. */
export const SandboxRunEventContext = z.object({
  provider: z.literal("daytona"),
  providerSandboxId: z.string(),
  sessionId: z.string(),
  workspaceDir: z.string().optional(),
  state: z.string().optional(),
  previousState: z.string().optional(),
});
export type SandboxRunEventContext = z.infer<typeof SandboxRunEventContext>;

export const SandboxResourceMounted = z.object({
  fileId: z.string().optional(),
  filename: z.string().optional(),
  mountPath: z.string(),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type SandboxResourceMounted = z.infer<typeof SandboxResourceMounted>;

export const ModelRequestUsage = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  cacheCreationInputTokens: z.number().int().nonnegative().default(0),
  cacheReadInputTokens: z.number().int().nonnegative().default(0),
});
export type ModelRequestUsage = z.infer<typeof ModelRequestUsage>;

/**
 * Wire shape of every event in `RunEvent` and the SSE stream the chat UI
 * subscribes to. Producers (the `run-agent` worker) write these into
 * Postgres; consumers (the SSE handler) page through them by `seq`.
 */
export const RunEventTypes = z.enum([
  "run.started",
  "sandbox.created",
  "sandbox.started",
  "sandbox.stopped",
  "sandbox.archived",
  "sandbox.recovered",
  "sandbox.deleted",
  "sandbox.resource_mounted",
  "skills.materialized",
  "agent.delta",
  "agent.message",
  "tool.use",
  "tool.output",
  "tool.result",
  "model.request",
  "session.error",
  "run.succeeded",
  "run.failed",
]);
export type RunEventTypes = z.infer<typeof RunEventTypes>;

export const RunEventPayload = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.started"),
    runId: z.string(),
    sessionId: z.string(),
    backend: z.enum(["daytona", "anthropic"]).optional(),
    providerSandboxId: z.string().optional(),
    workspaceDir: z.string().optional(),
  }),
  z.object({
    type: z.literal("sandbox.created"),
    ...SandboxRunEventContext.shape,
  }),
  z.object({
    type: z.literal("sandbox.started"),
    ...SandboxRunEventContext.shape,
  }),
  z.object({
    type: z.literal("sandbox.stopped"),
    ...SandboxRunEventContext.shape,
  }),
  z.object({
    type: z.literal("sandbox.archived"),
    ...SandboxRunEventContext.shape,
  }),
  z.object({
    type: z.literal("sandbox.recovered"),
    ...SandboxRunEventContext.shape,
  }),
  z.object({
    type: z.literal("sandbox.deleted"),
    ...SandboxRunEventContext.shape,
  }),
  z.object({
    type: z.literal("sandbox.resource_mounted"),
    ...SandboxRunEventContext.shape,
    resources: z.array(SandboxResourceMounted),
  }),
  z.object({
    type: z.literal("skills.materialized"),
    skills: z.array(SkillMaterializationEntry),
  }),
  z.object({
    type: z.literal("agent.delta"),
    text: z.string(),
    rawType: z.string().optional(),
  }),
  z.object({
    type: z.literal("agent.message"),
    text: z.string(),
    rawType: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool.use"),
    toolName: z.string(),
    callId: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    rawType: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool.output"),
    toolName: z.string(),
    callId: z.string().optional(),
    stream: z.enum(["stdout", "stderr"]),
    text: z.string(),
    rawType: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool.result"),
    toolName: z.string(),
    callId: z.string().optional(),
    result: z.unknown().optional(),
    isError: z.boolean().optional(),
    rawType: z.string().optional(),
  }),
  z.object({
    type: z.literal("model.request"),
    model: z.string().nullable().optional(),
    provider: z.string().optional(),
    isError: z.boolean().optional(),
    stopReason: z.string().optional(),
    rawType: z.string().optional(),
    usage: ModelRequestUsage,
  }),
  z.object({
    type: z.literal("session.error"),
    message: z.string(),
    rawType: z.string().optional(),
  }),
  z.object({
    type: z.literal("run.succeeded"),
    output: z.string(),
  }),
  z.object({
    type: z.literal("run.failed"),
    error: z.string(),
  }),
]);
export type RunEventPayload = z.infer<typeof RunEventPayload>;

export const RunEventEnvelope = z.object({
  seq: z.number().int().nonnegative(),
  type: RunEventTypes,
  createdAt: z.string(),
  payload: RunEventPayload,
});
export type RunEventEnvelope = z.infer<typeof RunEventEnvelope>;
