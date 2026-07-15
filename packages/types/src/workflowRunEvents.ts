import { z } from "zod";

/**
 * Wire shape of every event in `WorkflowRunEvent` and the SSE stream the
 * workflow chat subscribes to. The runner emits high-level pipeline
 * coordination events plus forwarded token deltas from the active step so
 * the chat feels live, like a normal agent chat.
 */
export const WorkflowRunEventTypes = z.enum([
  "workflow.run.started",
  "workflow.step.started",
  "workflow.step.delta",
  "workflow.step.tool",
  "workflow.step.succeeded",
  "workflow.step.cancelled",
  "workflow.run.cancel.requested",
  "workflow.run.cancelled",
  "workflow.run.succeeded",
  "workflow.run.failed",
]);
export type WorkflowRunEventTypes = z.infer<typeof WorkflowRunEventTypes>;

export const WorkflowStepDescriptor = z.object({
  position: z.number().int().nonnegative(),
  agentSlug: z.string(),
  agentDisplayName: z.string(),
});
export type WorkflowStepDescriptor = z.infer<typeof WorkflowStepDescriptor>;

export const WorkflowRunAttachment = z.object({
  id: z.string(),
  filename: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});
export type WorkflowRunAttachment = z.infer<typeof WorkflowRunAttachment>;

export const WorkflowRunEventPayload = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("workflow.run.started"),
    workflowRunId: z.string(),
    steps: z.array(WorkflowStepDescriptor),
  }),
  z.object({
    type: z.literal("workflow.step.started"),
    position: z.number().int().nonnegative(),
    agentSlug: z.string(),
    agentDisplayName: z.string(),
    runId: z.string(),
  }),
  z.object({
    type: z.literal("workflow.step.delta"),
    position: z.number().int().nonnegative(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("workflow.step.tool"),
    position: z.number().int().nonnegative(),
    toolName: z.string(),
    status: z.enum(["start", "end"]),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("workflow.step.succeeded"),
    position: z.number().int().nonnegative(),
    runId: z.string(),
    output: z.string(),
    attachments: z.array(WorkflowRunAttachment),
  }),
  z.object({
    type: z.literal("workflow.step.cancelled"),
    position: z.number().int().nonnegative(),
    runId: z.string(),
  }),
  z.object({
    type: z.literal("workflow.run.cancel.requested"),
  }),
  z.object({
    type: z.literal("workflow.run.cancelled"),
    reason: z.string(),
  }),
  z.object({
    type: z.literal("workflow.run.succeeded"),
    output: z.string(),
    finalRunId: z.string().nullable(),
  }),
  z.object({
    type: z.literal("workflow.run.failed"),
    position: z.number().int().nonnegative().nullable(),
    error: z.string(),
  }),
]);
export type WorkflowRunEventPayload = z.infer<typeof WorkflowRunEventPayload>;

export const WorkflowRunEventEnvelope = z.object({
  seq: z.number().int().nonnegative(),
  type: WorkflowRunEventTypes,
  createdAt: z.string(),
  payload: WorkflowRunEventPayload,
});
export type WorkflowRunEventEnvelope = z.infer<typeof WorkflowRunEventEnvelope>;
