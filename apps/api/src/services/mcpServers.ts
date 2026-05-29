import type { McpServer } from "@open-agents/db";
import type { CreateMcpServerInput, UpdateMcpServerInput } from "@open-agents/types";
import { HttpError } from "../auth/middleware.js";
import { sealMcpServerBearer } from "../mcp/mcpServerSecrets.js";
import { prisma } from "../db.js";

export type McpServerListRow = McpServer & { _count: { bindings: number } };

export async function listMcpServers(): Promise<McpServerListRow[]> {
  return prisma.mcpServer.findMany({
    include: { _count: { select: { bindings: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getMcpServerById(id: string): Promise<McpServerListRow | null> {
  return prisma.mcpServer.findUnique({
    where: { id },
    include: { _count: { select: { bindings: true } } },
  });
}

export async function createMcpServer(input: CreateMcpServerInput): Promise<McpServer> {
  const existing = await prisma.mcpServer.findUnique({ where: { name: input.name } });
  if (existing) throw new HttpError(409, `MCP server name already exists: ${input.name}`);

  const bearerData =
    input.bearer?.trim() !== undefined && input.bearer.trim()
      ? sealMcpServerBearer(input.bearer.trim())
      : {};

  return prisma.mcpServer.create({
    data: {
      name: input.name,
      label: input.label,
      description: input.description ?? null,
      serverUrl: input.serverUrl,
      ...bearerData,
    },
  });
}

export async function updateMcpServer(
  id: string,
  input: UpdateMcpServerInput,
): Promise<McpServer> {
  const existing = await prisma.mcpServer.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "MCP server not found");

  if (input.name && input.name !== existing.name) {
    const conflict = await prisma.mcpServer.findUnique({ where: { name: input.name } });
    if (conflict)
      throw new HttpError(409, `MCP server name already exists: ${input.name}`);
  }

  const bearerData =
    input.bearer !== undefined
      ? input.bearer.trim()
        ? sealMcpServerBearer(input.bearer.trim())
        : {
            bearerCipher: null,
            bearerIv: null,
            bearerTag: null,
          }
      : {};

  return prisma.mcpServer.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.serverUrl !== undefined ? { serverUrl: input.serverUrl } : {}),
      ...bearerData,
    },
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
    hasBearer: Boolean(row.bearerCipher && row.bearerIv && row.bearerTag),
    agentCount: row._count.bindings,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
