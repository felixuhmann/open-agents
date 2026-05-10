import { Hono } from "hono";
import { prisma } from "../db.js";
import type { AppVariables } from "../server/types.js";

export const HEALTH_PREFIX = "/health";

export const healthRoutes = new Hono<{ Variables: AppVariables }>();

healthRoutes.get("/", (c) =>
  c.json({
    status: "ok",
    node: process.version,
    platform: process.platform,
    uptimeSec: Math.round(process.uptime()),
  }),
);

healthRoutes.get("/ready", async (c) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return c.json({ status: "ready" });
  } catch (err) {
    return c.json(
      { status: "error", error: err instanceof Error ? err.message : String(err) },
      503,
    );
  }
});
