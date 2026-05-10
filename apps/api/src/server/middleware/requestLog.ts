import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { log } from "../../log.js";
import type { AppVariables } from "../types.js";

/** @deprecated use AppVariables from server/types.js */
export type RequestLogVariables = { reqId: string };

// Query-string keys whose values are credentials/capability tokens. The
// request logger replaces matching values with `[redacted]` before
// emitting to logs so signed-upload URLs (`?sig=`) and HMAC-protected
// links (`?token=`) don't end up in log files alongside the path that
// makes them useful. Match is case-insensitive.
const REDACTED_QUERY_KEYS = new Set([
  "sig",
  "signature",
  "token",
  "code",
  "key",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
  "id_token",
  "password",
  "secret",
  "auth",
  "bearer",
]);

function redactQuery(q: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    out[k] = REDACTED_QUERY_KEYS.has(k.toLowerCase()) ? "[redacted]" : v;
  }
  return out;
}

/**
 * Apply the standard request-id + structured request log middleware to a
 * Hono app, plus the matching `notFound` / `onError` hooks. Everything
 * outside `appRoutePrefixes` is treated as internet-scanner noise (Swagger
 * probes, /.env, etc.) and logged as a single `warn` line rather than a
 * full start/done pair.
 */
export function applyRequestLogMiddleware(
  app: Hono<{ Variables: AppVariables }>,
  appRoutePrefixes: readonly string[],
): void {
  const isAppRoute = (path: string): boolean =>
    appRoutePrefixes.some((p) => path === p || path.startsWith(`${p}/`));

  app.use("*", async (c, next) => {
    const reqId = randomUUID().slice(0, 8);
    c.set("reqId", reqId);
    const start = Date.now();
    const interesting = isAppRoute(c.req.path);
    if (interesting) {
      log.info("http: request start", {
        reqId,
        method: c.req.method,
        path: c.req.path,
        query: redactQuery(c.req.query()),
        ua: c.req.header("user-agent"),
        contentType: c.req.header("content-type"),
        contentLength: c.req.header("content-length"),
        forwardedFor: c.req.header("x-forwarded-for"),
        ip: c.req.header("x-real-ip"),
      });
    }
    try {
      await next();
    } finally {
      if (interesting) {
        log.info("http: request done", {
          reqId,
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs: Date.now() - start,
        });
      }
    }
  });

  app.notFound((c) => {
    if (isAppRoute(c.req.path)) {
      log.warn("http: not found", {
        reqId: c.get("reqId"),
        method: c.req.method,
        path: c.req.path,
      });
    } else {
      log.warn("http: scanner 404", {
        method: c.req.method,
        path: c.req.path,
        ua: c.req.header("user-agent"),
        ip: c.req.header("x-real-ip"),
      });
    }
    return c.text("not found", 404);
  });

  app.onError((err, c) => {
    log.error("http: handler threw", {
      reqId: c.get("reqId"),
      err: err instanceof Error ? (err.stack ?? err.message) : String(err),
      path: c.req.path,
      method: c.req.method,
    });
    if (
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      "message" in err &&
      typeof (err as { status?: unknown }).status === "number"
    ) {
      const status = (err as { status: number }).status;
      const message = (err as { message: string }).message;
      return c.json({ error: message }, status as 400 | 401 | 403 | 404 | 409 | 500);
    }
    return c.text("internal error", 500);
  });
}
