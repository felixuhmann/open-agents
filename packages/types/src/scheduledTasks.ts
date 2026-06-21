import { z } from "zod";

export const ScheduledTaskTargetType = z.enum(["agent", "workflow"]);
export type ScheduledTaskTargetType = z.infer<typeof ScheduledTaskTargetType>;

export const ScheduledTaskStatus = z.enum(["active", "paused"]);
export type ScheduledTaskStatus = z.infer<typeof ScheduledTaskStatus>;

export const ScheduledTaskDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  targetType: ScheduledTaskTargetType,
  agent: z
    .object({
      id: z.string(),
      slug: z.string(),
      displayName: z.string(),
      avatar: z.string().nullable(),
    })
    .nullable(),
  workflow: z
    .object({ id: z.string(), slug: z.string(), displayName: z.string() })
    .nullable(),
  cron: z.string(),
  prompt: z.string(),
  status: ScheduledTaskStatus,
  timezone: z.string(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScheduledTaskDto = z.infer<typeof ScheduledTaskDto>;

export const ScheduledTaskRunDto = z.object({
  id: z.string(),
  status: z.enum(["pending", "running", "succeeded", "failed"]),
  error: z.string().nullable(),
  scheduledFor: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  conversationId: z.string().nullable(),
  workflowConversationId: z.string().nullable(),
  agentRunId: z.string().nullable(),
  workflowRunId: z.string().nullable(),
  createdAt: z.string(),
});
export type ScheduledTaskRunDto = z.infer<typeof ScheduledTaskRunDto>;

const scheduledTaskInputShape = {
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  targetType: ScheduledTaskTargetType,
  agentSlug: z.string().min(1).optional(),
  workflowSlug: z.string().min(1).optional(),
  cron: z.string().min(1).max(120),
  prompt: z.string().min(1).max(20000),
  timezone: z.string().min(1).max(80),
  status: ScheduledTaskStatus,
};

function validateScheduledTaskTarget(
  value: {
    targetType?: ScheduledTaskTargetType;
    agentSlug?: string;
    workflowSlug?: string;
  },
  addIssue: (path: string[], message: string) => void,
) {
  if (value.targetType === "agent" && !value.agentSlug) {
    addIssue(["agentSlug"], "agentSlug is required");
  }
  if (value.targetType === "workflow" && !value.workflowSlug) {
    addIssue(["workflowSlug"], "workflowSlug is required");
  }
}

export const CreateScheduledTaskInput = z
  .object({
    ...scheduledTaskInputShape,
    timezone: scheduledTaskInputShape.timezone.default("UTC"),
    status: ScheduledTaskStatus.default("active"),
  })
  .superRefine((value, ctx) => {
    validateScheduledTaskTarget(value, (path, message) => {
      ctx.addIssue({ code: "custom", path, message });
    });
  });
export type CreateScheduledTaskInput = z.infer<typeof CreateScheduledTaskInput>;

export const UpdateScheduledTaskInput = z
  .object(scheduledTaskInputShape)
  .partial()
  .superRefine((value, ctx) => {
    validateScheduledTaskTarget(value, (path, message) => {
      ctx.addIssue({ code: "custom", path, message });
    });
  });
export type UpdateScheduledTaskInput = z.infer<typeof UpdateScheduledTaskInput>;
