import type { Hono } from "hono";
import type { AppVariables } from "../../server/types.js";

const BLOCKED_PREFIXES = ["/mcp", "/mailgun", "/issues/report"];

const ALLOWED_PREFIXES = [
  "/api/",
  "/health",
  "/conversations/",
  "/workflow-conversations/",
];

export type ApiProxyRequest = {
  method: string;
  path: string;
  query?: Record<string, string> | undefined;
  body?: unknown;
  headers?: Record<string, string> | undefined;
};

export type ApiProxyResult = {
  status: number;
  headers: Record<string, string>;
  body: string;
  contentType: string | null;
};

function validatePath(path: string): void {
  if (!path.startsWith("/")) {
    throw new Error("path must start with /");
  }
  for (const blocked of BLOCKED_PREFIXES) {
    if (path === blocked || path.startsWith(`${blocked}/`)) {
      throw new Error(`path ${path} is not allowed via MCP`);
    }
  }
  const allowed = ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix),
  );
  if (!allowed) {
    throw new Error(
      `path must start with one of: ${ALLOWED_PREFIXES.join(", ")} (got ${path})`,
    );
  }
}

function buildUrl(path: string, query?: Record<string, string>): string {
  const url = new URL(path, "http://internal.local");
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.pathname + url.search;
}

/**
 * Forward a REST call into the same Hono app the SPA uses. Auth, validation,
 * and business logic all run through the existing route handlers — no drift.
 */
export async function proxyApiRequest(
  app: Hono<{ Variables: AppVariables }>,
  request: ApiProxyRequest,
  authHeaders: Headers,
): Promise<ApiProxyResult> {
  const method = request.method.toUpperCase();
  if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) {
    throw new Error(`unsupported method: ${method}`);
  }

  validatePath(request.path);
  const url = buildUrl(request.path, request.query);

  const headers = new Headers(authHeaders);
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    headers.set(key, value);
  }

  let body: string | undefined;
  if (request.body !== undefined && method !== "GET" && method !== "DELETE") {
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
  }

  const res = await app.request(url, { method, headers, body });

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const contentType = res.headers.get("content-type");
  const text = await res.text();

  return {
    status: res.status,
    headers: responseHeaders,
    body: text,
    contentType,
  };
}

export function formatProxyResult(result: ApiProxyResult): string {
  const parts = [`HTTP ${result.status}`];
  if (result.contentType) {
    parts.push(`Content-Type: ${result.contentType}`);
  }
  parts.push("", result.body || "(empty body)");
  return parts.join("\n");
}
