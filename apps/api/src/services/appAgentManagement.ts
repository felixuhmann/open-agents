import {
  APP_ASSISTANT_AGENT_SLUG,
  type CreateAgentInput,
  type UpdateAgentInput,
  type UserRole,
} from "@open-agents/types";
import { parseStarterPrompts } from "../agents/starterPrompts.js";
import {
  createAgent,
  deleteAgent,
  getAgentBySlug,
  listAgents,
  updateAgent,
  type HydratedAgent,
} from "../agents/service.js";
import { canOperateAgents, type AuthUser } from "../auth/middleware.js";
import { prisma } from "../db.js";

export class AppAgentManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppAgentManagementError";
  }
}

async function loadActingUser(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) {
    throw new AppAgentManagementError("Signed-in user not found");
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserRole,
  };
}

function requireOperator(user: AuthUser): void {
  if (!canOperateAgents(user)) {
    throw new AppAgentManagementError(
      "Agent management requires admin or contributor role",
    );
  }
}

function assertNotAppAssistant(slug: string): void {
  if (slug === APP_ASSISTANT_AGENT_SLUG) {
    throw new AppAgentManagementError(
      `The "${APP_ASSISTANT_AGENT_SLUG}" agent is managed by the platform and cannot be changed through these tools`,
    );
  }
}

function toSummary(agent: HydratedAgent) {
  return {
    id: agent.id,
    slug: agent.slug,
    displayName: agent.displayName,
    description: agent.description,
    emailEnabled: agent.emailEnabled,
    webEnabled: agent.webEnabled,
    accessMode: agent.accessMode,
    currentVersionNumber: agent.currentVersion?.versionNumber ?? null,
    updatedAt: agent.updatedAt.toISOString(),
  };
}

function toDetail(agent: HydratedAgent) {
  return {
    ...toSummary(agent),
    systemPrompt: agent.systemPrompt,
    modelProvider: agent.modelProvider,
    modelId: agent.modelId,
    starterPrompts: parseStarterPrompts(agent.starterPrompts),
    toolKeys: agent.toolBindings.map((b) => b.tool.key),
    skillNames: agent.skillBindings.map((b) => b.skill.name),
    mcpServerLabels: agent.mcpBindings.map((b) => b.mcpServer.label),
  };
}

export async function openAgentsListAgents(actingUserId: string) {
  const user = await loadActingUser(actingUserId);
  requireOperator(user);
  const agents = await listAgents();
  return agents.filter((a) => a.slug !== APP_ASSISTANT_AGENT_SLUG).map(toSummary);
}

export async function openAgentsGetAgent(actingUserId: string, slug: string) {
  const user = await loadActingUser(actingUserId);
  requireOperator(user);
  assertNotAppAssistant(slug);
  const agent = await getAgentBySlug(slug);
  if (!agent) {
    throw new AppAgentManagementError(`Agent not found: ${slug}`);
  }
  return toDetail(agent);
}

export async function openAgentsCreateAgent(
  actingUserId: string,
  input: CreateAgentInput,
) {
  const user = await loadActingUser(actingUserId);
  requireOperator(user);
  assertNotAppAssistant(input.slug);
  const existing = await getAgentBySlug(input.slug);
  if (existing) {
    throw new AppAgentManagementError(`Slug already exists: ${input.slug}`);
  }
  const agent = await createAgent({
    slug: input.slug,
    displayName: input.displayName,
    description: input.description,
    systemPrompt: input.systemPrompt,
    createdById: user.id,
  });
  return toDetail(agent);
}

export async function openAgentsUpdateAgent(
  actingUserId: string,
  slug: string,
  patch: UpdateAgentInput,
) {
  const user = await loadActingUser(actingUserId);
  requireOperator(user);
  assertNotAppAssistant(slug);
  const agent = await getAgentBySlug(slug);
  if (!agent) {
    throw new AppAgentManagementError(`Agent not found: ${slug}`);
  }
  const updated = await updateAgent(agent.id, {
    ...patch,
    description: patch.description ?? undefined,
  });
  return toDetail(updated);
}

export async function openAgentsDeleteAgent(actingUserId: string, slug: string) {
  const user = await loadActingUser(actingUserId);
  requireOperator(user);
  assertNotAppAssistant(slug);
  const agent = await getAgentBySlug(slug);
  if (!agent) {
    throw new AppAgentManagementError(`Agent not found: ${slug}`);
  }
  await deleteAgent(agent.id);
  return { ok: true as const, slug };
}
