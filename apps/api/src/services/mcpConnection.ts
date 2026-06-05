import type { McpConnectionInfo, McpConnectionTokenSummary } from "@open-agents/types";
import { auth } from "../auth/index.js";
import { config } from "../config.js";
import { prisma } from "../db.js";

const MCP_SESSION_USER_AGENT = "open-agents-mcp";

export function getMcpConnectionInfo(): McpConnectionInfo {
  const base = config.PUBLIC_BASE_URL.replace(/\/$/, "");
  return {
    mcpUrl: `${base}/mcp`,
    docsPath: "/settings/mcp-connection",
  };
}

export async function createMcpConnectionToken(userId: string): Promise<{
  id: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}> {
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(userId, false, {
    userAgent: MCP_SESSION_USER_AGENT,
  });
  return {
    id: session.id,
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
  };
}

export async function listMcpConnectionTokens(
  userId: string,
): Promise<McpConnectionTokenSummary[]> {
  const rows = await prisma.session.findMany({
    where: {
      userId,
      userAgent: MCP_SESSION_USER_AGENT,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      updatedAt: true,
      ipAddress: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ipAddress: row.ipAddress,
  }));
}

export async function revokeMcpConnectionToken(
  userId: string,
  sessionId: string,
): Promise<void> {
  const row = await prisma.session.findFirst({
    where: { id: sessionId, userId, userAgent: MCP_SESSION_USER_AGENT },
    select: { token: true },
  });
  if (!row) {
    throw new Error("token not found");
  }
  const ctx = await auth.$context;
  await ctx.internalAdapter.deleteSession(row.token);
}
