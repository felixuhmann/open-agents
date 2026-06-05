import type { Hono } from "hono";
import type { AppVariables } from "../../server/types.js";

export type ControlPlaneMcpContext = {
  app: Hono<{ Variables: AppVariables }>;
  authHeaders: Headers;
};
