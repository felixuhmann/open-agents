import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { AppVariables } from "../server/types.js";
import { UPLOADS_DIR } from "../services/uploads.js";

export const STATIC_PREFIX = "/static";

/**
 * Serve email-template assets and admin-uploaded branding files.
 *
 * Two roots are mounted under `/static/*`:
 *
 *  - `/static/uploads/*` — admin-uploaded files (agent avatars and the
 *    deployment footer logo). Lives outside of source control under
 *    `apps/api/data/uploads/`. Matched first so writable assets shadow
 *    nothing on accident.
 *  - `/static/*` — read-only email-template assets bundled with the
 *    repo. The `pnpm build` step copies `src/emails/static/` into
 *    `dist/emails/static/`, so the `root` differs by environment:
 *
 *    * Dev (`pnpm dev`, CWD = `apps/api/`):       `./src/emails/static`
 *    * Prod (`node dist/index.js`, CWD = `apps/api/`): `./dist/emails/static`
 *
 * `serveStatic` requires a CWD-relative path (absolute paths aren't
 * supported). The production start command must therefore launch the
 * binary from the `apps/api/` package directory, not from the repo root.
 *
 * The same `emails/static` files are also served by
 * `pnpm --filter @open-agents/api email` (the react-email preview), but
 * that's a separate process and doesn't go through Hono.
 */
const BUNDLED_STATIC_ROOT =
  process.env.NODE_ENV === "production" ? "./dist/emails/static" : "./src/emails/static";

export const staticRoutes = new Hono<{ Variables: AppVariables }>();

staticRoutes.use(
  "/uploads/*",
  serveStatic({
    root: UPLOADS_DIR,
    rewriteRequestPath: (path) => path.replace(/^\/uploads/, ""),
  }),
);

staticRoutes.use(
  "/*",
  serveStatic({
    root: BUNDLED_STATIC_ROOT,
    rewriteRequestPath: (path) => path.replace(/^\/static/, ""),
  }),
);
