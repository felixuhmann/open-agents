/**
 * Human-readable catalog of REST endpoints the control-plane MCP server can
 * proxy. Kept in sync with `apps/api/src/routes/` — when you add a route,
 * add a row here so MCP clients can discover it via `api_catalog`.
 */

export type ApiCatalogEntry = {
  method: string;
  path: string;
  description: string;
  auth: "public" | "user" | "operator" | "admin";
};

export const API_CATALOG: ApiCatalogEntry[] = [
  // Agents
  { method: "GET", path: "/api/agents", description: "List agents", auth: "user" },
  { method: "POST", path: "/api/agents", description: "Create agent", auth: "operator" },
  {
    method: "GET",
    path: "/api/agents/:slug",
    description: "Get agent by slug",
    auth: "user",
  },
  {
    method: "PATCH",
    path: "/api/agents/:slug",
    description: "Update agent draft",
    auth: "operator",
  },
  {
    method: "POST",
    path: "/api/agents/:slug/publish",
    description: "Publish agent version",
    auth: "operator",
  },
  {
    method: "DELETE",
    path: "/api/agents/:slug",
    description: "Delete agent",
    auth: "operator",
  },
  {
    method: "GET",
    path: "/api/agents/:slug/access",
    description: "Get agent access list",
    auth: "operator",
  },

  // Chat
  {
    method: "GET",
    path: "/api/conversations",
    description: "List conversations",
    auth: "user",
  },
  {
    method: "POST",
    path: "/api/conversations",
    description: "Create conversation",
    auth: "user",
  },
  {
    method: "GET",
    path: "/api/conversations/:id",
    description: "Get conversation",
    auth: "user",
  },
  {
    method: "GET",
    path: "/api/conversations/:id/trace",
    description: "Get conversation trace",
    auth: "operator",
  },
  {
    method: "POST",
    path: "/api/conversations/:id/messages",
    description: "Send chat message",
    auth: "user",
  },
  {
    method: "GET",
    path: "/api/runs/:runId/events",
    description: "SSE run events (prefer GET conversation for history)",
    auth: "user",
  },
  {
    method: "GET",
    path: "/api/runs/:runId/attachments",
    description: "List run attachments",
    auth: "user",
  },
  {
    method: "GET",
    path: "/api/runs/:runId/attachments/:attachmentId",
    description: "Download run attachment",
    auth: "user",
  },

  // Workflows
  { method: "GET", path: "/api/workflows", description: "List workflows", auth: "user" },
  {
    method: "POST",
    path: "/api/workflows",
    description: "Create workflow",
    auth: "operator",
  },
  {
    method: "GET",
    path: "/api/workflows/:slug",
    description: "Get workflow",
    auth: "user",
  },
  {
    method: "PATCH",
    path: "/api/workflows/:slug",
    description: "Update workflow",
    auth: "operator",
  },
  {
    method: "POST",
    path: "/api/workflows/:slug/publish",
    description: "Publish workflow",
    auth: "operator",
  },
  {
    method: "DELETE",
    path: "/api/workflows/:slug",
    description: "Delete workflow",
    auth: "operator",
  },
  {
    method: "GET",
    path: "/api/workflow-conversations",
    description: "List workflow conversations",
    auth: "user",
  },
  {
    method: "POST",
    path: "/api/workflow-conversations",
    description: "Create workflow conversation",
    auth: "user",
  },
  {
    method: "GET",
    path: "/api/workflow-conversations/:id",
    description: "Get workflow conversation",
    auth: "user",
  },
  {
    method: "POST",
    path: "/api/workflow-conversations/:id/messages",
    description: "Send workflow message",
    auth: "user",
  },
  {
    method: "GET",
    path: "/api/workflow-runs/:workflowRunId/events",
    description: "SSE workflow run events",
    auth: "user",
  },

  // Library & config
  { method: "GET", path: "/api/tools", description: "List tool catalog", auth: "user" },
  {
    method: "GET",
    path: "/api/models/catalog",
    description: "List model catalog",
    auth: "user",
  },
  { method: "GET", path: "/api/skills", description: "List skills", auth: "user" },
  {
    method: "POST",
    path: "/api/skills",
    description: "Upload skill bundle",
    auth: "admin",
  },
  {
    method: "GET",
    path: "/api/mcp-servers",
    description: "List MCP servers",
    auth: "user",
  },
  {
    method: "POST",
    path: "/api/mcp-servers",
    description: "Create MCP server",
    auth: "admin",
  },
  {
    method: "POST",
    path: "/api/mcp-servers/probe",
    description: "Probe MCP server URL",
    auth: "admin",
  },
  {
    method: "GET",
    path: "/api/mcp-connection/info",
    description: "MCP server URL for external clients",
    auth: "user",
  },
  {
    method: "POST",
    path: "/api/mcp-connection/tokens",
    description: "Generate MCP bearer token",
    auth: "user",
  },
  {
    method: "GET",
    path: "/api/mcp-connection/tokens",
    description: "List active MCP bearer tokens",
    auth: "user",
  },

  // Admin
  { method: "GET", path: "/api/users", description: "List users", auth: "admin" },
  { method: "POST", path: "/api/users", description: "Create user", auth: "admin" },
  { method: "PATCH", path: "/api/users/:id", description: "Update user", auth: "admin" },
  { method: "DELETE", path: "/api/users/:id", description: "Delete user", auth: "admin" },
  {
    method: "GET",
    path: "/api/secrets",
    description: "List secret keys (not values)",
    auth: "admin",
  },
  {
    method: "PUT",
    path: "/api/secrets/:key",
    description: "Set service secret",
    auth: "admin",
  },
  {
    method: "DELETE",
    path: "/api/secrets/:key",
    description: "Delete secret",
    auth: "admin",
  },
  { method: "GET", path: "/api/settings", description: "List settings", auth: "user" },
  {
    method: "GET",
    path: "/api/settings/public",
    description: "Public settings",
    auth: "public",
  },
  {
    method: "PUT",
    path: "/api/settings/:key",
    description: "Update setting",
    auth: "admin",
  },
  { method: "GET", path: "/api/sandboxes", description: "List sandboxes", auth: "admin" },
  {
    method: "GET",
    path: "/api/analytics",
    description: "Usage analytics",
    auth: "operator",
  },
  { method: "GET", path: "/api/issues", description: "List issues", auth: "operator" },
  {
    method: "GET",
    path: "/api/profile",
    description: "Current user profile",
    auth: "user",
  },
  { method: "GET", path: "/health", description: "Health check", auth: "public" },
  {
    method: "GET",
    path: "/health/ready",
    description: "Readiness check",
    auth: "public",
  },
];

export function formatApiCatalog(): string {
  const lines = API_CATALOG.map(
    (e) => `${e.method.padEnd(7)} ${e.path.padEnd(45)} [${e.auth}] ${e.description}`,
  );
  return lines.join("\n");
}
