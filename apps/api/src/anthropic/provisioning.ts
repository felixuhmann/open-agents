import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "../agent-backend/instance.js";
import { config } from "../config.js";
import { log } from "../log.js";

/**
 * One tool the agent has been bound to via `AgentToolBinding`. Already
 * resolved against the catalog so the provisioner can group by runtime
 * without another DB round-trip.
 */
export type ProvisionedTool = {
  key: string;
  runtime: "managed" | "platform";
};

/**
 * Inputs for provisioning (create or update) an Anthropic agent from a
 * locally-defined Agent row + its bindings. This is the only place that
 * translates our domain shape into the Managed Agents request payload.
 */
export type ProvisioningPayload = {
  /** Existing Anthropic agent id, when updating. */
  existingAgentId: string | null;
  /**
   * Anthropic's agent version we last saw (1, 2, …). Required by
   * `agents.update` for optimistic concurrency; ignored on first publish.
   * Stored as a string in `Agent.anthropicAgentVersion`; pass through as
   * a number here.
   */
  existingAgentVersion: number | null;
  /** Existing Anthropic environment id, when updating. */
  existingEnvironmentId: string | null;
  /** `Agent.slug` — used to derive the per-agent MCP server name. */
  slug: string;
  /** Human-readable name. Sent as `name` (not `display_name`). */
  displayName: string;
  /** Anthropic model identifier (e.g. `claude-opus-4-7`). */
  model: string;
  systemPrompt: string;
  /** Resolved `AgentToolBinding[]` — every runtime, in any order. */
  tools: readonly ProvisionedTool[];
  /**
   * Third-party MCP servers the user attached. Their tools are exposed
   * via a matching `mcp_toolset` entry in the published `tools` array.
   */
  thirdPartyMcp: ReadonlyArray<{
    name: string;
    url: string;
    /** Anthropic-side bearer credential id (vault entry) for this server. */
    credentialId?: string;
  }>;
  /** Anthropic skill ids attached to this agent. */
  skillIds: readonly string[];
};

export type ProvisioningResult = {
  agentId: string;
  environmentId: string;
  version: string | null;
  payload: Record<string, unknown>;
};

/** Stable name the published agent uses to reference our MCP server. */
function buildPlatformMcpName(slug: string): string {
  return `open-agents-${slug}`;
}

/**
 * Build the canonical MCP server URL this backend exposes for an agent.
 * The Anthropic sandbox calls into this URL to invoke MCP tools.
 */
export function buildMcpServerUrl(agentSlug: string): string {
  return `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/mcp/${agentSlug}`;
}

/**
 * Translate `(Tool, AgentToolBinding)[] + AgentThirdPartyMcp[]` into the
 * Managed Agents `tools` + `mcp_servers` request shape. Layout follows
 * Anthropic's spec exactly:
 *
 * - One `agent_toolset_20260401` block, default-disabled, with one
 *   `configs[]` entry per bound managed tool (`enabled: true`,
 *   `permission_policy: always_allow`). Default-disabled is the safe
 *   choice — admins opt in via the UI; we don't want unticked tools
 *   leaking through.
 * - One `mcp_toolset` per server in `mcp_servers`. For our backend
 *   server we only emit the entry when at least one platform tool is
 *   bound; otherwise the agent would advertise an empty MCP surface.
 *   Third-party servers always get one entry — the user attached them
 *   to use them.
 */
function buildToolsAndServers(p: ProvisioningPayload): {
  tools: Record<string, unknown>[];
  mcpServers: Record<string, unknown>[];
} {
  const tools: Record<string, unknown>[] = [];

  const managedKeys = p.tools.filter((t) => t.runtime === "managed").map((t) => t.key);
  tools.push({
    type: "agent_toolset_20260401",
    default_config: {
      enabled: false,
      permission_policy: { type: "always_allow" },
    },
    configs: managedKeys.map((name) => ({
      name,
      enabled: true,
      permission_policy: { type: "always_allow" },
    })),
  });

  const mcpServers: Record<string, unknown>[] = [];
  const platformBound = p.tools.some((t) => t.runtime === "platform");
  if (platformBound) {
    const platformMcpName = buildPlatformMcpName(p.slug);
    mcpServers.push({
      type: "url",
      name: platformMcpName,
      url: buildMcpServerUrl(p.slug),
    });
    tools.push({
      type: "mcp_toolset",
      mcp_server_name: platformMcpName,
      default_config: {
        enabled: true,
        permission_policy: { type: "always_allow" },
      },
    });
  }

  for (const tp of p.thirdPartyMcp) {
    mcpServers.push({
      type: "url",
      name: tp.name,
      url: tp.url,
      ...(tp.credentialId ? { credential_id: tp.credentialId } : {}),
    });
    tools.push({
      type: "mcp_toolset",
      mcp_server_name: tp.name,
      default_config: {
        enabled: true,
        permission_policy: { type: "always_allow" },
      },
    });
  }

  return { tools, mcpServers };
}

