import { Hono } from "hono";
import { cors } from "hono/cors";
import { attachUser } from "../auth/middleware.js";
import { config } from "../config.js";
import { agentsRoutes } from "../routes/api/agents.js";
import { analyticsRoutes } from "../routes/api/analytics.js";
import { conversationsRoutes } from "../routes/api/conversations.js";
import { issuesRoutes } from "../routes/api/issues.js";
import { profileRoutes } from "../routes/api/profile.js";
import { runsRoutes } from "../routes/api/runs.js";
import { sandboxesRoutes } from "../routes/api/sandboxes.js";
import { scheduledTasksRoutes } from "../routes/api/scheduledTasks.js";
import { secretsRoutes } from "../routes/api/secrets.js";
import { settingsRoutes } from "../routes/api/settings.js";
import { mcpConnectionRoutes } from "../routes/api/mcpConnection.js";
import { mcpServersRoutes } from "../routes/api/mcpServers.js";
import { skillsRoutes } from "../routes/api/skills.js";
import { toolsRoutes } from "../routes/api/tools.js";
import { modelsRoutes } from "../routes/api/models.js";
import { usersRoutes } from "../routes/api/users.js";
import { workflowsRoutes } from "../routes/api/workflows.js";
import { workflowConversationsRoutes } from "../routes/api/workflowConversations.js";
import { workflowRunsRoutes } from "../routes/api/workflowRuns.js";
import { authRoutes } from "../routes/auth.js";
import { healthRoutes } from "../routes/health.js";
import {
  issueReportRoutes,
  ISSUE_REPORT_PREFIX,
  shouldMountLegacyIssueReportRoutes,
} from "../routes/issueReport.js";
import { mailgunRoutes } from "../routes/mailgun.js";
import { mcpRoutes, MCP_PREFIX } from "../routes/mcp.js";
import { wellKnownRoutes } from "../routes/wellKnown.js";
import {
  APP_ROUTE_PREFIXES,
  AUTH_PREFIX,
  HEALTH_PREFIX,
  MAILGUN_PREFIX,
  SETUP_PREFIX,
  STATIC_PREFIX,
} from "../routes/prefixes.js";
import { setupRoutes } from "../routes/setup.js";
import { staticRoutes } from "../routes/static.js";
import { uploadRoutes } from "../routes/upload.js";
import { webRoutes } from "../routes/web.js";
import { applyRequestLogMiddleware } from "./middleware/requestLog.js";
import type { AppVariables } from "./types.js";

/**
 * Construct the Hono app. Order matters:
 *
 * 1. Request-log middleware (sets reqId before any handler logs).
 * 2. CORS so the SPA on `WEB_BASE_URL` can call the API with credentials.
 * 3. attachUser middleware globally so handlers can `requireUser(c)`.
 * 4. Mount each sub-router at its prefix.
 * 5. Mount the SPA catch-all LAST so every prefixed router above wins.
 *
 * The Mailgun webhook lives alongside the API but is machine-authenticated
 * with HMAC and doesn't need cookie-based auth — `attachUser` is harmless
 * on that path.
 */
export function buildApp(): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();

  applyRequestLogMiddleware(app, APP_ROUTE_PREFIXES);

  app.use(
    "*",
    cors({
      origin: [config.WEB_BASE_URL, config.PUBLIC_BASE_URL],
      credentials: true,
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "Last-Event-ID",
        "mcp-session-id",
        "mcp-protocol-version",
      ],
      exposeHeaders: [
        "Last-Event-ID",
        "mcp-session-id",
        "mcp-protocol-version",
        "WWW-Authenticate",
      ],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );

  app.use("*", attachUser());

  app.route(AUTH_PREFIX, authRoutes);

  app.route("/api/agents", agentsRoutes);
  app.route("/api/analytics", analyticsRoutes);
  app.route("/api/conversations", conversationsRoutes);
  app.route("/api/issues", issuesRoutes);
  app.route("/api/profile", profileRoutes);
  app.route("/api/runs", runsRoutes);
  app.route("/api/sandboxes", sandboxesRoutes);
  app.route("/api/scheduled-tasks", scheduledTasksRoutes);
  app.route("/api/secrets", secretsRoutes);
  app.route("/api/settings", settingsRoutes);
  app.route("/api/mcp-connection", mcpConnectionRoutes);
  app.route("/api/mcp-servers", mcpServersRoutes);
  app.route("/api/skills", skillsRoutes);
  app.route("/api/tools", toolsRoutes);
  app.route("/api/models", modelsRoutes);
  app.route("/api/users", usersRoutes);
  app.route("/api/workflows", workflowsRoutes);
  app.route("/api/workflow-conversations", workflowConversationsRoutes);
  app.route("/api/workflow-runs", workflowRunsRoutes);

  app.route(SETUP_PREFIX, setupRoutes);
  app.route(HEALTH_PREFIX, healthRoutes);
  app.route(MAILGUN_PREFIX, mailgunRoutes);
  app.route(STATIC_PREFIX, staticRoutes);
  if (shouldMountLegacyIssueReportRoutes()) {
    app.route(ISSUE_REPORT_PREFIX, issueReportRoutes);
  }
  app.route("/", uploadRoutes);

  // OAuth discovery for MCP clients — before SPA catch-all.
  app.route("/.well-known", wellKnownRoutes);

  // Control-plane MCP (Streamable HTTP) — before SPA catch-all.
  app.route(MCP_PREFIX, mcpRoutes);

  // SPA catch-all — must be last so every prefixed router above wins. In
  // production this serves the built `apps/web` bundle from `../web/dist`
  // (CWD-relative, since `node` is launched from `apps/api/`); in dev it's
  // dormant because Vite serves the SPA on its own port.
  app.route("/", webRoutes);

  return app;
}
