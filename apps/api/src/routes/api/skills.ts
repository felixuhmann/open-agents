import { File } from "node:buffer";
import { Hono } from "hono";
import { HttpError, requireAdmin, requireUser } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";
import { createSkill, createSkillVersion, deleteSkill } from "../../services/skills.js";

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
        anthropicSkillId: latest?.anthropicSkillId ?? null,
        anthropicSkillVersion: latest?.anthropicSkillVersion ?? null,
        versions: s.versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          filename: v.filename,
          anthropicSkillId: v.anthropicSkillId,
          anthropicSkillVersion: v.anthropicSkillVersion,
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
  if (!(file instanceof File)) throw new HttpError(400, "missing 'file' field (zip)");
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
    anthropicSkillId: skill.versions[0]?.anthropicSkillId ?? null,
    anthropicSkillVersion: skill.versions[0]?.anthropicSkillVersion ?? null,
  });
});

skillsRoutes.post("/:id/versions", async (c) => {
  requireAdmin(c);
  const skillId = c.req.param("id");
  const form = await c.req.parseBody({ all: false });
  const file = form.file;
  if (!(file instanceof File)) throw new HttpError(400, "missing 'file' field (zip)");
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
    anthropicSkillId: version.anthropicSkillId,
    anthropicSkillVersion: version.anthropicSkillVersion,
    createdAt: version.createdAt.toISOString(),
  });
});

skillsRoutes.delete("/:id", async (c) => {
  requireAdmin(c);
  const id = c.req.param("id");
  await deleteSkill(id);
  return c.json({ ok: true });
});
