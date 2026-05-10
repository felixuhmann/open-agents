import type { AuthUser } from "../auth/middleware.js";

/**
 * Shared per-request variable shape attached to every Hono context. Routes
 * declare `Hono<{ Variables: AppVariables }>` so they can `c.get('user')`
 * and `c.get('reqId')` without per-route gymnastics.
 */
export type AppVariables = {
  reqId: string;
  user: AuthUser | null;
};
