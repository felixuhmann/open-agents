import { CreateUserInput, UpdateUserInput } from "@open-agents/types";
import { Hono } from "hono";
import { createUserWithPassword } from "../../auth/index.js";
import { HttpError, requireAdmin } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import { log } from "../../log.js";
import type { AppVariables } from "../../server/types.js";

export const usersRoutes = new Hono<{ Variables: AppVariables }>();

function optionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const profileSelect = {
  phoneNumber: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  region: true,
  postalCode: true,
  country: true,
  company: true,
  jobTitle: true,
  department: true,
  website: true,
  timezone: true,
} as const;

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
      ...profileSelect,
    },
  });
  return c.json({ users });
});

usersRoutes.post("/", async (c) => {
  requireAdmin(c);
  const body = CreateUserInput.parse(await c.req.json());
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
  const body = UpdateUserInput.parse(await c.req.json());
  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.role !== undefined ? { role: body.role } : {}),
      ...(body.phoneNumber !== undefined
        ? { phoneNumber: optionalText(body.phoneNumber) }
        : {}),
      ...(body.addressLine1 !== undefined
        ? { addressLine1: optionalText(body.addressLine1) }
        : {}),
      ...(body.addressLine2 !== undefined
        ? { addressLine2: optionalText(body.addressLine2) }
        : {}),
      ...(body.city !== undefined ? { city: optionalText(body.city) } : {}),
      ...(body.region !== undefined ? { region: optionalText(body.region) } : {}),
      ...(body.postalCode !== undefined
        ? { postalCode: optionalText(body.postalCode) }
        : {}),
      ...(body.country !== undefined ? { country: optionalText(body.country) } : {}),
      ...(body.company !== undefined ? { company: optionalText(body.company) } : {}),
      ...(body.jobTitle !== undefined ? { jobTitle: optionalText(body.jobTitle) } : {}),
      ...(body.department !== undefined
        ? { department: optionalText(body.department) }
        : {}),
      ...(body.website !== undefined ? { website: optionalText(body.website) } : {}),
      ...(body.timezone !== undefined ? { timezone: optionalText(body.timezone) } : {}),
    },
    select: { id: true, email: true, name: true, role: true, ...profileSelect },
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
