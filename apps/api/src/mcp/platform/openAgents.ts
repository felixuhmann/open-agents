import { CreateAgentInput, UpdateAgentInput } from "@open-agents/types";
import { z } from "zod";
import {
  AppAgentManagementError,
  openAgentsCreateAgent,
  openAgentsDeleteAgent,
  openAgentsGetAgent,
  openAgentsListAgents,
  openAgentsUpdateAgent,
} from "../../services/appAgentManagement.js";
import { defineTool, type PlatformHandler } from "../types.js";

const SlugInput = z.object({
  slug: z.string().min(1).max(60),
});

const CreateInput = CreateAgentInput;

const UpdateInput = z.object({
  slug: z.string().min(1).max(60),
  patch: UpdateAgentInput,
});

function requireActingUser(ctx: { actingUserId?: string }): string {
  if (!ctx.actingUserId) {
    throw new AppAgentManagementError(
      "Open Agents management tools require a signed-in user (app assistant chat only)",
    );
  }
  return ctx.actingUserId;
}

async function runTool<T>(fn: () => Promise<T>): Promise<unknown> {
  try {
    return await fn();
  } catch (err) {
    const message =
      err instanceof AppAgentManagementError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    throw new AppAgentManagementError(message);
  }
}

export const openAgentsHandler: PlatformHandler = {
  key: "open_agents",
  name: "Open Agents admin",
  description:
    "Manage agents in this deployment (list, read, create, update, delete). Actions run as the signed-in user and require contributor or admin role.",
  tools: [
    defineTool({
      name: "open_agents_list",
      description:
        "List all agents in the deployment (excluding the built-in app assistant). Returns id, slug, displayName, surfaces, and publish state.",
      input: z.object({}),
      handler: async (_input, ctx) =>
        runTool(() => openAgentsListAgents(requireActingUser(ctx))),
    }),
    defineTool({
      name: "open_agents_get",
      description: "Fetch full draft configuration for one agent by slug.",
      input: SlugInput,
      handler: async (input, ctx) =>
        runTool(() => openAgentsGetAgent(requireActingUser(ctx), input.slug)),
    }),
    defineTool({
      name: "open_agents_create",
      description:
        "Create a new agent (draft). Slug must be lowercase letters, digits, and dashes. Publish from the UI before the agent can run.",
      input: CreateInput,
      handler: async (input, ctx) =>
        runTool(() => openAgentsCreateAgent(requireActingUser(ctx), input)),
    }),
    defineTool({
      name: "open_agents_update",
      description:
        "Patch an agent's draft configuration (display name, prompt, model, tools, skills, MCP servers, access). Same fields as the agent edit API.",
      input: UpdateInput,
      handler: async (input, ctx) =>
        runTool(() =>
          openAgentsUpdateAgent(requireActingUser(ctx), input.slug, input.patch),
        ),
    }),
    defineTool({
      name: "open_agents_delete",
      description: "Permanently delete an agent and its conversations.",
      input: SlugInput,
      handler: async (input, ctx) =>
        runTool(() => openAgentsDeleteAgent(requireActingUser(ctx), input.slug)),
    }),
  ],
};
