import { AUTH_PREFIX } from "./auth.js";
import { HEALTH_PREFIX } from "./health.js";
import { ISSUE_REPORT_PREFIX } from "./issueReport.js";
import { MAILGUN_PREFIX } from "./mailgun.js";
import { MCP_PREFIX } from "./mcp.js";
import { SETUP_PREFIX } from "./setup.js";
import { STATIC_PREFIX } from "./static.js";
import { UPLOAD_PREFIX } from "./upload.js";

export const API_PREFIX = "/api";

export {
  AUTH_PREFIX,
  HEALTH_PREFIX,
  ISSUE_REPORT_PREFIX,
  MAILGUN_PREFIX,
  MCP_PREFIX,
  SETUP_PREFIX,
  STATIC_PREFIX,
  UPLOAD_PREFIX,
};

/**
 * Path prefixes the request-log middleware treats as "real app" traffic
 * (full start/done logs). Everything else is logged once as scanner noise.
 */
export const APP_ROUTE_PREFIXES = [
  HEALTH_PREFIX,
  MAILGUN_PREFIX,
  MCP_PREFIX,
  STATIC_PREFIX,
  UPLOAD_PREFIX,
  SETUP_PREFIX,
  AUTH_PREFIX,
  API_PREFIX,
  ISSUE_REPORT_PREFIX,
] as const;
