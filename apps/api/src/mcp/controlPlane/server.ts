import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Hono } from "hono";
import type { AppVariables } from "../../server/types.js";
import { formatApiCatalog } from "./apiCatalog.js";
import { formatProxyResult, proxyApiRequest } from "./apiProxy.js";

export type ControlPlaneMcpContext = {
  app: Hono<{ Variables: AppVariables }>;
  authHeaders: Headers;
};

export function createControlPlaneMcpServer(ctx: ControlPlaneMcpContext): McpServer {
  const server = new McpServer(
    {
      name: "open-agents",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.registerTool(
    "api_request",
    {
      title: "API request",
      description:
        "Call any open-agents REST endpoint. Uses the same handlers as the web UI — " +
        "auth, validation, and permissions are identical. Paths must start with /api/, " +
        "/health, /conversations/, or /workflow-conversations/. " +
        "Use api_catalog to discover available endpoints.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]).describe("HTTP method"),
        path: z
          .string()
          .min(1)
          .describe("URL path, e.g. /api/agents or /api/conversations/:id/messages"),
        query: z
          .record(z.string(), z.string())
          .optional()
          .describe("Query string parameters"),
        body: z.unknown().optional().describe("JSON request body for POST/PATCH/PUT"),
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe("Extra request headers (e.g. content-type for non-JSON)"),
      },
    },
    async ({ method, path, query, body, headers }) => {
      try {
        const result = await proxyApiRequest(
          ctx.app,
          { method, path, query, body, headers },
          ctx.authHeaders,
        );
        return {
          content: [{ type: "text", text: formatProxyResult(result) }],
          isError: result.status >= 400,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `api_request failed: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "api_catalog",
    {
      title: "API catalog",
      description:
        "List REST endpoints available via api_request. " +
        "When new routes are added to the platform, update apiCatalog.ts alongside them.",
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe("Optional substring filter on path or description"),
      },
    },
    ({ filter }) => {
      let catalog = formatApiCatalog();
      if (filter?.trim()) {
        const needle = filter.trim().toLowerCase();
        catalog = catalog
          .split("\n")
          .filter((line) => line.toLowerCase().includes(needle))
          .join("\n");
      }
      return {
        content: [
          {
            type: "text",
            text: catalog || "(no endpoints match filter)",
          },
        ],
      };
    },
  );

  return server;
}
