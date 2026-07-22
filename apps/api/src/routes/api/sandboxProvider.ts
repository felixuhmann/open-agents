import { SelectSandboxProviderInput } from "@open-agents/types";
import { Hono } from "hono";
import { requireAdmin } from "../../auth/middleware.js";
import type { AppVariables } from "../../server/types.js";
import { sandboxProviderSettings } from "../../services/sandboxProviderSettingsInstance.js";

/**
 * Deployment-wide sandbox provider selection.
 *
 * Only reports availability, health, capabilities, the current selection,
 * and warnings — never credentials. Broker tokens come from server-side
 * env/token files and are never returned to the browser or stored in the
 * database.
 */
export const sandboxProviderRoutes = new Hono<{ Variables: AppVariables }>();

sandboxProviderRoutes.get("/", async (c) => {
  requireAdmin(c);
  return c.json(await sandboxProviderSettings.describe());
});

sandboxProviderRoutes.put("/", async (c) => {
  requireAdmin(c);
  const body = SelectSandboxProviderInput.parse(await c.req.json());
  // Fails closed when the target is unavailable; the stored selection is
  // left untouched in that case.
  return c.json(await sandboxProviderSettings.select(body.provider));
});
