import type { Prisma, Workflow } from "@open-agents/db";
import type { StarterPrompts } from "@open-agents/types";
import { HttpError } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { isInboundLocalPartTaken } from "../services/inboundLocalPart.js";
import { buildWorkflowConfigSnapshot } from "./snapshot.js";

/**
 * Hydrated Workflow shape used by routes + the pipeline runner. Steps include
 * the referenced agent (and its current version) so the editor can show
 * publish state and the snapshot builder can pin versions.
 */
export type HydratedWorkflow = Workflow & {
  currentVersion: Prisma.WorkflowVersionGetPayload<true> | null;
  steps: (Prisma.WorkflowStepGetPayload<true> & {
    agent: Prisma.AgentGetPayload<{ include: { currentVersion: true } }>;
  })[];
  access: Prisma.WorkflowAccessGetPayload<true>[];
};

const HYDRATED_INCLUDE = {
  currentVersion: true,
  steps: {
    include: { agent: { include: { currentVersion: true } } },
    orderBy: { position: "asc" },
  },
  access: true,
} as const satisfies Prisma.WorkflowInclude;

const cache = new Map<string, HydratedWorkflow>();

/** Lookup by inbound local part (catch-all Mailgun route resolver). */
export async function getWorkflowByInboundLocalPart(
  localPart: string,
): Promise<HydratedWorkflow | null> {
  const workflow = await prisma.workflow.findUnique({
    where: { inboundLocalPart: localPart },
    include: HYDRATED_INCLUDE,
  });
  if (!workflow) return null;
  cache.set(workflow.slug, workflow);
  return workflow;
}

export async function getWorkflowBySlug(slug: string): Promise<HydratedWorkflow | null> {
  const cached = cache.get(slug);
  if (cached) return cached;
  const workflow = await prisma.workflow.findUnique({
    where: { slug },
    include: HYDRATED_INCLUDE,
  });
  if (!workflow) return null;
  cache.set(slug, workflow);
  return workflow;
}

export async function getWorkflowById(id: string): Promise<HydratedWorkflow | null> {
  const workflow = await prisma.workflow.findUnique({
    where: { id },
    include: HYDRATED_INCLUDE,
  });
  if (!workflow) return null;
  cache.set(workflow.slug, workflow);
  return workflow;
}

export function invalidateWorkflow(slug?: string): void {
  if (slug) cache.delete(slug);
  else cache.clear();
}

export async function listWorkflows(): Promise<HydratedWorkflow[]> {
  return prisma.workflow.findMany({
    include: HYDRATED_INCLUDE,
    orderBy: { displayName: "asc" },
  });
}

export type CreateWorkflowArgs = {
  slug: string;
  displayName: string;
  description?: string;
  createdById?: string | null;
};

export async function createWorkflow(
  args: CreateWorkflowArgs,
): Promise<HydratedWorkflow> {
  const inboundLocalPart = args.slug;
  if (await isInboundLocalPartTaken(inboundLocalPart)) {
    throw new HttpError(
      409,
      `Inbound address "${inboundLocalPart}" is already in use by an agent or workflow.`,
    );
  }
  const created = await prisma.workflow.create({
    data: {
      slug: args.slug,
      displayName: args.displayName,
      description: args.description ?? null,
      inboundLocalPart,
      createdById: args.createdById ?? null,
    },
    include: HYDRATED_INCLUDE,
  });
  log.info("workflows: created", { id: created.id, slug: created.slug });
  return created;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const workflow = await prisma.workflow.findUnique({ where: { id } });
  await prisma.workflow.delete({ where: { id } });
  if (workflow) cache.delete(workflow.slug);
  log.info("workflows: deleted", { id });
}

export type UpdateWorkflowArgs = {
  displayName?: string;
  description?: string | null;
  starterPrompts?: StarterPrompts;
  emailEnabled?: boolean;
  webEnabled?: boolean;
  inboundLocalPart?: string;
  accessMode?: "everyone" | "specific";
  /** Replace-semantics: ordered agent ids the pipeline runs. */
  steps?: { agentId: string }[];
  accessUserIds?: string[];
};

