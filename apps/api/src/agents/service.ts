import type { Agent, Prisma } from "@open-agents/db";
import type { AgentModel } from "@open-agents/types";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { sealThirdPartyBearer } from "../mcp/thirdPartySecrets.js";
import { buildAgentConfigSnapshot } from "./snapshot.js";

/**
 * Hydrated Agent shape used by route handlers, the run-agent worker, and
 * the MCP route. Includes everything needed to resolve a run end-to-end.
 *
 * `toolBindings` is the only binding table after the unified-catalog
 * change — both managed (Anthropic-executed) and platform (our MCP)
 * bindings live here, discriminated by `tool.runtime`.
 */
export type HydratedAgent = Agent & {
  currentVersion: Prisma.AgentVersionGetPayload<true> | null;
  toolBindings: (Prisma.AgentToolBindingGetPayload<true> & {
    tool: Prisma.ToolGetPayload<true>;
  })[];
  skillBindings: (Prisma.AgentSkillBindingGetPayload<true> & {
    skill: Prisma.SkillGetPayload<true>;
    skillVersion: Prisma.SkillVersionGetPayload<true>;
  })[];
  thirdPartyMcp: Prisma.AgentThirdPartyMcpGetPayload<true>[];
  access: Prisma.AgentAccessGetPayload<true>[];
};

const HYDRATED_INCLUDE = {
  toolBindings: { include: { tool: true } },
  skillBindings: { include: { skill: true, skillVersion: true } },
  thirdPartyMcp: true,
  access: true,
  currentVersion: true,
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
 * Create a new agent row. Runtime config is draft until the admin publishes
 * a version from the edit page.
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
   * Reference stored on `Agent.avatar`. Pass `null` to clear and fall
   * back to the bundled `fallback.png`. The avatar upload route
   * (`POST /api/agents/:slug/avatar`) sets this to a `/static/uploads/...`
   * URL once the file lands on disk.
   */
  avatar?: string | null;
  /**
   * Replace-semantics: every binding the agent should have after the
   * patch, regardless of runtime. The transaction wipes existing rows
   * and re-creates them in one shot.
   */
  toolBindings?: { toolId: string; configJson?: Record<string, unknown> }[];
  skillIds?: string[];
  skillBindings?: { skillId: string; skillVersionId: string }[];
  thirdPartyMcp?: { id?: string; label: string; serverUrl: string; bearer?: string }[];
  accessUserIds?: string[];
};

