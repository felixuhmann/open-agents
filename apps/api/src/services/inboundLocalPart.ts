import { prisma } from "../db.js";

/**
 * Returns whether `localPart` is already claimed by an agent or workflow
 * (optionally excluding one row being updated).
 */
export async function isInboundLocalPartTaken(
  localPart: string,
  exclude?: { agentId?: string; workflowId?: string },
): Promise<boolean> {
  const normalized = localPart.trim().toLowerCase();
  if (!normalized) return true;

  const [agent, workflow] = await Promise.all([
    prisma.agent.findUnique({
      where: { inboundLocalPart: normalized },
      select: { id: true },
    }),
    prisma.workflow.findUnique({
      where: { inboundLocalPart: normalized },
      select: { id: true },
    }),
  ]);

  if (agent && agent.id !== exclude?.agentId) return true;
  if (workflow && workflow.id !== exclude?.workflowId) return true;
  return false;
}
