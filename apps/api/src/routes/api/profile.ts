import { Hono } from "hono";
import { requireUser } from "../../auth/middleware.js";
import { prisma } from "../../db.js";
import type { AppVariables } from "../../server/types.js";

export const profileRoutes = new Hono<{ Variables: AppVariables }>();

profileRoutes.get("/", async (c) => {
  const user = requireUser(c);

  const [dbUser, authSessionCount, conversationCount, runCount, accessibleAgentCount] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: { createdAt: true, updatedAt: true },
      }),
      prisma.session.count({ where: { userId: user.id } }),
      prisma.chatConversation.count({ where: { userId: user.id } }),
      prisma.agentRun.count({
        where: { conversation: { userId: user.id } },
      }),
      user.role === "admin"
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