/**
 * Patch a hydrated agent. Bindings (`toolBindings`, `skillIds`,
 * `thirdPartyMcp`, `accessUserIds`) are replace-semantics: we delete +
 * recreate the join rows in one transaction.
 *
 * Anthropic provisioning is NOT triggered here — call `publishAgent(id)`
 * separately so the UI can batch many edits before freezing a version.
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
  if (args.avatar !== undefined) scalarUpdate.avatar = args.avatar;

  // Resolve dangling foreign keys BEFORE the transaction. The SPA edit
  // form can hold ids that no longer exist (e.g. user deleted a skill in
  // another tab and saved the agent before refreshing). Replace-semantics
  // means we should treat a vanished id the same as "client didn't include
  // it" — silently drop and warn — instead of aborting the whole patch
  // with a Prisma FK violation that wipes every other field change.
  let resolvedToolBindings: UpdateAgentArgs["toolBindings"] = args.toolBindings;
  if (args.toolBindings && args.toolBindings.length > 0) {
    const ids = args.toolBindings.map((b) => b.toolId);
    const existing = await prisma.tool.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((t) => t.id));
    const missing = ids.filter((tid) => !existingIds.has(tid));
    if (missing.length > 0) {
      log.warn("agents: dropping unknown tool ids on update", { agentId: id, missing });
      resolvedToolBindings = args.toolBindings.filter((b) => existingIds.has(b.toolId));
    }
  }

  let resolvedSkillBindings: { skillId: string; skillVersionId: string }[] | undefined;
  if (args.skillBindings) {
    const requested = args.skillBindings;
    const versions = await prisma.skillVersion.findMany({
      where: { id: { in: requested.map((s) => s.skillVersionId) } },
      select: { id: true, skillId: true },
    });
    const versionById = new Map(versions.map((v) => [v.id, v]));
    const missing = requested.filter((s) => {
      const version = versionById.get(s.skillVersionId);
      return version?.skillId !== s.skillId;
    });
    if (missing.length > 0) {
      log.warn("agents: dropping unknown skill bindings on update", {
        agentId: id,
        missing,
      });
    }
    resolvedSkillBindings = requested.filter((s) => {
      const version = versionById.get(s.skillVersionId);
      return version?.skillId === s.skillId;
    });
  } else if (args.skillIds) {
    const skills = await prisma.skill.findMany({
      where: { id: { in: args.skillIds } },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const latestBySkillId = new Map(
      skills
        .map((s) => [s.id, s.versions[0]?.id] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    );
    const missing = args.skillIds.filter((sid) => !latestBySkillId.has(sid));
    if (missing.length > 0) {
      log.warn("agents: dropping unknown or versionless skill ids on update", {
        agentId: id,
        missing,
      });
    }
    resolvedSkillBindings = args.skillIds
      .map((skillId) => {
        const skillVersionId = latestBySkillId.get(skillId);
        return skillVersionId ? { skillId, skillVersionId } : null;
      })
      .filter((v): v is { skillId: string; skillVersionId: string } => Boolean(v));
  }

  let resolvedAccessUserIds: string[] | undefined = args.accessUserIds;
  if (args.accessUserIds && args.accessUserIds.length > 0) {
    const existing = await prisma.user.findMany({
      where: { id: { in: args.accessUserIds } },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((u) => u.id));
    const missing = args.accessUserIds.filter((uid) => !existingIds.has(uid));
    if (missing.length > 0) {
      log.warn("agents: dropping unknown user ids on update", { agentId: id, missing });
      resolvedAccessUserIds = args.accessUserIds.filter((uid) => existingIds.has(uid));
    }
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(scalarUpdate).length > 0) {
      await tx.agent.update({ where: { id }, data: scalarUpdate });
    }

    if (resolvedToolBindings) {
      await tx.agentToolBinding.deleteMany({ where: { agentId: id } });
      for (const binding of resolvedToolBindings) {
        await tx.agentToolBinding.create({
          data: {
            agentId: id,
            toolId: binding.toolId,
            configJson: (binding.configJson ?? {}) as Prisma.InputJsonValue,
          },
        });
      }
    }

    if (resolvedSkillBindings) {
      await tx.agentSkillBinding.deleteMany({ where: { agentId: id } });
      if (resolvedSkillBindings.length > 0) {
        await tx.agentSkillBinding.createMany({
          data: resolvedSkillBindings.map((binding) => ({ agentId: id, ...binding })),
        });
      }
    }

    if (resolvedAccessUserIds) {
      await tx.agentAccess.deleteMany({ where: { agentId: id } });
      if (resolvedAccessUserIds.length > 0) {
        await tx.agentAccess.createMany({
          data: resolvedAccessUserIds.map((userId) => ({ agentId: id, userId })),
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
        const bearerData =
          m.bearer !== undefined
            ? m.bearer.trim()
              ? sealThirdPartyBearer(m.bearer.trim())
              : {
                  bearerCipher: null,
                  bearerIv: null,
                  bearerTag: null,
                }
            : {};

        if (m.id) {
          await tx.agentThirdPartyMcp.update({
            where: { id: m.id },
            data: { label: m.label, serverUrl: m.serverUrl, ...bearerData },
          });
        } else {
          await tx.agentThirdPartyMcp.create({
            data: { agentId: id, label: m.label, serverUrl: m.serverUrl, ...bearerData },
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
 * Freeze the agent's current draft config as a new published version.
 * Runs pin this snapshot; editing bindings afterward does not affect live
 * runs until the admin publishes again.
 */
export async function publishAgent(id: string): Promise<HydratedAgent> {
  const agent = await getAgentById(id);
  if (!agent) throw new Error(`Agent not found: ${id}`);

  const snapshot = await buildAgentConfigSnapshot(agent);

  const latest = await prisma.agentVersion.findFirst({
    where: { agentId: agent.id },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (latest?.versionNumber ?? 0) + 1;

  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.agentVersion.create({
      data: {
        agentId: agent.id,
        versionNumber,
        payload: snapshot as Prisma.InputJsonValue,
      },
    });
    await tx.agent.update({
      where: { id: agent.id },
      data: { currentVersionId: created.id },
    });
    return created;
  });

  invalidateAgent(agent.slug);
  const refreshed = await getAgentById(id);
  if (!refreshed) throw new Error("Agent disappeared during publish");
  log.info("agents: published version", {
    id: refreshed.id,
    slug: refreshed.slug,
    versionId: version.id,
    versionNumber,
  });
  return refreshed;
}
