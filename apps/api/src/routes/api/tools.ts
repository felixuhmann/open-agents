import { Hono } from "hono";
import { requireUser } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";

export const toolsRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * Unified tool catalog. Read-only — entries are seeded from
 * `services/seedToolCatalog.ts` on bootstrap (both managed-runtime
 * OpenSandbox sandbox tools and platform-runtime MCP handlers).
 *
 * Deprecated rows are returned so old bindings still render in the
 * agent edit page; the UI hides them from the picker but keeps showing
 * any agent that's already bound to one.
 */
toolsRoutes.get("/", async (c) => {
  requireUser(c);
  const tools = await prisma.tool.findMany({
    orderBy: [{ runtime: "asc" }, { name: "asc" }],
  });
  return c.json({
    tools: tools.map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      description: t.description,
      runtime: t.runtime,
      configSchema: t.configSchema,
      requiresSecrets: t.requiresSecrets,
      deprecated: t.deprecated,
    })),
  });
});
