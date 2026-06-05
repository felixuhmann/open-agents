import { z } from "zod";

export const McpConnectionInfoSchema = z.object({
  mcpUrl: z.string().url(),
  docsPath: z.string(),
  oauthAuthorizationServerUrl: z.string().url(),
  oauthProtectedResourceUrl: z.string().url(),
  authServerUrl: z.string().url(),
});

export type McpConnectionInfo = z.infer<typeof McpConnectionInfoSchema>;

export const McpConnectionTokenSchema = z.object({
  id: z.string(),
  token: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export type McpConnectionToken = z.infer<typeof McpConnectionTokenSchema>;

export const McpConnectionTokenSummarySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  updatedAt: z.string(),
  ipAddress: z.string().nullable(),
});

export type McpConnectionTokenSummary = z.infer<typeof McpConnectionTokenSummarySchema>;
