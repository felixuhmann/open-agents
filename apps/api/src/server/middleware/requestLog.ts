import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { ZodError } from "zod";
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

/**
 * Response code a thrown error selects, or `null` when it is an unexpected
 * fault. Any error carrying a string `message` and an integer 4xx/5xx
 * `status` qualifies — `HttpError` from the auth middleware and
 * `AgentBackendError` from the sandbox provider domain both do — so a
 * provider that is unreachable or cannot archive reaches the caller as a
 * 503/409 with the reason instead of a bare 500.
 */
type HandlerStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503;

function statusOf(err: unknown): HandlerStatus | null {
  if (typeof err !== "object" || err === null) return null;
  if (!("status" in err) || !("message" in err)) return null;
  const { status, message } = err;
  if (typeof message !== "string") return null;
  if (typeof status !== "number" || !Number.isInteger(status)) return null;
  if (status < 400 || status > 599) return null;
  // Narrowed to a response code; the union above only documents the ones
  // handlers actually select.
  return status as HandlerStatus;
}

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
    if (err instanceof ZodError) {
      const message = err.issues
        .map((issue) => {
          const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
          return `${path}${issue.message}`;
        })
        .join("; ");
      log.info("http: validation failed", {
        reqId: c.get("reqId"),
        path: c.req.path,
        method: c.req.method,
        message,
      });
      return c.json({ error: message }, 400);
    }

    // A domain error that carries a status is an answer, not a fault: log it
    // at `warn` and hand the caller the actionable message. Only genuinely
    // unexpected throws become an opaque 500.
    const status = statusOf(err);
    const logged = {
      reqId: c.get("reqId"),
      err: err instanceof Error ? (err.stack ?? err.message) : String(err),
      path: c.req.path,
      method: c.req.method,
    };
    if (status !== null) {
      log.warn("http: handler rejected the request", { ...logged, status });
      return c.json({ error: (err as { message: string }).message }, status);
    }
    log.error("http: handler threw", logged);
    return c.text("internal error", 500);
  });
}
