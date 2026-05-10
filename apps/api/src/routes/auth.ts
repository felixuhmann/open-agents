import { Hono } from "hono";
import { auth } from "../auth/index.js";
import { log } from "../log.js";
import type { AppVariables } from "../server/types.js";

export const AUTH_PREFIX = "/api/auth";

export const authRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * Catch-all delegate to better-auth. better-auth handles its own routing
 * (`/api/auth/sign-in`, `/api/auth/session`, etc.) — we just pipe the raw
 * request through and return whatever Response it produces.
 */
authRoutes.all("/*", async (c) => {
  try {
    return await auth.handler(c.req.raw);
  } catch (err) {
    log.error("auth: handler threw", {
      err: err instanceof Error ? err.message : String(err),
      path: c.req.path,
    });
    return c.json({ error: "auth handler error" }, 500);
  }
});
