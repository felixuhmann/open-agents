import type { Agent, Prisma } from "@open-agents/db";
import type { AgentModel } from "@open-agents/types";
import { upsertAnthropicAgent } from "../anthropic/provisioning.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { getServiceSecret, SERVICE_KEYS } from "../secrets/service.js";

/**
 * Hydrated Agent shape used by route handlers, the run-agent worker, and
 * the MCP route. Includes everything needed to resolve a run end-to-end.
 *
 * `toolBindings` is the only binding table after the unified-catalog
 * change — both managed (Anthropic-executed) and platform (our MCP)
 * bindings live here, discriminated by `tool.runtime`.
 */
export type HydratedAgent = Agent & {
  toolBindings: (Prisma.AgentToolBindingGetPayload<true> & {
    tool: Prisma.ToolGetPayload<true>;
  })[];
  skillBindings: (Prisma.AgentSkillBindingGetPayload<true> & {
    skill: Prisma.SkillGetPayload<true>;
  })[];
  thirdPartyMcp: Prisma.AgentThirdPartyMcpGetPayload<true>[];
  access: Prisma.AgentAccessGetPayload<true>[];
};

const HYDRATED_INCLUDE = {
  toolBindings: { include: { tool: true } },
  skillBindings: { include: { skill: true } },
  thirdPartyMcp: true,
  access: true,
} as const satisfies Prisma.AgentInclude;

const cache = new Map<string, HydratedAgent>();

/**
 * Read a fully-hydrated agent by slug, with a small in-process cache.
 * Routes that mutate the agent must call `invalidateAgent(slug)`.
 */
export async function getAgentBySlug(slug: string): Promise<HydratedAgent | null> {
  const cached = cache.get(slug);
  if (cached) return cached;
  const agent = await prisma.agent.findUnique({
    where: { slug },
    include: HYDRATED_INCLUDE,
  });
  if (!agent) return null;
  cache.set(slug, agent);
  return agent;
}

export async function getAgentById(id: string): Promise<HydratedAgent | null> {
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: HYDRATED_INCLUDE,
  });
  if (!agent) return null;
  cache.set(agent.slug, agent);
  return agent;
}

/**
 * Lookup by inbound local part (catch-all Mailgun route resolver).
 */
export async function getAgentByInboundLocalPart(
  localPart: string,
): Promise<HydratedAgent | null> {
  const agent = await prisma.agent.findUnique({
    where: { inboundLocalPart: localPart },
    include: HYDRATED_INCLUDE,
  });
  if (!agent) return null;
  cache.set(agent.slug, agent);
  return agent;
}

export function invalidateAgent(slug?: string): void {
  if (slug) cache.delete(slug);
  else cache.clear();
}

export async function listAgents(): Promise<HydratedAgent[]> {
  return prisma.agent.findMany({
    include: HYDRATED_INCLUDE,
    orderBy: { displayName: "asc" },
  });
}

export type CreateAgentArgs = {
  slug: string;
  displayName: string;
  description?: string;
  systemPrompt?: string;
  createdById?: string | null;
};

/**
 * Create a new agent row. The Anthropic agent + environment are not
 * provisioned yet — the admin clicks "Publish" on the edit page to bind
 * the local row to a real Anthropic agent. This separation lets the admin
 * edit / preview before paying the latency of an Anthropic round-trip.
 */
export async function createAgent(args: CreateAgentArgs): Promise<HydratedAgent> {
  const inboundLocalPart = args.slug;
  const created = await prisma.agent.create({
    data: {
      slug: args.slug,
      displayName: args.displayName,
      description: args.description ?? null,
      systemPrompt: args.systemPrompt ?? "",
      inboundLocalPart,
      createdById: args.createdById ?? null,
    },
    include: HYDRATED_INCLUDE,
  });
  log.info("agents: created", { id: created.id, slug: created.slug });
  return created;
}

export async function deleteAgent(id: string): Promise<void> {
  const agent = await prisma.agent.findUnique({ where: { id } });
  await prisma.agent.delete({ where: { id } });
  if (agent) cache.delete(agent.slug);
  log.info("agents: deleted", { id });
}

export type UpdateAgentArgs = {
  displayName?: string;
  description?: string | null;
  systemPrompt?: string;
  model?: AgentModel;
  emailEnabled?: boolean;
  webEnabled?: boolean;
  accessMode?: "everyone" | "specific";
  inboundLocalPart?: string;
  /**
   * Replace-semantics: every binding the agent should have after the
   * patch, regardless of runtime. The transaction wipes existing rows
   * and re-creates them in one shot.
   */
  toolBindings?: { toolId: string; configJson?: Record<string, unknown> }[];
  skillIds?: string[];
  thirdPartyMcp?: { id?: string; label: string; serverUrl: string; bearer?: string }[];
  accessUserIds?: string[];
};

/**
 * Patch a hydrated agent. Bindings (`toolBindings`, `skillIds`,
 * `thirdPartyMcp`, `accessUserIds`) are replace-semantics: we delete +
 * recreate the join rows in one transaction.
 *
 * Anthropic provisioning is NOT triggered here — call `publishAgent(id)`
 * separately so the UI can batch many edits before paying the round-trip.
 */