export async function updateWorkflow(
  id: string,
  args: UpdateWorkflowArgs,
): Promise<HydratedWorkflow> {
  const existing = await prisma.workflow.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "workflow not found");

  const scalarUpdate: Prisma.WorkflowUpdateInput = {};
  if (args.displayName !== undefined) scalarUpdate.displayName = args.displayName;
  if (args.description !== undefined) scalarUpdate.description = args.description;
  if (args.starterPrompts !== undefined)
    scalarUpdate.starterPrompts = args.starterPrompts;
  if (args.emailEnabled !== undefined) scalarUpdate.emailEnabled = args.emailEnabled;
  if (args.webEnabled !== undefined) scalarUpdate.webEnabled = args.webEnabled;
  if (args.accessMode !== undefined) scalarUpdate.accessMode = args.accessMode;
  if (args.inboundLocalPart !== undefined) {
    const normalized = args.inboundLocalPart.trim().toLowerCase();
    if (!normalized) throw new HttpError(400, "inboundLocalPart cannot be empty");
    if (
      await isInboundLocalPartTaken(normalized, {
        workflowId: id,
      })
    ) {
      throw new HttpError(
        409,
        `Inbound address "${normalized}" is already in use by an agent or workflow.`,
      );
    }
    scalarUpdate.inboundLocalPart = normalized;
  }

  // Drop unknown agent ids (an agent may have been deleted in another tab)
  // rather than aborting the whole patch with an FK violation.
  let resolvedSteps: { agentId: string }[] | undefined = args.steps;
  if (args.steps) {
    const ids = args.steps.map((s) => s.agentId);
    const found = await prisma.agent.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((a) => a.id));
    const missing = ids.filter((aid) => !foundIds.has(aid));
    if (missing.length > 0) {
      log.warn("workflows: dropping unknown agent ids on update", { id, missing });
      resolvedSteps = args.steps.filter((s) => foundIds.has(s.agentId));
    }
  }

  let resolvedAccessUserIds: string[] | undefined = args.accessUserIds;
  if (args.accessUserIds && args.accessUserIds.length > 0) {
    const found = await prisma.user.findMany({
      where: { id: { in: args.accessUserIds } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((u) => u.id));
    resolvedAccessUserIds = args.accessUserIds.filter((uid) => foundIds.has(uid));
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(scalarUpdate).length > 0) {
      await tx.workflow.update({ where: { id }, data: scalarUpdate });
    }
    if (resolvedSteps) {
      await tx.workflowStep.deleteMany({ where: { workflowId: id } });
      if (resolvedSteps.length > 0) {
        await tx.workflowStep.createMany({
          data: resolvedSteps.map((step, index) => ({
            workflowId: id,
            agentId: step.agentId,
            position: index,
          })),
        });
      }
    }
    if (resolvedAccessUserIds) {
      await tx.workflowAccess.deleteMany({ where: { workflowId: id } });
      if (resolvedAccessUserIds.length > 0) {
        await tx.workflowAccess.createMany({
          data: resolvedAccessUserIds.map((userId) => ({ workflowId: id, userId })),
        });
      }
    }
  });

  invalidateWorkflow(existing.slug);
  const updated = await getWorkflowById(id);
  if (!updated) throw new Error("Workflow disappeared during update");
  return updated;
}

/**
 * Freeze the workflow's current draft pipeline as a new published version.
 */
export async function publishWorkflow(id: string): Promise<HydratedWorkflow> {
  const workflow = await getWorkflowById(id);
  if (!workflow) throw new HttpError(404, "workflow not found");

  const snapshot = buildWorkflowConfigSnapshot(workflow);

  const latest = await prisma.workflowVersion.findFirst({
    where: { workflowId: workflow.id },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (latest?.versionNumber ?? 0) + 1;

  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        versionNumber,
        payload: snapshot,
      },
    });
    await tx.workflow.update({
      where: { id: workflow.id },
      data: { currentVersionId: created.id },
    });
    return created;
  });

  invalidateWorkflow(workflow.slug);
  const refreshed = await getWorkflowById(id);
  if (!refreshed) throw new Error("Workflow disappeared during publish");
  log.info("workflows: published version", {
    id: refreshed.id,
    slug: refreshed.slug,
    versionId: version.id,
    versionNumber,
  });
  return refreshed;
}

export async function requirePublishedWorkflowVersionId(
  workflowId: string,
): Promise<string> {
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    select: { currentVersionId: true, slug: true },
  });
  if (!workflow?.currentVersionId) {
    throw new HttpError(
      409,
      `Workflow "${workflow?.slug ?? workflowId}" has no published version. Publish before running.`,
    );
  }
  return workflow.currentVersionId;
}
