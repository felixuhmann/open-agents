import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { AppVariables } from "../server/types.js";

/**
 * Serve the built `apps/web` SPA from the same Hono process so the whole
 * platform deploys as a single Node service.
 *
 * Layout-wise:
 *
 * - Vite outputs the SPA bundle to `apps/web/dist/` (relative to that
 *   package).
 * - The production `startCommand` runs `node dist/index.js` from inside
 *   `apps/api/`, which makes `../web/dist` the CWD-relative path to the
 *   SPA bundle. `serveStatic` from `@hono/node-server` only accepts
 *   CWD-relative roots, so this matches the same convention as
 *   [`static.ts`](./static.ts).
 *
 * Mount this LAST in `buildApp()`. Hono matches routes in registration
 * order, so every prefixed router (`/api/*`, `/mcp/*`, `/mailgun/*`,
 * `/setup/*`, `/health/*`, `/static/*`, plus the `/runs/...` and
 * `/conversations/...` upload endpoints) wins over this catch-all.
 *
 * The two-handler pattern is the standard Hono SPA recipe:
 *
 * 1. `app.use("/*", serveStatic(...))` tries to serve a real file from
 *    `apps/web/dist/` (e.g. `/assets/index-abc123.js`,
 *    `/favicon.ico`). If it doesn't find the file it calls `next()`.
 * 2. `app.get("/*", serveStatic({ path: "./index.html", ... }))`
 *    catches the fall-through and returns the SPA shell so deep links
 *    like `/agents/foo/chat/abc123` survive a hard refresh.
 *
 * In dev nobody hits these handlers — the SPA is served by Vite on
 * `:5173` and proxies API calls to `:3000`. If `apps/web/dist/` is
 * missing in production (forgot to run `pnpm build`), requests just
 * 404 — registration doesn't fail.
 */
const WEB_ROOT = "../web/dist";

export const webRoutes = new Hono<{ Variables: AppVariables }>();

webRoutes.use("/*", serveStatic({ root: WEB_ROOT }));
webRoutes.get("/*", serveStatic({ root: WEB_ROOT, path: "./index.html" }));