function buildAgentPayload(p: ProvisioningPayload): Record<string, unknown> {
  const { tools, mcpServers } = buildToolsAndServers(p);
  return {
    name: p.displayName,
    model: p.model,
    system: p.systemPrompt,
    tools,
    mcp_servers: mcpServers,
    // All locally-uploaded skill bundles publish as `custom`; pinning
    // `version: "latest"` keeps re-publishes pointing at the newest
    // bundle without us tracking version numbers manually.
    skills: p.skillIds.map((id) => ({
      type: "custom",
      skill_id: id,
      version: "latest",
    })),
  };
}

type AnthropicBeta = Anthropic["beta"];

interface AgentsResource {
  create(body: Record<string, unknown>): Promise<unknown>;
  update(id: string, body: Record<string, unknown>): Promise<unknown>;
}

interface EnvironmentsResource {
  create(body: Record<string, unknown>): Promise<unknown>;
}

function getAgentsResource(beta: AnthropicBeta): AgentsResource {
  const r = (beta as unknown as { agents?: AgentsResource }).agents;
  if (!r) {
    throw new Error(
      "Anthropic SDK has no `beta.agents` resource — upgrade @anthropic-ai/sdk.",
    );
  }
  return r;
}

function getEnvironmentsResource(beta: AnthropicBeta): EnvironmentsResource {
  const r = (beta as unknown as { environments?: EnvironmentsResource }).environments;
  if (!r) {
    throw new Error(
      "Anthropic SDK has no `beta.environments` resource — upgrade @anthropic-ai/sdk.",
    );
  }
  return r;
}

function pickId(value: unknown, label: string): string {
  if (typeof value === "object" && value !== null && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  throw new Error(`Anthropic ${label} response did not include an id`);
}

function pickVersion(value: unknown): string | null {
  if (typeof value === "object" && value !== null && "version" in value) {
    const v = (value as { version?: unknown }).version;
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

/**
 * Create the Agent + Environment if missing, or update the Agent if it
 * exists. Returns the (possibly newly minted) Anthropic ids and the
 * version string Anthropic returned.
 */
export async function upsertAnthropicAgent(
  p: ProvisioningPayload,
): Promise<ProvisioningResult> {
  const client = await getAnthropicClient();
  const payload = buildAgentPayload(p);

  let environmentId = p.existingEnvironmentId;
  if (!environmentId) {
    const envRes = await getEnvironmentsResource(client.beta).create({
      name: `${p.displayName} environment`,
    });
    environmentId = pickId(envRes, "environments.create");
    log.info("anthropic: environment created", { environmentId });
  }

  let agentId = p.existingAgentId;
  let version: string | null;
  if (!agentId) {
    const agentRes = await getAgentsResource(client.beta).create(payload);
    agentId = pickId(agentRes, "agents.create");
    version = pickVersion(agentRes);
    log.info("anthropic: agent created", { agentId, version });
  } else {
    if (p.existingAgentVersion === null) {
      throw new Error(
        `Cannot update Anthropic agent ${agentId}: no stored version. ` +
          `Anthropic's update endpoint requires the current version for ` +
          `optimistic concurrency. Re-create the agent or backfill ` +
          `Agent.anthropicAgentVersion first.`,
      );
    }
    // Anthropic's `agents.update` requires `version` for optimistic
    // concurrency. We always send the full configured shape — `tools`,
    // `mcp_servers`, and `skills` are full replacements, every other
    // field overwrites the prior value.
    const updatePayload = { ...payload, version: p.existingAgentVersion };
    const agentRes = await getAgentsResource(client.beta).update(agentId, updatePayload);
    version = pickVersion(agentRes);
    log.info("anthropic: agent updated", {
      agentId,
      fromVersion: p.existingAgentVersion,
      version,
    });
  }

  return { agentId, environmentId, version, payload };
}
