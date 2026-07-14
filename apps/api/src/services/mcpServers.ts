import type { McpServer, Prisma } from "@open-agents/db";
import type {
  CreateMcpServerInput,
  McpAuthType,
  McpProbeResult,
  ProbeMcpServerInput,
  UpdateMcpServerInput,
} from "@open-agents/types";
import { HttpError } from "../auth/middleware.js";
import { config } from "../config.js";
import { decryptMcpServerBearer, sealMcpServerBearer } from "../mcp/mcpServerSecrets.js";
import { resolveMcpServerBearer } from "../mcp/oauth/mcpOAuthService.js";
import {
  sealMcpOAuthSecrets,
  unsealMcpOAuthSecrets,
} from "../mcp/oauth/mcpOAuthSecrets.js";
import { probeMcpServer } from "../mcp/probeMcpServer.js";
import { prisma } from "../db.js";

export type McpServerListRow = Prisma.McpServerGetPayload<{
  include: { oauthCredential: true; _count: { select: { bindings: true } } };
}>;

const includeListRelations = {
  oauthCredential: true,
  _count: { select: { bindings: true } },
} as const;

function unique(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function resolveCreateAuthType(input: CreateMcpServerInput): McpAuthType {
  if (input.authType) return input.authType;
  if (input.oauth) return "oauth2";
  if (input.bearer?.trim()) return "bearer";
  return "none";
}

function validateOAuthSelection(authType: McpAuthType, hasOAuthConfig: boolean): void {
  if (authType === "oauth2" && !hasOAuthConfig) {
    throw new HttpError(400, "OAuth client credentials are required");
  }
  if (authType !== "oauth2" && hasOAuthConfig) {
    throw new HttpError(400, "OAuth configuration requires authType=oauth2");
  }
}

export async function listMcpServers(): Promise<McpServerListRow[]> {
  return prisma.mcpServer.findMany({
    include: includeListRelations,
    orderBy: { updatedAt: "desc" },
  });
}

export async function getMcpServerById(id: string): Promise<McpServerListRow | null> {
  return prisma.mcpServer.findUnique({
    where: { id },
    include: includeListRelations,
  });
}

export async function createMcpServer(input: CreateMcpServerInput): Promise<McpServer> {
  const existing = await prisma.mcpServer.findUnique({ where: { name: input.name } });
  if (existing) throw new HttpError(409, `MCP server name already exists: ${input.name}`);

  const authType = resolveCreateAuthType(input);
  validateOAuthSelection(authType, Boolean(input.oauth));
  const bearerData =
    authType === "bearer" && input.bearer?.trim()
      ? sealMcpServerBearer(input.bearer.trim())
      : {};
  const oauthData = input.oauth
    ? {
        oauthCredential: {
          create: {
            provider: input.oauth.provider,
            clientId: input.oauth.clientId,
            ...sealMcpOAuthSecrets({ clientSecret: input.oauth.clientSecret }),
            scopes: unique(input.oauth.scopes),
          },
        },
      }
    : {};

  return prisma.mcpServer.create({
    data: {
      name: input.name,
      label: input.label,
      description: input.description ?? null,
      serverUrl: input.serverUrl,
      authType,
      allowedTools: unique(input.allowedTools),
      ...bearerData,
      ...oauthData,
    },
  });
}

export async function updateMcpServer(
  id: string,
  input: UpdateMcpServerInput,
): Promise<McpServer> {
  const existing = await prisma.mcpServer.findUnique({
    where: { id },
    include: { oauthCredential: true },
  });
  if (!existing) throw new HttpError(404, "MCP server not found");

  if (input.name && input.name !== existing.name) {
    const conflict = await prisma.mcpServer.findUnique({ where: { name: input.name } });
    if (conflict)
      throw new HttpError(409, `MCP server name already exists: ${input.name}`);
  }

  const authType: McpAuthType =
    input.authType ??
    (input.oauth
      ? "oauth2"
      : input.bearer !== undefined
        ? input.bearer.trim()
          ? "bearer"
          : "none"
        : (existing.authType as McpAuthType));
  const willHaveOAuth = Boolean(input.oauth ?? existing.oauthCredential);
  validateOAuthSelection(
    authType,
    authType === "oauth2" ? willHaveOAuth : Boolean(input.oauth),
  );

  const bearerData =
    authType !== "bearer"
      ? { bearerCipher: null, bearerIv: null, bearerTag: null }
      : input.bearer !== undefined
        ? input.bearer.trim()
          ? sealMcpServerBearer(input.bearer.trim())
          : { bearerCipher: null, bearerIv: null, bearerTag: null }
        : {};

  return prisma.$transaction(async (tx) => {
    const updated = await tx.mcpServer.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.serverUrl !== undefined ? { serverUrl: input.serverUrl } : {}),
        ...(input.allowedTools !== undefined
          ? { allowedTools: unique(input.allowedTools) }
          : {}),
        authType,
        ...bearerData,
      },
    });

    if (authType !== "oauth2") {
      await tx.mcpOAuthCredential.deleteMany({ where: { mcpServerId: id } });
      return updated;
    }

    const currentSecrets = existing.oauthCredential
      ? unsealMcpOAuthSecrets(existing.oauthCredential)
      : null;
    const clientSecret = input.oauth?.clientSecret ?? currentSecrets?.clientSecret;
    const provider = input.oauth?.provider ?? existing.oauthCredential?.provider;
    const clientId = input.oauth?.clientId ?? existing.oauthCredential?.clientId;
    const scopes = unique(input.oauth?.scopes ?? existing.oauthCredential?.scopes);
    if (!clientSecret || provider !== "google" || !clientId || scopes.length === 0) {
      throw new HttpError(400, "Complete Google OAuth client configuration is required");
    }
    const configChanged =
      provider !== existing.oauthCredential?.provider ||
      clientId !== existing.oauthCredential?.clientId ||
      scopes.join("\n") !== existing.oauthCredential?.scopes.join("\n") ||
      Boolean(input.oauth?.clientSecret);
    const sealed = sealMcpOAuthSecrets({
      clientSecret,
      ...(!configChanged && currentSecrets?.accessToken
        ? { accessToken: currentSecrets.accessToken }
        : {}),
      ...(!configChanged && currentSecrets?.refreshToken
        ? { refreshToken: currentSecrets.refreshToken }
        : {}),
      ...(!configChanged && currentSecrets?.tokenType
        ? { tokenType: currentSecrets.tokenType }
        : {}),
    });
    await tx.mcpOAuthCredential.upsert({
      where: { mcpServerId: id },
      create: {
        mcpServerId: id,
        provider,
        clientId,
        scopes,
        ...sealed,
      },
      update: {
        provider,
        clientId,
        scopes,
        ...sealed,
        ...(configChanged ? { subject: null, expiresAt: null, connectedAt: null } : {}),
      },
    });
    return updated;
  });
}