export async function updateAgent(
  id: string,
  args: UpdateAgentArgs,
): Promise<HydratedAgent> {
  const existing = await prisma.agent.findUnique({ where: { id } });
  if (!existing) throw new Error(`Agent not found: ${id}`);

  const scalarUpdate: Prisma.AgentUpdateInput = {};
  if (args.displayName !== undefined) scalarUpdate.displayName = args.displayName;
  if (args.description !== undefined) scalarUpdate.description = args.description;
  if (args.systemPrompt !== undefined) scalarUpdate.systemPrompt = args.systemPrompt;
  if (args.model !== undefined) scalarUpdate.model = args.model;
  if (args.emailEnabled !== undefined) scalarUpdate.emailEnabled = args.emailEnabled;
  if (args.webEnabled !== undefined) scalarUpdate.webEnabled = args.webEnabled;
  if (args.accessMode !== undefined) scalarUpdate.accessMode = args.accessMode;
  if (args.inboundLocalPart !== undefined) {
    scalarUpdate.inboundLocalPart = args.inboundLocalPart;
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(scalarUpdate).length > 0) {
      await tx.agent.update({ where: { id }, data: scalarUpdate });
    }

    if (args.toolBindings) {
      await tx.agentToolBinding.deleteMany({ where: { agentId: id } });
      for (const binding of args.toolBindings) {
        await tx.agentToolBinding.create({
          data: {
            agentId: id,
            toolId: binding.toolId,
            configJson: (binding.configJson ?? {}) as Prisma.InputJsonValue,
          },
        });
      }
    }

    if (args.skillIds) {
      await tx.agentSkillBinding.deleteMany({ where: { agentId: id } });
      if (args.skillIds.length > 0) {
        await tx.agentSkillBinding.createMany({
          data: args.skillIds.map((skillId) => ({ agentId: id, skillId })),
        });
      }
    }

    if (args.accessUserIds) {
      await tx.agentAccess.deleteMany({ where: { agentId: id } });
      if (args.accessUserIds.length > 0) {
        await tx.agentAccess.createMany({
          data: args.accessUserIds.map((userId) => ({ agentId: id, userId })),
        });
      }
    }

    if (args.thirdPartyMcp) {
      const existingByLabel = await tx.agentThirdPartyMcp.findMany({
        where: { agentId: id },
      });
      const incomingIds = new Set(args.thirdPartyMcp.map((m) => m.id).filter(Boolean));
      for (const old of existingByLabel) {
        if (!incomingIds.has(old.id)) {
          await tx.agentThirdPartyMcp.delete({ where: { id: old.id } });
        }
      }
      for (const m of args.thirdPartyMcp) {
        if (m.id) {
          await tx.agentThirdPartyMcp.update({
            where: { id: m.id },
            data: { label: m.label, serverUrl: m.serverUrl },
          });
        } else {
          await tx.agentThirdPartyMcp.create({
            data: { agentId: id, label: m.label, serverUrl: m.serverUrl },
          });
        }
      }
    }
  });

  invalidateAgent(existing.slug);
  const updated = await getAgentById(id);
  if (!updated) throw new Error("Agent disappeared during update");
  return updated;
}

/**
 * Materialize the current agent definition into a payload and push it to
 * Anthropic (creating or updating the agent + environment as needed).
 * Records the snapshot in `AgentVersion`.
 */
export async function publishAgent(id: string): Promise<HydratedAgent> {
  const agent = await getAgentById(id);
  if (!agent) throw new Error(`Agent not found: ${id}`);

  const tools = agent.toolBindings.map((b) => ({
    key: b.tool.key,
    runtime: b.tool.runtime as "managed" | "platform",
  }));
  const skillIds = agent.skillBindings
    .map((b) => b.skill.anthropicSkillId)
    .filter((v): v is string => Boolean(v));
  const thirdPartyMcp = agent.thirdPartyMcp.map((tp) => ({
    name: tp.label,
    url: tp.serverUrl,
  }));

  // Verify Anthropic credentials are reachable before attempting provisioning.
  const apiKey = await getServiceSecret(SERVICE_KEYS.ANTHROPIC_API_KEY);
  if (!apiKey) {
    throw new Error("Cannot publish: Anthropic API key not configured (visit /setup).");
  }

  const result = await upsertAnthropicAgent({
    existingAgentId: agent.anthropicAgentId,
    existingEnvironmentId: agent.environmentId,
    slug: agent.slug,
    displayName: agent.displayName,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    tools,
    thirdPartyMcp,
    skillIds,
  });

  await prisma.$transaction(async (tx) => {
    await tx.agent.update({
      where: { id: agent.id },
      data: {
        anthropicAgentId: result.agentId,
        environmentId: result.environmentId,
        anthropicAgentVersion: result.version,
      },
    });
    await tx.agentVersion.create({
      data: {
        agentId: agent.id,
        anthropicVersion: result.version,
        payload: result.payload as Prisma.InputJsonValue,
      },
    });
  });

  invalidateAgent(agent.slug);
  const refreshed = await getAgentById(id);
  if (!refreshed) throw new Error("Agent disappeared during publish");
  log.info("agents: published", {
    id: refreshed.id,
    slug: refreshed.slug,
    version: result.version,
  });
  return refreshed;
}
