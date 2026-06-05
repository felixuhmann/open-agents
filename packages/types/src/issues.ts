import { z } from "zod";

export const EmailIssueReportInput = z.object({
  token: z.string().min(1).describe("Signed token from the email report link"),
  description: z.string().min(1).max(4000).describe("Issue description"),
});
export type EmailIssueReportInput = z.infer<typeof EmailIssueReportInput>;

export const CreateIssueInput = z
  .object({
    conversationId: z.string().min(1).optional().describe("Chat conversation id"),
    workflowConversationId: z
      .string()
      .min(1)
      .optional()
      .describe("Workflow conversation id"),
    description: z.string().min(1).max(4000).describe("Issue description"),
  })
  .refine(
    (body) => Boolean(body.conversationId) !== Boolean(body.workflowConversationId),
    { message: "provide exactly one of conversationId or workflowConversationId" },
  );
export type CreateIssueInput = z.infer<typeof CreateIssueInput>;

export const UpdateIssueInput = z.object({
  status: z.enum(["open", "resolved"]).describe("Issue status"),
});
export type UpdateIssueInput = z.infer<typeof UpdateIssueInput>;

export const ListIssuesQuery = z.object({
  status: z.enum(["open", "resolved"]).optional().describe("Filter by status"),
});
export type ListIssuesQuery = z.infer<typeof ListIssuesQuery>;

export const EmailIssueReportPrefillQuery = z.object({
  token: z.string().min(1).describe("Signed token from the email report link"),
});
export type EmailIssueReportPrefillQuery = z.infer<typeof EmailIssueReportPrefillQuery>;
