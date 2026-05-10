import { Hono } from "hono";
import { CreateAgentInput, UpdateAgentInput } from "@open-agents/types";
import {
  createAgent,
  deleteAgent,
  getAgentById,
  getAgentBySlug,
  listAgents,
  publishAgent,
  updateAgent,
} from "../../agents/service.js";
import {
  HttpError,
  requireAdmin,
  requireAgentAccess,
  requireUser,
} from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";

export const agentsRoutes = new Hono<{ Variables: AppVariables }>();

function toSummary(agent: {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  emailEnabled: boolean;
  webEnabled: boolean;
  accessMode: string;
}) {
  return {
    id: agent.id,
    slug: agent.slug,
    displayName: agent.displayName,
    description: agent.description,
    emailEnabled: agent.emailEnabled,
    webEnabled: agent.webEnabled,
    accessMode: agent.accessMode,
  };
}

function toDto(agent: Awaited<ReturnType<typeof listAgents>>[number]) {
  return {
    id: agent.id,
    slug: agent.slug,
    displayName: agent.displayName,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    model: agent.model,
    avatar: agent.avatar,
    emailEnabled: agent.emailEnabled,
    webEnabled: agent.webEnabled,
    accessMode: agent.accessMode,
    inboundLocalPart: agent.inboundLocalPart,
    anthropicAgentId: agent.anthropicAgentId,
    environmentId: agent.environmentId,
    anthropicAgentVersion: agent.anthropicAgentVersion,
    toolBindings: agent.toolBindings.map((b) => ({
      id: b.id,
      toolId: b.toolId,
      tool: {
        id: b.tool.id,
        key: b.tool.key,
        name: b.tool.name,
        runtime: b.tool.runtime,
      },
      configJson: b.configJson,
    })),
    skillIds: agent.skillBindings.map((s) => s.skillId),
    skills: agent.skillBindings.map((s) => ({
      id: s.skill.id,
      name: s.skill.name,
    })),
    thirdPartyMcp: agent.thirdPartyMcp.map((m) => ({
      id: m.id,
      label: m.label,
      serverUrl: m.serverUrl,
    })),
    accessUserIds: agent.access.map((a) => a.userId),
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

agentsRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const all = await listAgents();
  const visible =
    user.role === "admin"
      ? all
      : all.filter(
          (a) =>
            a.accessMode === "everyone" || a.access.some((acc) => acc.userId === user.id),
        );
  return c.json({ agents: visible.map(toSummary) });
});

agentsRoutes.post("/", async (c) => {
  const user = requireAdmin(c);
  const body = CreateAgentInput.parse(await c.req.json());
  const existing = await getAgentBySlug(body.slug);
  if (existing) throw new HttpError(409, "slug already exists");
  const agent = await createAgent({
    slug: body.slug,
    displayName: body.displayName,
    description: body.description,
    systemPrompt: body.systemPrompt,
    createdById: user.id,
  });
  return c.json(toDto(agent));
});

agentsRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new HttpError(404, "agent not found");
  await requireAgentAccess(c, agent.id);
  return c.json(toDto(agent));
});

agentsRoutes.patch("/:slug", async (c) => {
  requireAdmin(c);
  const slug = c.req.param("slug");
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new HttpError(404, "agent not found");
  const body = UpdateAgentInput.parse(await c.req.json());
  const updated = await updateAgent(agent.id, {
    ...body,
    description: body.description ?? undefined,
  });
  return c.json(toDto(updated));
});

agentsRoutes.post("/:slug/publish", async (c) => {
  requireAdmin(c);
  const slug = c.req.param("slug");
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new HttpError(404, "agent not found");
  const published = await publishAgent(agent.id);
  return c.json(toDto(published));
});

agentsRoutes.delete("/:slug", async (c) => {
  requireAdmin(c);
  const slug = c.req.param("slug");
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new HttpError(404, "agent not found");
  await deleteAgent(agent.id);
  return c.json({ ok: true });
});

/**
 * List the deployment-wide users plus per-agent ACL overlay. Used by the
 * agent edit page to show who has access.
 */
agentsRoutes.get("/:slug/access", async (c) => {
  requireAdmin(c);
  const slug = c.req.param("slug");
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new HttpError(404, "agent not found");
  const refreshed = await getAgentById(agent.id);
  const allUsers = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true },
    orderBy: { email: "asc" },
  });
  const grantedIds = new Set(refreshed?.access.map((a) => a.userId) ?? []);
  return c.json({
    accessMode: refreshed?.accessMode ?? "everyone",
    users: allUsers.map((u) => ({
      ...u,
      granted: grantedIds.has(u.id),
    })),
  });
});
