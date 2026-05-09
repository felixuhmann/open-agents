import { prisma } from "../db.js";
import { HttpError } from "../auth/middleware.js";
import { log } from "../log.js";

/**
 * User-filed issues against agent sessions. Domain logic shared between
 * the cookie-authed `/api/issues` admin routes and the public
 * `/issues/report` flow used by email recipients (no SPA session).
 */

export type IssueListRow = {
  id: string;
  surface: "chat" | "email";
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
  };
  conversationId: string | null;
  threadId: string | null;
  /// Subject (email) or conversation title (chat) for the listing.
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

/**
 * File an issue against a chat conversation. Caller must own the
 * conversation (`requireUser` in the route already established the principal).
 */
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

/**
 * File an issue against an email thread. Used by the public
 * `/issues/report` route after token verification — there's no cookie
 * session, so the route hands us the verified threadId+email directly.
 */
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
  // The signed token already binds the email to the thread — but match it
  // case-insensitively against the thread row as a defense-in-depth check.
  if (thread.userEmail.trim().toLowerCase() !== args.reporterEmail.trim().toLowerCase()) {
    throw new HttpError(403, "email does not match thread");
  }
  // Best-effort link to a User row if one exists (admin sees a real
  // reporter rather than just a string).
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

export async function listIssues(args: {
  status?: "open" | "resolved";
}): Promise<IssueListRow[]> {
  const rows = await prisma.issue.findMany({
    where: { ...(args.status ? { status: args.status } : {}) },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 500,
    include: {
      agent: { select: { id: true, slug: true, displayName: true, avatar: true } },
      reporter: { select: { id: true, name: true } },
      conversation: { select: { title: true } },
      thread: { select: { subject: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    surface: r.surface as "chat" | "email",
    status: r.status as "open" | "resolved",
    description: r.description,
    reporterEmail: r.reporterEmail,
    reporterUserId: r.reporterUserId,
    reporterName: r.reporter?.name ?? null,
    agent: {
      id: r.agent.id,
      slug: r.agent.slug,
      displayName: r.agent.displayName,
      avatar: r.agent.avatar,
    },
    conversationId: r.conversationId,
    threadId: r.threadId,
    sessionLabel:
      r.surface === "chat"
        ? (r.conversation?.title ?? "Conversation")
        : (r.thread?.subject ?? "Email thread"),
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  }));
}

export type IssueDetailRunEvent = {
  seq: number;
  type: string;
  createdAt: string;
  payload: unknown;
};

export type IssueDetailRun = {
  id: string;
  surface: "chat" | "email";
  status: string;
  error: string | null;
  output: string | null;
  startedAt: string;
  completedAt: string | null;
  events: IssueDetailRunEvent[];
};

export type IssueDetailMessage =
  | {
      kind: "chat";
      id: string;
      role: string;
      content: string;
      runId: string | null;
      createdAt: string;
    }
  | {
      kind: "email";
      id: string;
      direction: "inbound" | "outbound";
      subject: string;
      body: string;
      createdAt: string;
    };

export type IssueDetail = {
  id: string;
  surface: "chat" | "email";
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
  agent: {
    id: string;
    slug: string;
    displayName: string;
    avatar: string | null;
  };
  session: {
    conversationId: string | null;
    threadId: string | null;
    label: string;
    userEmail: string | null;
  };
  messages: IssueDetailMessage[];
  runs: IssueDetailRun[];
};

/**
 * Full detail for the admin issue viewer: reporter info, the raw
 * conversation/thread messages, and every AgentRun's RunEvent log so the
 * admin can inspect tool calls, thinking, and errors.
 */
export async function getIssueDetail(id: string): Promise<IssueDetail> {
  const issue = await prisma.issue.findUnique({
    where: { id },
    include: {
      agent: { select: { id: true, slug: true, displayName: true, avatar: true } },
      reporter: { select: { id: true, name: true } },
      resolvedBy: { select: { name: true, email: true } },
    },
  });
  if (!issue) throw new HttpError(404, "issue not found");

  let messages: IssueDetailMessage[] = [];
  let runs: IssueDetailRun[] = [];
  let sessionLabel = "";
  let userEmail: string | null = null;

  if (issue.surface === "chat" && issue.conversationId) {
    const conv = await prisma.chatConversation.findUnique({
      where: { id: issue.conversationId },
      include: {
        user: { select: { email: true } },
        messages: {
          where: { role: { in: ["user", "assistant", "system"] } },
          orderBy: { createdAt: "asc" },
        },
        runs: {
          orderBy: { startedAt: "asc" },
          include: { events: { orderBy: { seq: "asc" } } },
        },
      },
    });
    if (conv) {
      sessionLabel = conv.title;
      userEmail = conv.user?.email ?? null;
      messages = conv.messages.map((m) => ({
        kind: "chat",
        id: m.id,
        role: m.role,
        content: m.content,
        runId: m.runId,
        createdAt: m.createdAt.toISOString(),
      }));
      runs = conv.runs.map((r) => ({
        id: r.id,
        surface: r.surface as "chat" | "email",
        status: r.status,
        error: r.error,
        output: r.output,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        events: r.events.map((e) => ({
          seq: e.seq,
          type: e.type,
          createdAt: e.createdAt.toISOString(),
          payload: e.payload,
        })),
      }));
    }
  } else if (issue.surface === "email" && issue.threadId) {
    const thread = await prisma.emailThread.findUnique({
      where: { id: issue.threadId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        runs: {
          orderBy: { startedAt: "asc" },
          include: { events: { orderBy: { seq: "asc" } } },
        },
      },
    });
    if (thread) {
      sessionLabel = thread.subject;
      userEmail = thread.userEmail;
      messages = thread.messages.map((m) => ({
        kind: "email",
        id: m.id,
        direction: m.direction === "inbound" ? "inbound" : "outbound",
        subject: m.subject,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      }));
      runs = thread.runs.map((r) => ({
        id: r.id,
        surface: r.surface as "chat" | "email",
        status: r.status,
        error: r.error,
        output: r.output,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        events: r.events.map((e) => ({
          seq: e.seq,
          type: e.type,
          createdAt: e.createdAt.toISOString(),
          payload: e.payload,
        })),
      }));
    }
  }

  return {
    id: issue.id,
    surface: issue.surface as "chat" | "email",
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
    agent: {
      id: issue.agent.id,
      slug: issue.agent.slug,
      displayName: issue.agent.displayName,
      avatar: issue.agent.avatar,
    },
    session: {
      conversationId: issue.conversationId,
      threadId: issue.threadId,
      label: sessionLabel,
      userEmail,
    },
    messages,
    runs,
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
