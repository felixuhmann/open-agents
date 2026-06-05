import { AppAssistantDto } from "@open-agents/types";
import { Hono } from "hono";
import { canOperateAgents, requireUser } from "../../auth/middleware.js";
import { getAppAssistantStatus } from "../../services/appAssistant.js";
import type { AppVariables } from "../../server/types.js";

export const appAssistantRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * Metadata for the in-app assistant widget (reserved `app-assistant` agent).
 */
appAssistantRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const status = await getAppAssistantStatus();
  return c.json(
    AppAssistantDto.parse({
      ...status,
      canManageAgents: canOperateAgents(user),
    }),
  );
});
