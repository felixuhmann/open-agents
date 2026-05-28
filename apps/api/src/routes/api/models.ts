import { Hono } from "hono";
import { ModelCatalogDto } from "@open-agents/types";
import { requireUser } from "../../auth/middleware.js";
import { buildModelCatalog } from "../../services/modelCatalog.js";
import type { AppVariables } from "../../server/types.js";

export const modelsRoutes = new Hono<{ Variables: AppVariables }>();

/** Dynamic Pi model catalog for the agent editor (any signed-in user). */
modelsRoutes.get("/catalog", async (c) => {
  requireUser(c);
  const catalog = await buildModelCatalog();
  return c.json(ModelCatalogDto.parse(catalog));
});
