import type { AgentVersionProviderRefs } from "@open-agents/types";
import { upsertAnthropicAgent } from "../anthropic/provisioning.js";
import { ensureMcpCredential } from "../anthropic/vault.js";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { getServiceSecret, SERVICE_KEYS } from "../secrets/service.js";
import type { HydratedAgent } from "./service.js";
import { listAgentMcpServers } from "./service.js";
import { parseAgentConfigSnapshot } from "./snapshot.js";

function parseAnthropicVersion(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * @deprecated Anthropic remote provisioning is no longer part of publish.
 * Kept for migration scripts and eventual removal. Syncs the current draft
 * config to Anthropic Managed Agents and stores provider refs on the latest
 * `AgentVersion` row when one exists.
 */
export async function syncAgentToAnthropic(agent: HydratedAgent): Promise<void> {
  const apiKey = await getServiceSecret(SERVICE_KEYS.ANTHROPIC_API_KEY);
  if (!apiKey) {
    throw new Error("Cannot sync to Anthropic: API key not configured (visit /setup).");
  }

  const tools = agent.toolBindings.map((b) => ({
    key: b.tool.key,
    runtime: b.tool.runtime as "managed" | "platform",
  }));
  const skillIds = agent.skillBindings
    .map((b) => b.skillVersion.anthropicSkillId)
    .filter((v): v is string => Boolean(v));
  const thirdPartyMcp = listAgentMcpServers(agent).map((tp) => ({
    name: tp.label,
    url: tp.serverUrl,
  }));

  const result = await upsertAnthropicAgent({
    existingAgentId: agent.anthropicAgentId,
    existingAgentVersion: parseAnthropicVersion(agent.anthropicAgentVersion),
    existingEnvironmentId: agent.environmentId,
    slug: agent.slug,
    displayName: agent.displayName,
    model: agent.modelId,
    systemPrompt: agent.systemPrompt,
    tools,
    thirdPartyMcp,
    skillIds,
  });

  let credential: { id: string; url: string } | null = null;
  const hasPlatformTools = tools.some((t) => t.runtime === "platform");
  if (hasPlatformTools) {
    credential = await ensureMcpCredential({
      slug: agent.slug,
      existingId: agent.anthropicMcpCredentialId,
      existingUrl: agent.anthropicMcpCredentialUrl,
    });
  }

  const providerRefs: AgentVersionProviderRefs = {
    anthropic: {
      agentId: result.agentId,
      environmentId: result.environmentId,
      version: result.version ?? "",
      ...(credential
        ? {
            mcpCredentialId: credential.id,
            mcpCredentialUrl: credential.url,
          }
        : {}),
    },
  };

  await prisma.$transaction(async (tx) => {
    await tx.agent.update({
      where: { id: agent.id },
      data: {
        anthropicAgentId: result.agentId,
        environmentId: result.environmentId,
        anthropicAgentVersion: result.version,
        ...(credential
          ? {
              anthropicMcpCredentialId: credential.id,
              anthropicMcpCredentialUrl: credential.url,
            }
          : {}),
      },
    });

    const latestVersion = await tx.agentVersion.findFirst({
      where: { agentId: agent.id },
      orderBy: { versionNumber: "desc" },
    });
    if (latestVersion) {
      await tx.agentVersion.update({
        where: { id: latestVersion.id },
        data: {
          anthropicVersion: result.version,
          providerRefs,
        },
      });
    }
  });

  log.info("agents: synced to Anthropic (deprecated path)", {
    id: agent.id,
    slug: agent.slug,
    version: result.version,
  });
}

/**
 * Translate a published snapshot into Anthropic provisioning inputs.
 * Used only by the deprecated sync path when snapshot-backed publish exists.
 */
export function anthropicInputsFromSnapshot(agent: HydratedAgent, payload: unknown) {
  const snapshot = parseAgentConfigSnapshot(payload);
  const tools = [...snapshot.managedTools, ...snapshot.platformTools].map((t) => ({
    key: t.key,
    runtime: t.runtime,
  }));
  return {
    model: snapshot.modelId,
    systemPrompt: snapshot.systemPrompt,
    tools,
    thirdPartyMcp: snapshot.thirdPartyMcp.map((m) => ({
      name: m.label,
      url: m.serverUrl,
    })),
    skillIds: [] as string[],
  };
}
