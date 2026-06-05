import { z } from "zod";

export const CreateConversationInput = z.object({
  agentSlug: z.string().min(1).describe("Target agent slug"),
  title: z.string().min(1).max(120).optional().describe("Conversation title"),
  firstMessage: z
    .string()
    .min(1)
    .max(20000)
    .optional()
    .describe("Optional first user message (starts a run immediately)"),
});
export type CreateConversationInput = z.infer<typeof CreateConversationInput>;

export const SendConversationMessageInput = z.object({
  text: z.string().min(1).max(20000).describe("User message text"),
});
export type SendConversationMessageInput = z.infer<typeof SendConversationMessageInput>;

export const CreateWorkflowConversationInput = z.object({
  workflowSlug: z.string().min(1).describe("Target workflow slug"),
  title: z.string().min(1).max(120).optional().describe("Conversation title"),
  firstMessage: z
    .string()
    .min(1)
    .max(20000)
    .optional()
    .describe("Optional first user message"),
});
export type CreateWorkflowConversationInput = z.infer<
  typeof CreateWorkflowConversationInput
>;

export const ListConversationsQuery = z.object({
  agentSlug: z.string().min(1).optional().describe("Filter by agent slug"),
});
export type ListConversationsQuery = z.infer<typeof ListConversationsQuery>;

export const ListWorkflowConversationsQuery = z.object({
  workflowSlug: z.string().min(1).optional().describe("Filter by workflow slug"),
});
export type ListWorkflowConversationsQuery = z.infer<
  typeof ListWorkflowConversationsQuery
>;
