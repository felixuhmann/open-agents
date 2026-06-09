import { Hono } from "hono";
import { z } from "zod";
import { canOperateAgents, requireUser } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";

export const profileRoutes = new Hono<{ Variables: AppVariables }>();

const ProfileUpdateInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phoneNumber: z.string().trim().max(80).nullable().optional(),
  addressLine1: z.string().trim().max(200).nullable().optional(),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(40).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  company: z.string().trim().max(160).nullable().optional(),
  jobTitle: z.string().trim().max(160).nullable().optional(),
  department: z.string().trim().max(160).nullable().optional(),
  website: z.string().trim().max(300).nullable().optional(),
  timezone: z.string().trim().max(120).nullable().optional(),
});

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

profileRoutes.get("/", async (c) => {
  const user = requireUser(c);

  const [dbUser, authSessionCount, conversationCount, runCount, accessibleAgentCount] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: { createdAt: true, updatedAt: true, ...profileSelect },
      }),
      prisma.session.count({ where: { userId: user.id } }),
      prisma.chatConversation.count({ where: { userId: user.id } }),
      prisma.agentRun.count({
        where: { conversation: { userId: user.id } },
      }),
      canOperateAgents(user)
        ? prisma.agent.count()
        : prisma.agent.count({
            where: {
              OR: [{ accessMode: "everyone" }, { access: { some: { userId: user.id } } }],
            },
          }),
    ]);

  const [latestConversation, latestRun] = await Promise.all([
    prisma.chatConversation.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    prisma.agentRun.findFirst({
      where: { conversation: { userId: user.id } },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
  ]);

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      profile: {
        phoneNumber: dbUser?.phoneNumber ?? null,
        addressLine1: dbUser?.addressLine1 ?? null,
        addressLine2: dbUser?.addressLine2 ?? null,
        city: dbUser?.city ?? null,
        region: dbUser?.region ?? null,
        postalCode: dbUser?.postalCode ?? null,
        country: dbUser?.country ?? null,
        company: dbUser?.company ?? null,
        jobTitle: dbUser?.jobTitle ?? null,
        department: dbUser?.department ?? null,
        website: dbUser?.website ?? null,
        timezone: dbUser?.timezone ?? null,
      },
      createdAt: dbUser?.createdAt.toISOString() ?? null,
      updatedAt: dbUser?.updatedAt.toISOString() ?? null,
    },
    stats: {
      authSessionCount,
      conversationCount,
      runCount,
      accessibleAgentCount,
    },
    activity: {
      lastConversationAt: latestConversation?.updatedAt.toISOString() ?? null,
      lastRunAt: latestRun?.startedAt.toISOString() ?? null,
    },
  });
});

profileRoutes.patch("/", async (c) => {
  const user = requireUser(c);
  const body = ProfileUpdateInput.parse(await c.req.json());
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
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
    select: { id: true },
  });
  return c.json({ ok: true, userId: updated.id });
});
