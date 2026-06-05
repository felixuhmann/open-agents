import type { Hono } from "hono";
import type { AppVariables } from "./types.js";

let appInstance: Hono<{ Variables: AppVariables }> | null = null;

/** Set once at bootstrap so the MCP control-plane can proxy into the same app. */
export function setAppInstance(app: Hono<{ Variables: AppVariables }>): void {
  appInstance = app;
}

export function getAppInstance(): Hono<{ Variables: AppVariables }> {
  if (!appInstance) {
    throw new Error("Hono app not initialized");
  }
  return appInstance;
}
