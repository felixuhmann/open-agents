import type { Prisma } from "@open-agents/db";
import {
  AgentConfigSnapshot,
  type AgentConfigSnapshot as AgentConfigSnapshotType,
} from "@open-agents/types";
import type { HydratedAgent } from "./service.js";
import { getAgentBackend } from "../agent-backend/instance.js";
import { resolveDraftSandboxPolicy } from "../services/sandboxPolicy.js";
import { HttpError } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { log } from "../log.js";

export type VersionedAgent = HydratedAgent & {
  agentVersionId: string;
  versionNumber: number;
  configSnapshot: AgentConfigSnapshotType;
};

/**
 * Build a provider-neutral config snapshot from the agent's current draft
 * bindings. The active backend at publish time is recorded in `runtime`.
 */
export async function buildAgentConfigSnapshot(
  agent: HydratedAgent,
): Promise<AgentConfigSnapshotType> {
  const backend = await getAgentBackend();

  const toolBindings = agent.toolBindings.map((b) => ({
    bindingId: b.id,
    toolId: b.toolId,
    key: b.tool.key,
    runtime: b.tool.runtime as "managed" | "platform",
    configJson: (b.configJson ?? {}) as Record<string, unknown>,
  }));

  const managedTools = toolBindings.filter((t) => t.runtime === "managed");
  const platformTools = toolBindings.filter((t) => t.runtime === "platform");
  const sandbox = resolveDraftSandboxPolicy(agent);

  return AgentConfigSnapshot.parse({
    schemaVersion: 1,
    systemPrompt: agent.systemPrompt,
    modelProvider: agent.modelProvider,
    modelId: agent.modelId,
    managedTools,
    platformTools,
    thirdPartyMcp: agent.mcpBindings.map((b) => ({
      mcpServerId: b.mcpServer.id,
      label: b.mcpServer.label,
      serverUrl: b.mcpServer.serverUrl,
    })),
    skillBindings: agent.skillBindings.map((b) => ({
      skillId: b.skillId,
      skillVersionId: b.skillVersionId,
      skillName: b.skill.name,
      versionNumber: b.skillVersion.versionNumber,
    })),
    runtime: { backend: backend.runtime, sandbox },
  });
}

export function parseAgentConfigSnapshot(payload: unknown): AgentConfigSnapshotType {
  return AgentConfigSnapshot.parse(payload);
}

/**
 * Resolve the published version id an agent must have before accepting runs.
 */
export async function requirePublishedVersionId(agentId: string): Promise<string> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { currentVersionId: true, slug: true },
  });
  if (!agent?.currentVersionId) {
    throw new HttpError(
      409,
      `Agent "${agent?.slug ?? agentId}" has no published version. Publish a version before running.`,
    );
  }
  return agent.currentVersionId;
}

/**
 * Load a frozen version row by id.
 */
export async function getAgentVersionById(versionId: string) {
  return prisma.agentVersion.findUnique({ where: { id: versionId } });
}

/**
 * Apply a published snapshot onto a hydrated agent for runtime execution.
 * Live third-party MCP rows are merged by id so bearer tokens stay current.
 */
export async function loadVersionedAgent(
  agent: HydratedAgent,
  versionId: string,
): Promise<VersionedAgent> {
  const version = await getAgentVersionById(versionId);
  if (version?.agentId !== agent.id) {
    throw new Error(`AgentVersion not found for agent: ${versionId}`);
  }

  const snapshot = parseAgentConfigSnapshot(version.payload);
  const allToolSnapshots = [...snapshot.managedTools, ...snapshot.platformTools];

  const toolIds = [...new Set(allToolSnapshots.map((t) => t.toolId))];
  const tools = await prisma.tool.findMany({ where: { id: { in: toolIds } } });
  const toolById = new Map(tools.map((t) => [t.id, t]));

  const skillVersionIds = snapshot.skillBindings.map((s) => s.skillVersionId);
  const skillVersions = await prisma.skillVersion.findMany({
    where: { id: { in: skillVersionIds } },
    include: { skill: true },
  });
  const skillVersionById = new Map(skillVersions.map((v) => [v.id, v]));

  const toolBindings: HydratedAgent["toolBindings"] = [];
  for (const tb of allToolSnapshots) {
    const tool = toolById.get(tb.toolId);
    if (!tool) {
      log.warn("versioned-agent: tool missing from catalog", {
        agentId: agent.id,
        versionId,
        toolId: tb.toolId,
        key: tb.key,
      });
      continue;
    }
    toolBindings.push({
      id: tb.bindingId,
      agentId: agent.id,
      toolId: tb.toolId,
      configJson: (tb.configJson ?? {}) as Prisma.JsonValue,
      createdAt: version.createdAt,
      tool,
    });
  }

  const skillBindings: HydratedAgent["skillBindings"] = [];
  for (const sb of snapshot.skillBindings) {
    const skillVersion = skillVersionById.get(sb.skillVersionId);
    if (skillVersion?.skillId !== sb.skillId) {
      log.warn("versioned-agent: skill version missing", {
        agentId: agent.id,
        versionId,
        skillVersionId: sb.skillVersionId,
      });
      continue;
    }
    skillBindings.push({
      agentId: agent.id,
      skillId: sb.skillId,
      skillVersionId: sb.skillVersionId,
      createdAt: version.createdAt,
      skill: skillVersion.skill,
      skillVersion,
    });
  }

  const mcpServerIds = new Set(snapshot.thirdPartyMcp.map((m) => m.mcpServerId));
  const mcpBindings = agent.mcpBindings.filter((b) => mcpServerIds.has(b.mcpServerId));

  return {
    ...agent,
    systemPrompt: snapshot.systemPrompt,
    modelProvider: snapshot.modelProvider,
    modelId: snapshot.modelId,
    toolBindings,
    skillBindings,
    mcpBindings,
    agentVersionId: version.id,
    versionNumber: version.versionNumber,
    configSnapshot: snapshot,
  };
}

/**
 * Load versioned agent config for a run, falling back to the run's pinned version.
 */
export async function loadAgentForRun(
  agent: HydratedAgent,
  agentVersionId: string | null,
): Promise<VersionedAgent> {
  const versionId = agentVersionId ?? agent.currentVersionId;
  if (!versionId) {
    throw new Error(`Agent "${agent.slug}" has no published version pinned on this run`);
  }
  return loadVersionedAgent(agent, versionId);
}
