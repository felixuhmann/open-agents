import { File } from "node:buffer";
import { Hono } from "hono";
import { HttpError, requireAdmin, requireUser } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";
import { createSkill, deleteSkill } from "../../services/skills.js";

export const skillsRoutes = new Hono<{ Variables: AppVariables }>();

skillsRoutes.get("/", async (c) => {
  requireUser(c);
  const skills = await prisma.skill.findMany({ orderBy: { createdAt: "desc" } });
  return c.json({
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      anthropicSkillId: s.anthropicSkillId,
      anthropicSkillVersion: s.anthropicSkillVersion,
      createdAt: s.createdAt.toISOString(),
    })),
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
    anthropicSkillId: skill.anthropicSkillId,
    anthropicSkillVersion: skill.anthropicSkillVersion,
  });
});

skillsRoutes.delete("/:id", async (c) => {
  requireAdmin(c);
  const id = c.req.param("id");
  await deleteSkill(id);
  return c.json({ ok: true });
});
