import {
  WorkflowConfigSnapshot,
  type WorkflowConfigSnapshot as WorkflowConfigSnapshotType,
} from "@open-agents/types";
import { HttpError } from "../auth/middleware.js";
import { prisma } from "../db.js";
import type { HydratedWorkflow } from "./service.js";

/**
 * Freeze the workflow's ordered draft steps into a publishable snapshot. Each
 * step pins the referenced agent's currently-published version, so the
 * pipeline is stable even if member agents are re-published later.
 */
export function buildWorkflowConfigSnapshot(
  workflow: HydratedWorkflow,
): WorkflowConfigSnapshotType {
  if (workflow.steps.length === 0) {
    throw new HttpError(409, "Add at least one step before publishing the workflow.");
  }
  const steps = [...workflow.steps]
    .sort((a, b) => a.position - b.position)
    .map((step, index) => {
      const agent = step.agent;
      if (!agent.currentVersionId || !agent.currentVersion) {
        throw new HttpError(
          409,
          `Agent "${agent.slug}" has no published version. Publish it before publishing the workflow.`,
        );
      }
      return {
        position: index,
        agentId: agent.id,
        agentSlug: agent.slug,
        agentDisplayName: agent.displayName,
        agentVersionId: agent.currentVersionId,
        agentVersionNumber: agent.currentVersion.versionNumber,
      };
    });
  return WorkflowConfigSnapshot.parse({ schemaVersion: 1, steps });
}

export function parseWorkflowConfigSnapshot(payload: unknown): WorkflowConfigSnapshotType {
  return WorkflowConfigSnapshot.parse(payload);
}

/**
 * Resolve the pinned snapshot for a workflow run, falling back to the
 * workflow's current published version.
 */
export async function loadWorkflowSnapshotForRun(
  workflowId: string,
  workflowVersionId: string | null,
): Promise<WorkflowConfigSnapshotType> {
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    select: { currentVersionId: true, slug: true },
  });
  const versionId = workflowVersionId ?? workflow?.currentVersionId;
  if (!versionId) {
    throw new Error(
      `Workflow "${workflow?.slug ?? workflowId}" has no published version pinned on this run`,
    );
  }
  const version = await prisma.workflowVersion.findUnique({ where: { id: versionId } });
  if (version?.workflowId !== workflowId) {
    throw new Error(`WorkflowVersion not found for workflow: ${versionId}`);
  }
  return parseWorkflowConfigSnapshot(version.payload);
}
