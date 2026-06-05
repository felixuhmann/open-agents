import {
  oAuthDiscoveryMetadata,
  oAuthProtectedResourceMetadata,
} from "better-auth/plugins";
import { Hono } from "hono";
import { auth } from "../auth/index.js";

export const wellKnownRoutes = new Hono();

/**
 * Root-level OAuth discovery endpoints for MCP clients (Claude Desktop, etc.).
 * Better Auth also serves these under `/api/auth/.well-known/*`, but many MCP
 * clients fall back to the origin root when they cannot parse WWW-Authenticate.
 */
wellKnownRoutes.get("/oauth-authorization-server", async (c) =>
  oAuthDiscoveryMetadata(auth)(c.req.raw),
);
wellKnownRoutes.get("/oauth-protected-resource", async (c) =>
  oAuthProtectedResourceMetadata(auth)(c.req.raw),
);
