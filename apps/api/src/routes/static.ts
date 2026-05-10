import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { AppVariables } from "../server/types.js";

export const STATIC_PREFIX = "/static";

/**
 * Serve email-template assets (logo, etc.) from the `apps/api/` package.
 *
 * The `pnpm build` step copies `src/emails/static/` into `dist/emails/static/`
 * (both paths are relative to the `apps/api/` package), so the `root` we
 * hand `serveStatic` differs by environment:
 *
 * - Dev (`pnpm dev`, CWD = `apps/api/`):    `./src/emails/static`
 * - Prod (`node dist/index.js`, CWD = `apps/api/`): `./dist/emails/static`
 *
 * `serveStatic` requires a CWD-relative path; absolute paths aren't
 * supported. The production start command must therefore launch the
 * binary from the `apps/api/` package directory, not from the repo root.
 *
 * The same files are also served by `pnpm --filter @open-agents/api email`
 * (the react-email preview), but that's a separate process and doesn't
 * go through Hono.
 */
const STATIC_ROOT =
  process.env.NODE_ENV === "production" ? "./dist/emails/static" : "./src/emails/static";

export const staticRoutes = new Hono<{ Variables: AppVariables }>();

// `path` strips the `/static` URL prefix before resolving against `root`.
staticRoutes.use(
  "/*",
  serveStatic({
    root: STATIC_ROOT,
    rewriteRequestPath: (path) => path.replace(/^\/static/, ""),
  }),
);
