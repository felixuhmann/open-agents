import { z } from "zod";

/**
 * Wire shape of every event in `RunEvent` and the SSE stream the chat UI
 * subscribes to. Producers (the `run-agent` worker) write these into
 * Postgres; consumers (the SSE handler) page through them by `seq`.
 */
export const RunEventTypes = z.enum([
  "run.started",
  "agent.delta",
  "agent.message",
  "tool.use",
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
  }),
  z.object({
    type: z.literal("agent.delta"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("agent.message"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool.use"),
    toolName: z.string(),
    callId: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("tool.result"),
    toolName: z.string(),
    callId: z.string().optional(),
    result: z.unknown().optional(),
    isError: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("model.request"),
    model: z.string().nullable().optional(),
    isError: z.boolean().optional(),
    usage: z.object({
      inputTokens: z.number().int().nonnegative().default(0),
      outputTokens: z.number().int().nonnegative().default(0),
      cacheCreationInputTokens: z.number().int().nonnegative().default(0),
      cacheReadInputTokens: z.number().int().nonnegative().default(0),
    }),
  }),
  z.object({
    type: z.literal("session.error"),
    message: z.string(),
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
