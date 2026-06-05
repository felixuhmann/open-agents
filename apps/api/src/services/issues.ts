import { prisma } from "../db.js";
import { HttpError } from "../auth/middleware.js";
import { log } from "../log.js";
import {
  getConversationTrace,
  getEmailThreadTrace,
  type IssueDetailAgent,
  type IssueDetailMessage,
  type IssueDetailRun,
  type IssueDetailRunEvent,
  type IssueDetailRunSkill,
  type IssueDetailSandbox,
  type IssueDetailSkillBinding,
  type IssueDetailThirdPartyMcp,
  type IssueDetailToolBinding,
  type SessionTrace,
} from "./sessionTrace.js";
import { getWorkflowConversationTrace, type WorkflowTrace } from "./workflowTrace.js";

export type {
  IssueDetailAgent,
  IssueDetailMessage,
  IssueDetailRun,
  IssueDetailRunEvent,
  IssueDetailRunSkill,
  IssueDetailSandbox,
  IssueDetailSkillBinding,
  IssueDetailThirdPartyMcp,
  IssueDetailToolBinding,
};

/**
 * User-filed issues against agent sessions. Domain logic shared between
 * the cookie-authed `/api/issues` admin routes and the public
 * `/api/issues/email-report` flow used by email recipients (no SPA session).
 */

export type IssueListRow = {
  id: string;
  surface: "chat" | "email" | "workflow";
  status: "open" | "resolved";
  description: string;
  reporterEmail: string;
  reporterUserId: string | null;
  reporterName: string | null;
  agent: {
    id: string;
    slug: string;
    displayName: string;
    avatar: string | null;
  } | null;
  workflow: {
    id: string;
    slug: string;
    displayName: string;
  } | null;
  conversationId: string | null;
  threadId: string | null;
  workflowConversationId: string | null;
  sessionLabel: string;
  createdAt: string;
  resolvedAt: string | null;
};

const DESCRIPTION_MIN = 1;
const DESCRIPTION_MAX = 4000;

function normaliseDescription(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new HttpError(400, "description must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length < DESCRIPTION_MIN) {
    throw new HttpError(400, "description is required");
  }
  if (trimmed.length > DESCRIPTION_MAX) {
    throw new HttpError(400, `description must be ≤ ${DESCRIPTION_MAX} characters`);
  }
  return trimmed;
}

export async function createChatIssue(args: {
  conversationId: string;
  reporterUserId: string;
  reporterEmail: string;
  description: string;
}): Promise<{ id: string }> {
  const description = normaliseDescription(args.description);
  const conv = await prisma.chatConversation.findUnique({
    where: { id: args.conversationId },
    select: { id: true, agentId: true, userId: true },
  });
  if (!conv) throw new HttpError(404, "conversation not found");
  const issue = await prisma.issue.create({
    data: {
      agentId: conv.agentId,
      surface: "chat",
      conversationId: conv.id,
      reporterUserId: args.reporterUserId,
      reporterEmail: args.reporterEmail,
      description,
      status: "open",
    },
  });
  log.info("issues: chat issue filed", {
    issueId: issue.id,
    conversationId: conv.id,
    agentId: conv.agentId,
    reporterUserId: args.reporterUserId,
  });
  return { id: issue.id };
}

export async function createEmailIssue(args: {
  threadId: string;
  reporterEmail: string;
  description: string;
}): Promise<{ id: string }> {
  const description = normaliseDescription(args.description);
  const thread = await prisma.emailThread.findUnique({
    where: { id: args.threadId },
    select: { id: true, agentId: true, userEmail: true },
  });
  if (!thread) throw new HttpError(404, "thread not found");
  if (thread.userEmail.trim().toLowerCase() !== args.reporterEmail.trim().toLowerCase()) {
    throw new HttpError(403, "email does not match thread");
  }
  const user = await prisma.user.findUnique({
    where: { email: thread.userEmail },
    select: { id: true },
  });
  const issue = await prisma.issue.create({
    data: {
      agentId: thread.agentId,
      surface: "email",
      threadId: thread.id,
      reporterUserId: user?.id ?? null,
      reporterEmail: thread.userEmail,
      description,
      status: "open",
    },
  });
  log.info("issues: email issue filed", {
    issueId: issue.id,
    threadId: thread.id,
    agentId: thread.agentId,
    reporterEmail: thread.userEmail,
  });
  return { id: issue.id };
}

