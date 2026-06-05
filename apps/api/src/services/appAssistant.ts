import { APP_ASSISTANT_AGENT_SLUG } from "@open-agents/types";
import { getAgentBySlug, publishAgent, updateAgent } from "../agents/service.js";
import { log } from "../log.js";
import { prisma } from "../db.js";

const APP_ASSISTANT_DISPLAY_NAME = "Open Agents assistant";

const APP_ASSISTANT_SYSTEM_PROMPT = `You are the built-in Open Agents application assistant embedded in the admin UI.

Help users operate this deployment. You have platform tools prefixed with \`open_agents_\` that can list, read, create, update, and delete agents when the user has contributor or admin role.

Guidelines:
- Call \`open_agents_list\` before creating agents to avoid duplicate slugs.
- Slugs must be lowercase with letters, digits, and dashes (e.g. \`support-bot\`).
- Creating or updating an agent changes its **draft** config. Remind users to **Publish** from the agent edit page before new runs pick up changes.
- You cannot modify or delete the \`app-assistant\` agent (yourself).
- Be concise. Confirm destructive actions clearly.
- For navigation, point users to /agents in the sidebar when helpful.`;

/**
 * Ensure the reserved app-assistant agent exists, is bound to the Open Agents
 * platform tool handler, and has a published version so widget chat can run.
 */
export async function ensureAppAssistantAgent(): Promise<void> {
  const openAgentsTool = await prisma.tool.findUnique({
    where: { key: "open_agents" },
  });
  if (!openAgentsTool) {
    log.warn("app-assistant: open_agents tool missing; run seedToolCatalog first");
    return;
  }

  let agent = await getAgentBySlug(APP_ASSISTANT_AGENT_SLUG);
  if (!agent) {
    const created = await prisma.agent.create({
      data: {
        slug: APP_ASSISTANT_AGENT_SLUG,
        displayName: APP_ASSISTANT_DISPLAY_NAME,
        description: "In-app assistant for managing this Open Agents deployment",
        systemPrompt: APP_ASSISTANT_SYSTEM_PROMPT,
        inboundLocalPart: APP_ASSISTANT_AGENT_SLUG,
        emailEnabled: false,
        webEnabled: true,
        accessMode: "everyone",
      },
    });
    agent = await getAgentBySlug(created.slug);
    log.info("app-assistant: created agent", { slug: APP_ASSISTANT_AGENT_SLUG });
  }

  if (!agent) return;

  const hasBinding = agent.toolBindings.some((b) => b.toolId === openAgentsTool.id);
  const needsPrompt =
    agent.systemPrompt.trim() !== APP_ASSISTANT_SYSTEM_PROMPT.trim() ||
    agent.displayName !== APP_ASSISTANT_DISPLAY_NAME;

  if (!hasBinding || needsPrompt) {
    await updateAgent(agent.id, {
      displayName: APP_ASSISTANT_DISPLAY_NAME,
      systemPrompt: APP_ASSISTANT_SYSTEM_PROMPT,
      emailEnabled: false,
      webEnabled: true,
      toolBindings: [{ toolId: openAgentsTool.id }],
      skillIds: [],
      mcpServerIds: [],
    });
    agent = (await getAgentBySlug(APP_ASSISTANT_AGENT_SLUG)) ?? agent;
    await publishAgent(agent.id);
    log.info("app-assistant: published after config sync");
    return;
  }

  if (!agent.currentVersionId) {
    await publishAgent(agent.id);
    log.info("app-assistant: published initial version");
  }
}

export async function getAppAssistantStatus(): Promise<{
  agentSlug: string;
  displayName: string;
  avatar: string | null;
  ready: boolean;
}> {
  const agent = await getAgentBySlug(APP_ASSISTANT_AGENT_SLUG);
  return {
    agentSlug: APP_ASSISTANT_AGENT_SLUG,
    displayName: agent?.displayName ?? APP_ASSISTANT_DISPLAY_NAME,
    avatar: agent?.avatar ?? null,
    ready: Boolean(agent?.currentVersionId && agent.webEnabled),
  };
}
