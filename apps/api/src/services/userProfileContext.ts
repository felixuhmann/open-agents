import type { AgentRunContext } from "../agent-backend/types.js";
import { prisma } from "../db.js";

type ProfileUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  phoneNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  company: string | null;
  jobTitle: string | null;
  department: string | null;
  website: string | null;
  timezone: string | null;
};

const profileSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
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

export async function buildAuthorProfileContext(
  context: AgentRunContext,
): Promise<string | null> {
  const user = await resolveAuthorUser(context);
  if (!user) return null;

  const rows = [
    ["User ID", user.id],
    ["Email", user.email],
    ["Display name", user.name],
    ["Role", user.role],
    ["Telephone", user.phoneNumber],
    ["Company", user.company],
    ["Job title", user.jobTitle],
    ["Department", user.department],
    ["Address line 1", user.addressLine1],
    ["Address line 2", user.addressLine2],
    ["City", user.city],
    ["Region", user.region],
    ["Postal code", user.postalCode],
    ["Country", user.country],
    ["Website", user.website],
    ["Timezone", user.timezone],
  ].filter(([, value]) => typeof value === "string" && value.trim().length > 0);

  if (rows.length === 0) return null;

  return [
    "Request author profile (agent profile access is enabled):",
    ...rows.map(([label, value]) => `- ${label}: ${value}`),
  ].join("\n");
}

async function resolveAuthorUser(context: AgentRunContext): Promise<ProfileUser | null> {
  if (context.surface === "chat") {
    const run = await prisma.agentRun.findUnique({
      where: { id: context.runId },
      select: { conversation: { select: { userId: true } } },
    });
    const userId = run?.conversation?.userId;
    if (!userId) return null;
    return prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
  }

  if (context.surface === "workflow") {
    const stepRun = await prisma.workflowStepRun.findUnique({
      where: { runId: context.runId },
      select: {
        workflowRun: {
          select: {
            conversation: { select: { userId: true } },
            emailThread: { select: { userEmail: true } },
          },
        },
      },
    });
    const userId = stepRun?.workflowRun.conversation?.userId;
    if (userId) {
      return prisma.user.findUnique({ where: { id: userId }, select: profileSelect });
    }
    const email = stepRun?.workflowRun.emailThread?.userEmail;
    return findUserByEmail(email);
  }

  const run = await prisma.agentRun.findUnique({
    where: { id: context.runId },
    select: { thread: { select: { userEmail: true } } },
  });
  return findUserByEmail(run?.thread?.userEmail);
}

async function findUserByEmail(
  email: string | null | undefined,
): Promise<ProfileUser | null> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;
  return prisma.user.findUnique({ where: { email: normalized }, select: profileSelect });
}
