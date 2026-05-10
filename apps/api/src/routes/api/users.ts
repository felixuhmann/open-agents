import { Hono } from "hono";
import { z } from "zod";
import { createUserWithPassword } from "../../auth/index.js";
import { HttpError, requireAdmin } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { log } from "../../log.js";
import type { AppVariables } from "../../server/types.js";

export const usersRoutes = new Hono<{ Variables: AppVariables }>();

const CreateUserBody = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  password: z.string().min(8).max(200),
  role: z.enum(["admin", "member"]).default("member"),
});

const UpdateUserBody = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.enum(["admin", "member"]).optional(),
});

usersRoutes.get("/", async (c) => {
  requireAdmin(c);
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      banned: true,
      createdAt: true,
    },
  });
  return c.json({ users });
});

usersRoutes.post("/", async (c) => {
  requireAdmin(c);
  const body = CreateUserBody.parse(await c.req.json());
  const created = await createUserWithPassword({
    email: body.email,
    name: body.name ?? body.email,
    password: body.password,
    role: body.role,
  });
  log.info("users: created", {
    id: created.id,
    email: created.email,
    role: body.role,
  });
  return c.json({
    id: created.id,
    email: created.email,
    role: body.role,
  });
});

usersRoutes.patch("/:id", async (c) => {
  requireAdmin(c);
  const id = c.req.param("id");
  const body = UpdateUserBody.parse(await c.req.json());
  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.role !== undefined ? { role: body.role } : {}),
    },
    select: { id: true, email: true, name: true, role: true },
  });
  return c.json(user);
});

usersRoutes.delete("/:id", async (c) => {
  const me = requireAdmin(c);
  const id = c.req.param("id");
  if (id === me.id) {
    throw new HttpError(400, "cannot delete your own account");
  }
  await prisma.user.delete({ where: { id } });
  return c.json({ ok: true });
});
