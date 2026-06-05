import { Hono } from "hono";
import { CreateWorkflowInput, UpdateWorkflowInput } from "@open-agents/types";
import {
  HttpError,
  canOperateAgents,
  requireAgentOperator,
  requireUser,
  requireWorkflowAccess,
} from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { parseStarterPrompts } from "../../agents/starterPrompts.js";
import { getServiceSecret, SERVICE_KEYS } from "../../secrets/service.js";
import type { AppVariables } from "../../server/types.js";
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflowById,
  getWorkflowBySlug,
  type HydratedWorkflow,
  listWorkflows,
  publishWorkflow,
  updateWorkflow,
} from "../../workflows/service.js";

export const workflowsRoutes = new Hono<{ Variables: AppVariables }>();

function toSummary(w: HydratedWorkflow) {
  return {
    id: w.id,
    slug: w.slug,
    displayName: w.displayName,
    description: w.description,
    webEnabled: w.webEnabled,
    accessMode: w.accessMode,
    stepCount: w.steps.length,
    published: Boolean(w.currentVersionId),
  };
}

function toDto(w: HydratedWorkflow, mailgunDomain?: string | null) {
  return {
    id: w.id,
    slug: w.slug,
    displayName: w.displayName,
    description: w.description,
    starterPrompts: parseStarterPrompts(w.starterPrompts),
    emailEnabled: w.emailEnabled,
    inboundLocalPart: w.inboundLocalPart,
    webEnabled: w.webEnabled,
    accessMode: w.accessMode,
    currentVersionId: w.currentVersionId,
    currentVersionNumber: w.currentVersion?.versionNumber ?? null,
    publishedAt: w.currentVersion?.createdAt.toISOString() ?? null,
    steps: [...w.steps]
      .sort((a, b) => a.position - b.position)
      .map((step) => ({
        position: step.position,
        agentId: step.agentId,
        agentSlug: step.agent.slug,
        agentDisplayName: step.agent.displayName,
        agentAvatar: step.agent.avatar,
        agentPublished: Boolean(step.agent.currentVersionId),
      })),
    accessUserIds: w.access.map((a) => a.userId),
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
    mailgunDomain: mailgunDomain ?? null,
  };
}

workflowsRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const all = await listWorkflows();
  const visible = canOperateAgents(user)
    ? all
    : all.filter(
        (w) =>
          w.accessMode === "everyone" || w.access.some((acc) => acc.userId === user.id),
      );
  return c.json({ workflows: visible.map(toSummary) });
});

workflowsRoutes.post("/", async (c) => {
  const user = requireAgentOperator(c);
  const body = CreateWorkflowInput.parse(await c.req.json());
  const existing = await getWorkflowBySlug(body.slug);
  if (existing) throw new HttpError(409, "slug already exists");
  const workflow = await createWorkflow({
    slug: body.slug,
    displayName: body.displayName,
    description: body.description,
    createdById: user.id,
  });
  return c.json(toDto(workflow));
});

workflowsRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const workflow = await getWorkflowBySlug(slug);
  if (!workflow) throw new HttpError(404, "workflow not found");
  await requireWorkflowAccess(c, workflow.id);
  const mailgunDomain = await getServiceSecret(SERVICE_KEYS.MAILGUN_DOMAIN);
  return c.json(toDto(workflow, mailgunDomain));
});

workflowsRoutes.patch("/:slug", async (c) => {
  requireAgentOperator(c);
  const slug = c.req.param("slug");
  const workflow = await getWorkflowBySlug(slug);
  if (!workflow) throw new HttpError(404, "workflow not found");
  const body = UpdateWorkflowInput.parse(await c.req.json());
  const updated = await updateWorkflow(workflow.id, {
    ...body,
    description: body.description ?? undefined,
  });
  const mailgunDomain = await getServiceSecret(SERVICE_KEYS.MAILGUN_DOMAIN);
  return c.json(toDto(updated, mailgunDomain));
});

workflowsRoutes.post("/:slug/publish", async (c) => {
  requireAgentOperator(c);
  const slug = c.req.param("slug");
  const workflow = await getWorkflowBySlug(slug);
  if (!workflow) throw new HttpError(404, "workflow not found");
  const published = await publishWorkflow(workflow.id);
  const mailgunDomain = await getServiceSecret(SERVICE_KEYS.MAILGUN_DOMAIN);
  return c.json(toDto(published, mailgunDomain));
});

workflowsRoutes.delete("/:slug", async (c) => {
  requireAgentOperator(c);
  const slug = c.req.param("slug");
  const workflow = await getWorkflowBySlug(slug);
  if (!workflow) throw new HttpError(404, "workflow not found");
  await deleteWorkflow(workflow.id);
  return c.json({ ok: true });
});

workflowsRoutes.get("/:slug/access", async (c) => {
  requireAgentOperator(c);
  const slug = c.req.param("slug");
  const workflow = await getWorkflowBySlug(slug);
  if (!workflow) throw new HttpError(404, "workflow not found");
  const refreshed = await getWorkflowById(workflow.id);
  const allUsers = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true },
    orderBy: { email: "asc" },
  });
  const grantedIds = new Set(refreshed?.access.map((a) => a.userId) ?? []);
  return c.json({
    accessMode: refreshed?.accessMode ?? "everyone",
    users: allUsers.map((u) => ({ ...u, granted: grantedIds.has(u.id) })),
  });
});
