import { File } from "node:buffer";
import { Hono } from "hono";
import { CreateAgentInput, UpdateAgentInput } from "@open-agents/types";
import { resolveDraftSandboxPolicy } from "../../services/sandboxPolicy.js";
import { parseStarterPrompts } from "../../agents/starterPrompts.js";
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
  canOperateAgents,
  requireAgentAccess,
  requireAgentOperator,
  requireUser,
} from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { getServiceSecret, SERVICE_KEYS } from "../../secrets/service.js";
import type { AppVariables } from "../../server/types.js";
import {
  deleteBrandingAsset,
  MAX_BRANDING_BYTES,
  saveBrandingImage,
} from "../../services/uploads.js";

export const agentsRoutes = new Hono<{ Variables: AppVariables }>();

function nonEmptyTrimmed(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function nullableNonEmptyTrimmed(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  return nonEmptyTrimmed(value) ?? null;
}

function toSummary(agent: {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  category: string | null;
  avatar: string | null;
  emailEnabled: boolean;
  webEnabled: boolean;
  profileAccessEnabled: boolean;
  accessMode: string;
}) {
  return {
    id: agent.id,
    slug: agent.slug,
    displayName: agent.displayName,
    description: agent.description,
    category: agent.category,
    avatar: agent.avatar,
    emailEnabled: agent.emailEnabled,
    webEnabled: agent.webEnabled,
    profileAccessEnabled: agent.profileAccessEnabled,
    accessMode: agent.accessMode,
  };
}

function toDto(
  agent: Awaited<ReturnType<typeof listAgents>>[number],
  mailgunDomain?: string | null,
) {
  const sandboxPolicy = resolveDraftSandboxPolicy(agent);
  return {
    id: agent.id,
    slug: agent.slug,
    displayName: agent.displayName,
    description: agent.description,
    category: agent.category,
    starterPrompts: parseStarterPrompts(agent.starterPrompts),
    systemPrompt: agent.systemPrompt,
    modelProvider: agent.modelProvider,
    modelId: agent.modelId,
    avatar: agent.avatar,
    emailEnabled: agent.emailEnabled,
    webEnabled: agent.webEnabled,
    profileAccessEnabled: agent.profileAccessEnabled,
    accessMode: agent.accessMode,
    inboundLocalPart: agent.inboundLocalPart,
    mailgunDomain: mailgunDomain ?? null,
    currentVersionId: agent.currentVersionId,
    currentVersionNumber: agent.currentVersion?.versionNumber ?? null,
    publishedAt: agent.currentVersion?.createdAt.toISOString() ?? null,
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
    skillBindings: agent.skillBindings.map((s) => ({
      skillId: s.skillId,
      skillVersionId: s.skillVersionId,
    })),
    skills: agent.skillBindings.map((s) => ({
      id: s.skill.id,
      name: s.skill.name,
      versionId: s.skillVersion.id,
      versionNumber: s.skillVersion.versionNumber,
    })),
    mcpServers: agent.mcpBindings.map((b) => ({
      id: b.mcpServer.id,
      name: b.mcpServer.name,
      label: b.mcpServer.label,
      serverUrl: b.mcpServer.serverUrl,
    })),
    mcpServerIds: agent.mcpBindings.map((b) => b.mcpServerId),
    accessUserIds: agent.access.map((a) => a.userId),
    sandboxNetworkPolicy: sandboxPolicy.network,
    sandboxCommandPolicy: sandboxPolicy.command,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

agentsRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const all = await listAgents();
  const visible = canOperateAgents(user)
    ? all
    : all.filter(
        (a) =>
          a.accessMode === "everyone" || a.access.some((acc) => acc.userId === user.id),
      );
  return c.json({ agents: visible.map(toSummary) });
});

agentsRoutes.post("/", async (c) => {
  const user = requireAgentOperator(c);
  const body = CreateAgentInput.parse(await c.req.json());
  const existing = await getAgentBySlug(body.slug);
  if (existing) throw new HttpError(409, "slug already exists");
  const agent = await createAgent({
    slug: body.slug,
    displayName: body.displayName,
    description: nonEmptyTrimmed(body.description),
    category: nonEmptyTrimmed(body.category),
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
  const mailgunDomain = await getServiceSecret(SERVICE_KEYS.MAILGUN_DOMAIN);
  return c.json(toDto(agent, mailgunDomain));
});

agentsRoutes.patch("/:slug", async (c) => {
  requireAgentOperator(c);
  const slug = c.req.param("slug");
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new HttpError(404, "agent not found");
  const body = UpdateAgentInput.parse(await c.req.json());
  const updated = await updateAgent(agent.id, {
    ...body,
    description: nullableNonEmptyTrimmed(body.description),
    category: nullableNonEmptyTrimmed(body.category),
  });
  const mailgunDomain = await getServiceSecret(SERVICE_KEYS.MAILGUN_DOMAIN);
  return c.json(toDto(updated, mailgunDomain));
});

agentsRoutes.post("/:slug/publish", async (c) => {
  requireAgentOperator(c);
  const slug = c.req.param("slug");
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new HttpError(404, "agent not found");
  const published = await publishAgent(agent.id);
  return c.json(toDto(published));
});

agentsRoutes.delete("/:slug", async (c) => {
  requireAgentOperator(c);
  const slug = c.req.param("slug");
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new HttpError(404, "agent not found");
  if (agent.avatar) {
    await deleteBrandingAsset({ kind: "avatars", urlOrFilename: agent.avatar });
  }
  await deleteAgent(agent.id);
  return c.json({ ok: true });
});

/**
 * Upload (or replace) the agent's profile picture. Stored on disk under
 * `apps/api/data/uploads/avatars/` and served from `/static/uploads/...`.
 * The previous file (if any) is deleted so the upload directory doesn't
 * accumulate orphans.
 */
agentsRoutes.post("/:slug/avatar", async (c) => {
  requireAgentOperator(c);
  const slug = c.req.param("slug");
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new HttpError(404, "agent not found");

  let form: Awaited<ReturnType<typeof c.req.parseBody>>;
  try {
    form = await c.req.parseBody({ all: false });
  } catch {
    throw new HttpError(400, "invalid multipart body");
  }
  const file = form.file;
  if (!(file instanceof File)) throw new HttpError(400, "missing 'file' field");
  if (file.size === 0) throw new HttpError(400, "empty file");
  if (file.size > MAX_BRANDING_BYTES) {
    throw new HttpError(413, `file too large (>${MAX_BRANDING_BYTES} bytes)`);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let saved;
  try {
    saved = await saveBrandingImage({
      kind: "avatars",
      prefix: agent.slug,
      bytes,
      contentType: file.type || "application/octet-stream",
      originalName: file.name || "avatar",
    });
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }

  if (agent.avatar) {
    await deleteBrandingAsset({ kind: "avatars", urlOrFilename: agent.avatar });
  }
  const updated = await updateAgent(agent.id, { avatar: saved.url });
  return c.json(toDto(updated));
});

agentsRoutes.delete("/:slug/avatar", async (c) => {
  requireAgentOperator(c);
  const slug = c.req.param("slug");
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new HttpError(404, "agent not found");
  if (agent.avatar) {
    await deleteBrandingAsset({ kind: "avatars", urlOrFilename: agent.avatar });
  }
  const updated = await updateAgent(agent.id, { avatar: null });
  return c.json(toDto(updated));
});

/**
 * List the deployment-wide users plus per-agent ACL overlay. Used by the
 * agent edit page to show who has access.
 */
agentsRoutes.get("/:slug/access", async (c) => {
  requireAgentOperator(c);
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
