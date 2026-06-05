import { AnalyticsQuery } from "@open-agents/types";
import { Hono } from "hono";
import { requireAgentOperator } from "../../auth/middleware.js";
import type { AppVariables } from "../../server/types.js";
import { AnalyticsRangeError, buildAnalyticsSummary } from "../../services/analytics.js";

export const analyticsRoutes = new Hono<{ Variables: AppVariables }>();

analyticsRoutes.get("/", async (c) => {
  requireAgentOperator(c);

  const parsed = AnalyticsQuery.safeParse({
    window: c.req.query("window"),
    from: c.req.query("from"),
    to: c.req.query("to"),
  });
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const summary = await buildAnalyticsSummary(parsed.data);
    return c.json(summary);
  } catch (error) {
    if (error instanceof AnalyticsRangeError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});