export async function deleteMcpServer(id: string): Promise<void> {
  const existing = await prisma.mcpServer.findUnique({
    where: { id },
    include: { _count: { select: { bindings: true } } },
  });
  if (!existing) throw new HttpError(404, "MCP server not found");
  if (existing._count.bindings > 0) {
    throw new HttpError(
      409,
      `MCP server is attached to ${existing._count.bindings} agent(s). Detach it first.`,
    );
  }
  await prisma.mcpServer.delete({ where: { id } });
}

export function toMcpServerDto(row: McpServerListRow) {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    description: row.description,
    serverUrl: row.serverUrl,
    authType: row.authType as McpAuthType,
    hasBearer: Boolean(row.bearerCipher && row.bearerIv && row.bearerTag),
    oauth: row.oauthCredential
      ? {
          provider: row.oauthCredential.provider as "google",
          clientId: row.oauthCredential.clientId,
          connected: Boolean(row.oauthCredential.connectedAt),
          subject: row.oauthCredential.subject,
          scopes: row.oauthCredential.scopes,
          expiresAt: row.oauthCredential.expiresAt?.toISOString() ?? null,
          redirectUri: `${config.PUBLIC_BASE_URL}/api/mcp-servers/oauth/callback`,
        }
      : null,
    allowedTools: row.allowedTools,
    agentCount: row._count.bindings,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function probeStoredMcpServer(
  id: string,
  bearerOverride?: string,
): Promise<McpProbeResult> {
  const row = await getMcpServerById(id);
  if (!row) throw new HttpError(404, "MCP server not found");
  const bearer =
    bearerOverride !== undefined
      ? bearerOverride.trim() || null
      : row.authType === "oauth2"
        ? await resolveMcpServerBearer(row)
        : decryptMcpServerBearer(row);
  return probeMcpServer({
    serverUrl: row.serverUrl,
    bearer,
    allowedTools: row.allowedTools,
  });
}

export function probeMcpServerDraft(input: ProbeMcpServerInput): Promise<McpProbeResult> {
  return probeMcpServer({
    serverUrl: input.serverUrl,
    bearer: input.bearer?.trim() ?? null,
    allowedTools: input.allowedTools ?? [],
  });
}