export async function createWorkflowIssue(args: {
  conversationId: string;
  reporterUserId: string;
  reporterEmail: string;
  description: string;
}): Promise<{ id: string }> {
  const description = normaliseDescription(args.description);
  const conv = await prisma.workflowConversation.findUnique({
    where: { id: args.conversationId },
    select: { id: true, workflowId: true, userId: true },
  });
  if (!conv) throw new HttpError(404, "workflow conversation not found");
  const issue = await prisma.issue.create({
    data: {
      workflowId: conv.workflowId,
      surface: "workflow",
      workflowConversationId: conv.id,
      reporterUserId: args.reporterUserId,
      reporterEmail: args.reporterEmail,
      description,
      status: "open",
    },
  });
  log.info("issues: workflow issue filed", {
    issueId: issue.id,
    workflowConversationId: conv.id,
    workflowId: conv.workflowId,
    reporterUserId: args.reporterUserId,
  });
  return { id: issue.id };
}

export async function listIssues(args: {
  status?: "open" | "resolved";
}): Promise<IssueListRow[]> {
  const rows = await prisma.issue.findMany({
    where: { ...(args.status ? { status: args.status } : {}) },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 500,
    include: {
      agent: { select: { id: true, slug: true, displayName: true, avatar: true } },
      workflow: { select: { id: true, slug: true, displayName: true } },
      reporter: { select: { id: true, name: true } },
      conversation: { select: { title: true } },
      thread: { select: { subject: true } },
      workflowConversation: { select: { title: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    surface: r.surface as "chat" | "email" | "workflow",
    status: r.status as "open" | "resolved",
    description: r.description,
    reporterEmail: r.reporterEmail,
    reporterUserId: r.reporterUserId,
    reporterName: r.reporter?.name ?? null,
    agent: r.agent
      ? {
          id: r.agent.id,
          slug: r.agent.slug,
          displayName: r.agent.displayName,
          avatar: r.agent.avatar,
        }
      : null,
    workflow: r.workflow
      ? {
          id: r.workflow.id,
          slug: r.workflow.slug,
          displayName: r.workflow.displayName,
        }
      : null,
    conversationId: r.conversationId,
    threadId: r.threadId,
    workflowConversationId: r.workflowConversationId,
    sessionLabel:
      r.surface === "chat"
        ? (r.conversation?.title ?? "Conversation")
        : r.surface === "email"
          ? (r.thread?.subject ?? "Email thread")
          : (r.workflowConversation?.title ?? "Workflow conversation"),
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  }));
}

type IssueMetadata = {
  id: string;
  status: "open" | "resolved";
  description: string;
  reporterEmail: string;
  reporterUserId: string | null;
  reporterName: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolvedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IssueDetail = IssueMetadata & (SessionTrace | WorkflowTrace);

export async function getIssueDetail(id: string): Promise<IssueDetail> {
  const issue = await prisma.issue.findUnique({
    where: { id },
    include: {
      reporter: { select: { id: true, name: true } },
      resolvedBy: { select: { name: true, email: true } },
    },
  });
  if (!issue) throw new HttpError(404, "issue not found");

  const trace =
    issue.surface === "chat" && issue.conversationId
      ? await getConversationTrace(issue.conversationId)
      : issue.surface === "email" && issue.threadId
        ? await getEmailThreadTrace(issue.threadId)
        : issue.surface === "workflow" && issue.workflowConversationId
          ? await getWorkflowConversationTrace(issue.workflowConversationId)
          : null;

  if (!trace) {
    throw new HttpError(404, "issue session not found");
  }

  return {
    id: issue.id,
    status: issue.status as "open" | "resolved",
    description: issue.description,
    reporterEmail: issue.reporterEmail,
    reporterUserId: issue.reporterUserId,
    reporterName: issue.reporter?.name ?? null,
    resolvedAt: issue.resolvedAt?.toISOString() ?? null,
    resolvedByName: issue.resolvedBy?.name ?? null,
    resolvedByEmail: issue.resolvedBy?.email ?? null,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    ...trace,
  };
}

export async function setIssueStatus(args: {
  id: string;
  status: "open" | "resolved";
  resolverUserId: string;
}): Promise<void> {
  await prisma.issue.update({
    where: { id: args.id },
    data: {
      status: args.status,
      resolvedAt: args.status === "resolved" ? new Date() : null,
      resolvedById: args.status === "resolved" ? args.resolverUserId : null,
    },
  });
  log.info("issues: status updated", {
    issueId: args.id,
    status: args.status,
    by: args.resolverUserId,
  });
}
