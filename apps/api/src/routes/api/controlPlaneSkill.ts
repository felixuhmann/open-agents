import { Hono } from "hono";
import type { AppVariables } from "../../server/types.js";
import {
  CONTROL_PLANE_SKILL_FILENAME,
  getControlPlaneSkillBundle,
  getControlPlaneSkillInfo,
} from "../../services/controlPlaneSkill.js";

/**
 * Public download for the control-plane agent skill. Both routes are
 * unauthenticated on purpose: the bundle is documentation (no secrets, no user
 * data), and leaving it open lets an agent's plain `curl` install it without an
 * auth dance. Mounted at `/api/skills/control-plane` — register before
 * `/api/skills` so it is not shadowed.
 */
export const controlPlaneSkillRoutes = new Hono<{ Variables: AppVariables }>();

// Metadata + download link. Also backs the `skill_download_link` MCP tool.
controlPlaneSkillRoutes.get("/", async (c) => {
  return c.json(await getControlPlaneSkillInfo());
});

// The freshly-compiled `.skill` bundle (a zip of docs/skills/<name>/).
controlPlaneSkillRoutes.get("/bundle.skill", async (c) => {
  const bundle = await getControlPlaneSkillBundle();
  if (!bundle) return c.json({ error: "control-plane skill bundle unavailable" }, 500);

  if (c.req.header("if-none-match") === bundle.etag) {
    return c.body(null, 304);
  }

  c.header("Content-Type", "application/zip");
  c.header("ETag", bundle.etag);
  c.header("Cache-Control", "public, max-age=300");
  c.header(
    "Content-Disposition",
    `attachment; filename="${CONTROL_PLANE_SKILL_FILENAME}"`,
  );
  return c.body(new Uint8Array(bundle.bytes));
});
