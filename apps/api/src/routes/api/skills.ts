import { File } from "node:buffer";
import { CreateSkillUploadRequestInput } from "@open-agents/types";
import { Hono } from "hono";
import { HttpError, requireAdmin, requireUser } from "../../auth/middleware.js";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";
import {
  claimSkillUploadToken,
  createSkillUploadRequest,
  verifySkillUploadToken,
} from "../../services/pendingSkillUploads.js";
import { createSkill, createSkillVersion, deleteSkill } from "../../services/skills.js";

/** Hard cap per bundle upload, matching the multipart attachment limit. */
const MAX_SKILL_BUNDLE_BYTES = 25 * 1024 * 1024;

export const skillsRoutes = new Hono<{ Variables: AppVariables }>();

skillsRoutes.get("/", async (c) => {
  requireUser(c);
  const skills = await prisma.skill.findMany({
    include: { versions: { orderBy: { versionNumber: "desc" } } },
    orderBy: { updatedAt: "desc" },
  });
  return c.json({
    skills: skills.map((s) => {
      const latest = s.versions[0] ?? null;
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        latestVersionId: latest?.id ?? null,
        latestVersionNumber: latest?.versionNumber ?? null,
        versions: s.versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          filename: v.filename,
          createdAt: v.createdAt.toISOString(),
        })),
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      };
    }),
  });
});

skillsRoutes.post("/", async (c) => {
  requireAdmin(c);
  const form = await c.req.parseBody({ all: false });
  const file = form.file;
  const name = typeof form.name === "string" ? form.name : null;
  const description = typeof form.description === "string" ? form.description : undefined;
  if (!name) throw new HttpError(400, "name is required");
  if (!(file instanceof File)) throw new HttpError(400, "missing 'file' field (bundle)");
  const bytes = Buffer.from(await file.arrayBuffer());
  const skill = await createSkill({
    name,
    description,
    filename: file.name || `${name}.zip`,
    bytes,
  });
  return c.json({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    latestVersionId: skill.versions[0]?.id ?? null,
    latestVersionNumber: skill.versions[0]?.versionNumber ?? null,
  });
});

/**
 * First leg of the signed-URL upload flow (see `skills_create` MCP tool). Mints
 * a single-use, short-lived upload URL. The agent then PUTs the raw zip bytes to
 * that URL. If a skill with `name` already exists the upload becomes a new
 * version of it; otherwise it creates a new skill.
 */
skillsRoutes.post("/upload-requests", async (c) => {
  requireAdmin(c);
  const parsed = CreateSkillUploadRequestInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const { name, description } = parsed.data;

  const existing = await prisma.skill.findUnique({ where: { name } });
  const request = await createSkillUploadRequest({ skillName: name, description });
  const uploadUrl = `${config.PUBLIC_BASE_URL}/api/skills/uploads/${request.id}?token=${request.token}`;

  return c.json({
    action: existing ? "new_version" : "new_skill",
    skillName: name,
    uploadUrl,
    method: "PUT",
    contentType: "application/zip",
    expiresAt: request.expiresAt.toISOString(),
  });
});

/**
 * Second leg: the signed-URL target. Authenticated by the one-time token (query
 * param or bearer header), NOT the session cookie — this is what an autonomous
 * agent PUTs the bundle bytes to. The token is spent on a valid attempt.
 */
skillsRoutes.put("/uploads/:id", async (c) => {
  const id = c.req.param("id");
  const token =
    c.req.query("token") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!token) throw new HttpError(401, "missing upload token");

  const pending = await verifySkillUploadToken(id, token);
  if (!pending) throw new HttpError(401, "invalid or expired upload token");

  const bytes = Buffer.from(await c.req.arrayBuffer());
  if (bytes.byteLength === 0) throw new HttpError(400, "empty upload body");
  if (bytes.byteLength > MAX_SKILL_BUNDLE_BYTES) throw new HttpError(413, "bundle too large");

  // Spend the token now — atomically, so concurrent PUTs can't both land. Bundle
  // validation happens inside createSkill/createSkillVersion below; an invalid
  // bundle throws (400 via the error handler) after the token is consumed, so a
  // fresh upload URL is needed to retry.
  if (!(await claimSkillUploadToken(id))) {
    throw new HttpError(409, "upload token already used");
  }

  const filename = `${pending.skillName.replace(/[^a-z0-9_-]+/gi, "_")}.zip`;
  const existing = await prisma.skill.findUnique({ where: { name: pending.skillName } });
  if (existing) {
    const version = await createSkillVersion({ skillId: existing.id, filename, bytes });
    return c.json({
      action: "new_version",
      skillId: existing.id,
      skillName: pending.skillName,
      versionId: version.id,
      versionNumber: version.versionNumber,
      filename: version.filename,
      createdAt: version.createdAt.toISOString(),
    });
  }

  const skill = await createSkill({
    name: pending.skillName,
    description: pending.description ?? undefined,
    filename,
    bytes,
  });
  return c.json({
    action: "new_skill",
    skillId: skill.id,
    skillName: skill.name,
    versionId: skill.versions[0]?.id ?? null,
    versionNumber: skill.versions[0]?.versionNumber ?? null,
    filename,
    createdAt: skill.createdAt.toISOString(),
  });
});

skillsRoutes.post("/:id/versions", async (c) => {
  requireAdmin(c);
  const skillId = c.req.param("id");
  const form = await c.req.parseBody({ all: false });
  const file = form.file;
  if (!(file instanceof File)) throw new HttpError(400, "missing 'file' field (bundle)");
  const bytes = Buffer.from(await file.arrayBuffer());
  const version = await createSkillVersion({
    skillId,
    filename: file.name || `${skillId}.zip`,
    bytes,
  });
  return c.json({
    id: version.id,
    versionNumber: version.versionNumber,
    filename: version.filename,
    createdAt: version.createdAt.toISOString(),
  });
});

skillsRoutes.delete("/:id", async (c) => {
  requireAdmin(c);
  const id = c.req.param("id");
  await deleteSkill(id);
  return c.json({ ok: true });
});
